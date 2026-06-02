// background.js — MV3 service worker: parse, extract, dedup, persist.
//
// Classic worker (not a module) so it can importScripts the shared extractor,
// which also doubles as a Node-testable CommonJS module.
importScripts("extractor.js"); // provides extractTweets() and opName()

const SEEN_KEY = "seen_ids";
const DATA_KEY = "captured";
const DEBUG = false; // flip true to log every capture to the SW console

// ---------------------------------------------------------------------------
// Serialized read-modify-write.
//
// Rapid scrolling fires many payloads nearly simultaneously. Each handler does
// read → modify → write against chrome.storage.local; if two interleave at the
// async read, the second write clobbers the first and freshly-captured tweets
// are LOST (not merely duplicated). A single promise chain forces the handlers
// to run one at a time. The chain lives only for this service-worker lifetime —
// which is exactly the window in which the race exists — and every task still
// reads fresh from storage, so a teardown mid-chain loses nothing.
// ---------------------------------------------------------------------------
let queue = Promise.resolve();
function enqueue(task) {
  queue = queue.then(task).catch((e) => console.error("[xcap]", e));
  return queue;
}

// Confirmation line so you can tell the worker reloaded with logging on, even
// before any new post is captured.
if (DEBUG) console.log("[xcap] service worker active — capture logging ON");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return false;

  if (msg.type === "xcap_payload") {
    enqueue(() => handlePayload(msg.body, msg.url, sender.tab && sender.tab.url));
    return false; // fire-and-forget; no response needed
  }

  if (msg.type === "xcap_reset") {
    // Ack only after the clear has actually been written, so the popup's
    // refresh reads the emptied store rather than racing it.
    enqueue(() => chrome.storage.local.set({ [SEEN_KEY]: [], [DATA_KEY]: [] }))
      .then(() => sendResponse({ ok: true }));
    return true; // keep the message channel open for the async sendResponse
  }

  // autopilot.js (a content script) can't read its own tab id; hand it back so a
  // run stays bound to the single tab that started it.
  if (msg.type === "autopilot_whoami") {
    sendResponse({ tabId: sender.tab && sender.tab.id });
    return true;
  }

  return false;
});

async function handlePayload(bodyText, apiUrl, pageUrl) {
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return; // not JSON / partial body — ignore
  }

  let tweets;
  try {
    tweets = extractTweets(json);
  } catch (e) {
    if (DEBUG) console.error("[xcap] extract failed", e);
    return;
  }
  if (!tweets || !tweets.length) return;

  const store = await chrome.storage.local.get([SEEN_KEY, DATA_KEY]);
  const seen = new Set(store[SEEN_KEY] || []);
  const captured = store[DATA_KEY] || [];

  const op = opName(apiUrl);
  const now = new Date().toISOString();

  const fresh = [];
  for (const t of tweets) {
    if (!t.id || seen.has(t.id)) continue;
    seen.add(t.id);
    fresh.push({
      ...t,
      captured_at: now,
      source_url: pageUrl || "",
      operation: op,
    });
  }

  if (!fresh.length) return;

  await chrome.storage.local.set({
    [SEEN_KEY]: [...seen],
    [DATA_KEY]: captured.concat(fresh),
  });

  if (DEBUG) {
    console.log(
      `[xcap] ${op || "?"} +${fresh.length} (total ${captured.length + fresh.length})`
    );
  }
}
