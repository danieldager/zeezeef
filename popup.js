// popup.js — render count, export NDJSON, reset.
// NB: the export Blob is built HERE, in the popup document, NOT in the
// service worker — MV3 service workers lack URL.createObjectURL (§6.4).

const DATA_KEY = "captured";

const $count = document.getElementById("count");
const $ops = document.getElementById("ops");
const $status = document.getElementById("status");
const $export = document.getElementById("export");
const $reset = document.getElementById("reset");

function setStatus(msg) {
  $status.textContent = msg || "";
}

// Defensive dedup by id; preserves first-seen order.
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

  // small per-operation breakdown for at-a-glance provenance
  const byOp = {};
  for (const r of unique) {
    const op = r.operation || "unknown";
    byOp[op] = (byOp[op] || 0) + 1;
  }
  const parts = Object.entries(byOp)
    .sort((a, b) => b[1] - a[1])
    .map(([op, n]) => `${op}: ${n}`);
  $ops.textContent = parts.length ? parts.join("  ·  ") : "";
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
  // trailing newline so the file is a clean NDJSON stream
  const blob = new Blob([ndjson + "\n"], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    await chrome.downloads.download({
      url,
      filename: `x_capture_${stamp}.ndjson`,
      saveAs: false,
    });
    setStatus(`Exported ${unique.length} posts.`);
  } catch (e) {
    setStatus(`Export failed: ${e && e.message ? e.message : e}`);
  } finally {
    // give the download time to start before revoking the blob URL
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }
});

$reset.addEventListener("click", async () => {
  if (!confirm("Clear all captured posts? This cannot be undone.")) return;
  await chrome.runtime.sendMessage({ type: "xcap_reset" });
  setStatus("Cleared.");
  refresh();
});

// keep the count live while the popup is open
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[DATA_KEY]) refresh();
});

refresh();
