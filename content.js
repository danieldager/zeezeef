// content.js — isolated-world bridge.
// Receives MAIN-world messages from injected.js and forwards the raw JSON
// to the background service worker. Runs in the extension's isolated world,
// so it CAN call chrome.runtime.* (the page cannot).

const MARKER = "__XCAP__";

window.addEventListener("message", (event) => {
  // Only trust messages this window posted to itself (injected.js uses
  // window.postMessage). event.source === window rejects messages from
  // iframes/other windows; matching origin rejects cross-origin posts; the
  // marker rejects unrelated page chatter.
  //
  // Caveat: injected.js shares the page's JS world, so a hostile script
  // already running on x.com could in principle post a spoofed payload bearing
  // the marker. The downstream effect is at worst noise in the dataset (the
  // background only parses it as tweet JSON; no privileged action), so for this
  // passive-research threat model that residual risk is accepted.
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;
  const d = event.data;
  if (!d || d.source !== MARKER || typeof d.body !== "string") return;

  try {
    const p = chrome.runtime.sendMessage({
      type: "xcap_payload",
      url: d.url,
      body: d.body,
    });
    // In MV3 sendMessage returns a promise; swallow rejections (e.g. the
    // service worker briefly unavailable) so they don't surface as unhandled.
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (_) {
    // Extension context can be invalidated (e.g. the extension was reloaded
    // while this page stayed open). Nothing to do but ignore — the next page
    // load re-establishes the bridge.
  }
});

// ---------------------------------------------------------------------------
// Fallback tag-injection. NOT used by default: the manifest declares
// injected.js as a `world: "MAIN"` content script (Chrome 111+), which is the
// clean path and runs at document_start before X's app code. If MAIN-world
// timing ever proves unreliable on a target Chromium build, remove the second
// content-script entry from manifest.json and uncomment the block below; the
// web_accessible_resources entry (already in the manifest) makes it loadable.
// ---------------------------------------------------------------------------
//
// (function injectFallback() {
//   try {
//     const s = document.createElement("script");
//     s.src = chrome.runtime.getURL("injected.js");
//     s.onload = () => s.remove();
//     (document.head || document.documentElement).prepend(s);
//   } catch (_) {}
// })();
