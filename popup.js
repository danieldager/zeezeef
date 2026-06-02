// popup.js — capture controls + autopilot + session-end settings.
// The export Blob is built HERE (the MV3 service worker lacks createObjectURL).

const DATA_KEY = "captured";
const CFG_KEY = "autopilot_cfg";
const RUN_KEY = "autopilot_run";

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Capture: count / export / reset
// ---------------------------------------------------------------------------
const $count = $("count");
const $ops = $("ops");
const $status = $("status");
const $export = $("export");
const $reset = $("reset");

const setStatus = (m) => { $status.textContent = m || ""; };

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
    const o = (r.__import_meta && r.__import_meta.operation) || "unknown";
    byOp[o] = (byOp[o] || 0) + 1;
  }
  $ops.textContent = Object.entries(byOp)
    .sort((a, b) => b[1] - a[1])
    .map(([o, n]) => `${o}: ${n}`)
    .join("  ·  ");
  return unique;
}

$export.addEventListener("click", async () => {
  setStatus("");
  const unique = await refresh();
  if (!unique.length) { setStatus("Nothing to export yet."); return; }
  // Download = the simplified, analysis-friendly schema (4CAT gets raw instead).
  const ndjson = unique.map((r) => JSON.stringify(projectSimplified(r))).join("\n") + "\n";
  const blob = new Blob([ndjson], { type: "application/x-ndjson" });
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
// Autopilot + session-end controls
// ---------------------------------------------------------------------------
const ap = {
  mode: $("ap-mode"), manualWrap: $("ap-manual-wrap"), manual: $("ap-manual"),
  time: $("ap-time"), target: $("ap-target"),
  threads: $("ap-threads"), threadDwell: $("ap-threaddwell"), skim: $("ap-skim"),
  dwell: $("ap-dwell"), cadence: $("ap-cadence"),
  toggle: $("ap-toggle"), status: $("ap-status"),
};
const se = {
  exportOn: $("se-export"), destWrap: $("se-dest-wrap"),
  destFile: $("se-dest-file"), dest4cat: $("se-dest-4cat"),
  fourcatWrap: $("se-4cat-wrap"), fourcatUrl: $("se-4caturl"),
  reset: $("se-reset"), restart: $("se-restart"),
};

const clampNum = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const toggleManual = () => { ap.manualWrap.style.display = ap.mode.value === "manual" ? "block" : "none"; };
const toggle4cat = () => { se.fourcatWrap.style.display = se.dest4cat.checked ? "block" : "none"; };
const toggleDest = () => { se.destWrap.style.display = se.exportOn.checked ? "block" : "none"; toggle4cat(); };

function readCfg() {
  return {
    mode: ap.mode.value,
    manualTopics: ap.manual.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
    dwellSec: clampNum(ap.dwell.value, 10, 3600, 90),
    cadenceSec: clampNum(ap.cadence.value, 0.5, 30, 2),
    sessionMaxMin: clampNum(ap.time.value, 1, 600, 30),
    targetPosts: clampNum(ap.target.value, 0, 1000000, 0),
    threadDives: ap.threads.checked,
    threadDwellSec: clampNum(ap.threadDwell.value, 5, 300, 20),
    skimBursts: ap.skim.checked,
    autoExport: se.exportOn.checked,
    exportDest: se.dest4cat.checked ? "4cat" : "file",
    fourcatUrl: se.fourcatUrl.value.trim() || "http://localhost:4444",
    autoReset: se.reset.checked,
    autoRestart: se.restart.checked,
  };
}

function applyCfg(cfg = {}) {
  if (cfg.mode) ap.mode.value = cfg.mode;
  ap.manual.value = (cfg.manualTopics || []).join("\n");
  if (cfg.dwellSec) ap.dwell.value = cfg.dwellSec;
  if (cfg.cadenceSec) ap.cadence.value = cfg.cadenceSec;
  if (cfg.sessionMaxMin) ap.time.value = cfg.sessionMaxMin;
  if (cfg.targetPosts != null) ap.target.value = cfg.targetPosts;
  ap.threads.checked = cfg.threadDives !== false;
  if (cfg.threadDwellSec) ap.threadDwell.value = cfg.threadDwellSec;
  ap.skim.checked = cfg.skimBursts !== false;
  se.exportOn.checked = !!cfg.autoExport;
  if (cfg.exportDest === "4cat") se.dest4cat.checked = true;
  else se.destFile.checked = true;
  if (cfg.fourcatUrl) se.fourcatUrl.value = cfg.fourcatUrl;
  se.reset.checked = cfg.autoReset !== false;
  se.restart.checked = !!cfg.autoRestart;
  toggleManual();
  toggleDest();
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
  ap.toggle.classList.toggle("running", running);
  [ap.mode, ap.manual, ap.time, ap.target, ap.threads, ap.threadDwell, ap.skim, ap.dwell, ap.cadence].forEach(
    (e) => (e.disabled = running)
  );
  if (running) {
    const cur = run.queue && run.queue[run.idx];
    ap.status.textContent =
      `Running · ${run.visited || 0} topic(s)` + (cur ? ` · now: ${cur.label}` : "");
  } else if (run && run.reason) {
    ap.status.textContent = (run.completed ? "Finished" : "Stopped") + `: ${run.reason}`;
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
    running: true, startedAt: Date.now(), tabId: tabId ?? null,
    queue, idx: 0, visited: 0, reason: null, seededFrom: false,
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
    /* tab may not be x.com — the flag is already cleared */
  }
  renderAutopilot();
}

ap.mode.addEventListener("change", toggleManual);
se.exportOn.addEventListener("change", toggleDest);
se.destFile.addEventListener("change", toggle4cat);
se.dest4cat.addEventListener("change", toggle4cat);
ap.toggle.addEventListener("click", async () => {
  const { [RUN_KEY]: run } = await chrome.storage.local.get(RUN_KEY);
  if (run && run.running) stopAutopilot();
  else startAutopilot();
});

// Persist session-end settings live, so a session already running picks up the
// latest choices when it finishes.
[se.exportOn, se.destFile, se.dest4cat, se.fourcatUrl, se.reset, se.restart].forEach((el) => {
  el.addEventListener("change", async () => {
    await chrome.storage.local.set({ [CFG_KEY]: readCfg() });
  });
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
