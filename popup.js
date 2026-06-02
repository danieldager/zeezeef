// popup.js — capture count + NDJSON export + reset, and the autopilot controls.
// NB: the export Blob is built HERE, in the popup document, NOT in the service
// worker — MV3 service workers lack URL.createObjectURL.

const DATA_KEY = "captured";
const CFG_KEY = "autopilot_cfg";
const RUN_KEY = "autopilot_run";

// ---------------------------------------------------------------------------
// Capture count + export + reset
// ---------------------------------------------------------------------------
const $count = document.getElementById("count");
const $ops = document.getElementById("ops");
const $status = document.getElementById("status");
const $export = document.getElementById("export");
const $reset = document.getElementById("reset");

function setStatus(msg) {
  $status.textContent = msg || "";
}

function dedup(records) {
  const seen = new Set();
  const out = [];
  for (const r of records) {
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

async function refresh() {
  const { [DATA_KEY]: captured = [] } = await chrome.storage.local.get(DATA_KEY);
  const unique = dedup(captured);
  $count.textContent = unique.length;
  $export.disabled = unique.length === 0;

  const byOp = {};
  for (const r of unique) {
    const op = r.operation || "unknown";
    byOp[op] = (byOp[op] || 0) + 1;
  }
  $ops.textContent = Object.entries(byOp)
    .sort((a, b) => b[1] - a[1])
    .map(([op, n]) => `${op}: ${n}`)
    .join("  ·  ");
  return unique;
}

$export.addEventListener("click", async () => {
  setStatus("");
  const unique = await refresh();
  if (!unique.length) {
    setStatus("Nothing to export yet.");
    return;
  }
  const ndjson = unique.map((r) => JSON.stringify(r)).join("\n");
  const blob = new Blob([ndjson + "\n"], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    await chrome.downloads.download({ url, filename: `x_capture_${stamp}.ndjson`, saveAs: false });
    setStatus(`Exported ${unique.length} posts.`);
  } catch (e) {
    setStatus(`Export failed: ${e && e.message ? e.message : e}`);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }
});

$reset.addEventListener("click", async () => {
  if (!confirm("Clear all captured posts? This cannot be undone.")) return;
  await chrome.runtime.sendMessage({ type: "xcap_reset" });
  setStatus("Cleared.");
  refresh();
});

// ---------------------------------------------------------------------------
// Autopilot controls
// ---------------------------------------------------------------------------
const ap = {
  mode: document.getElementById("ap-mode"),
  manualWrap: document.getElementById("ap-manual-wrap"),
  manual: document.getElementById("ap-manual"),
  dwell: document.getElementById("ap-dwell"),
  cadence: document.getElementById("ap-cadence"),
  maxTopics: document.getElementById("ap-maxtopics"),
  sessionMax: document.getElementById("ap-sessionmax"),
  loop: document.getElementById("ap-loop"),
  toggle: document.getElementById("ap-toggle"),
  status: document.getElementById("ap-status"),
};

const clampNum = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

function toggleManual() {
  ap.manualWrap.style.display = ap.mode.value === "manual" ? "block" : "none";
}

function readCfg() {
  return {
    mode: ap.mode.value,
    manualTopics: ap.manual.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
    dwellSec: clampNum(ap.dwell.value, 10, 3600, 90),
    cadenceSec: clampNum(ap.cadence.value, 0.5, 30, 2),
    maxTopics: clampNum(ap.maxTopics.value, 1, 100, 10),
    sessionMaxMin: clampNum(ap.sessionMax.value, 1, 240, 30),
    loop: ap.loop.checked,
  };
}

function applyCfg(cfg = {}) {
  if (cfg.mode) ap.mode.value = cfg.mode;
  ap.manual.value = (cfg.manualTopics || []).join("\n");
  if (cfg.dwellSec) ap.dwell.value = cfg.dwellSec;
  if (cfg.cadenceSec) ap.cadence.value = cfg.cadenceSec;
  if (cfg.maxTopics) ap.maxTopics.value = cfg.maxTopics;
  if (cfg.sessionMaxMin) ap.sessionMax.value = cfg.sessionMaxMin;
  ap.loop.checked = !!cfg.loop;
  toggleManual();
}

async function activeTabId() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] && tabs[0].id;
  } catch {
    return null;
  }
}

async function renderAutopilot() {
  const { [RUN_KEY]: run } = await chrome.storage.local.get(RUN_KEY);
  const running = !!(run && run.running);

  ap.toggle.textContent = running ? "■ Stop autopilot" : "▶ Start autopilot";
  ap.toggle.classList.toggle("danger", running);
  [ap.mode, ap.manual, ap.dwell, ap.cadence, ap.maxTopics, ap.sessionMax, ap.loop].forEach(
    (e) => (e.disabled = running)
  );

  if (running) {
    const cur = run.queue && run.queue[run.idx];
    ap.status.textContent =
      `Running · ${run.visited || 0} topic(s) done` + (cur ? ` · now: ${cur.label}` : "");
  } else if (run && run.reason) {
    ap.status.textContent =
      `Stopped: ${run.reason}` + (run.visited ? ` (${run.visited} topics)` : "");
  } else {
    ap.status.textContent = "";
  }
}

async function startAutopilot() {
  const cfg = readCfg();
  if (cfg.mode === "manual" && !cfg.manualTopics.length) {
    ap.status.textContent = "Add at least one topic.";
    return;
  }
  await chrome.storage.local.set({ [CFG_KEY]: cfg });

  const tabId = await activeTabId();
  const queue =
    cfg.mode === "manual"
      ? cfg.manualTopics.map((t) => ({
          label: t,
          url: `https://x.com/search?q=${encodeURIComponent(t)}&src=typed_query&f=live`,
        }))
      : [];
  const run = {
    running: true,
    startedAt: Date.now(),
    tabId: tabId ?? null,
    queue,
    idx: 0,
    visited: 0,
    reason: null,
  };
  await chrome.storage.local.set({ [RUN_KEY]: run });

  try {
    if (tabId != null) await chrome.tabs.sendMessage(tabId, { type: "autopilot_start" });
    else ap.status.textContent = "Open an x.com tab, then Start.";
  } catch {
    ap.status.textContent = "Open an x.com tab, then Start.";
  }
  renderAutopilot();
}

async function stopAutopilot() {
  const { [RUN_KEY]: run = {} } = await chrome.storage.local.get(RUN_KEY);
  run.running = false;
  run.reason = "stopped from popup";
  await chrome.storage.local.set({ [RUN_KEY]: run });
  const tabId = await activeTabId();
  try {
    if (tabId != null) await chrome.tabs.sendMessage(tabId, { type: "autopilot_stop" });
  } catch {
    /* tab may not be x.com — the run flag is already cleared */
  }
  renderAutopilot();
}

ap.mode.addEventListener("change", toggleManual);
ap.toggle.addEventListener("click", async () => {
  const { [RUN_KEY]: run } = await chrome.storage.local.get(RUN_KEY);
  if (run && run.running) stopAutopilot();
  else startAutopilot();
});

// ---------------------------------------------------------------------------
// Init + live updates
// ---------------------------------------------------------------------------
chrome.storage.local.get(CFG_KEY).then((o) => applyCfg(o[CFG_KEY] || {}));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[DATA_KEY]) refresh();
  if (changes[RUN_KEY]) renderAutopilot();
});

refresh();
renderAutopilot();
