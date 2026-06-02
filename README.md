# Zeezeef — X Post Text Capture (research)

*Dutch for “sea-sieve”: it sieves the posts you scroll out of X's feed into a clean NDJSON dataset.*

A Chrome (Manifest V3) extension that **passively captures the text of X / Twitter
posts as you browse normally**, deduplicates them, and exports them as **NDJSON**
for downstream research (NLP / political-communication / computational social
science).

You scroll X as usual — home timeline, a profile, a search/hashtag, a thread —
and the extension silently collects every post that loaded. No automation, no
separate login, no API key. It reads only your own logged-in session's traffic.

This fills the gap left by [Zeeschuimer](https://github.com/digitalmethodsinitiative/zeeschuimer)
(the 4CAT browse-and-capture tool), which is **Firefox-only** because it reads
network response bodies via a Gecko-only API. Chromium can't do that, so this
extension gets the same data a different way — see [How it works](#how-it-works).

> Independent project — **not affiliated with or endorsed by** the Digital
> Methods Initiative or 4CAT. It's a Chromium-side counterpart to Zeeschuimer's
> idea, built on a different mechanism (fetch/XHR interception, not
> `filterResponseData`).

> **Status: v0.1 — early.** Validated on a real session (clean, deduplicated,
> multi-surface NDJSON), but *recall is unverified*: the MAIN-world injection
> race means the first response(s) of a session can be missed, and it hasn't
> been tested at scale or across Chromium forks. Treat captures as
> best-effort and spot-check coverage. See [Scope, ethics & limitations](#scope-ethics--limitations).

---

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. **Load unpacked** → select this folder (`zeerover/`).
4. The extension icon appears in the toolbar. Pin it for easy access.

Works in Chrome / Chromium 111+ (the `world: "MAIN"` content-script feature),
and Chromium-based browsers (Edge, Brave, Vivaldi) — see
[Troubleshooting](#troubleshooting) if capture is silent on a fork.

## Use

1. Go to `x.com` (or `twitter.com`) **logged in**.
2. Browse normally — scroll a timeline, open a profile, run a search, read a
   thread. The extension captures posts as their data arrives.
3. Click the toolbar icon to see the running **count** and a per-operation
   breakdown (`HomeTimeline`, `UserTweets`, `SearchTimeline`, `TweetDetail`, …).
4. Click **Export NDJSON** to download the dataset. **Reset** clears the store.

## Output format (NDJSON)

One JSON object per line, UTF-8, newline-separated, one line per unique post:

```json
{"id":"1234567890","full_text":"the post text, untruncated","screen_name":"someuser","created_at":"Wed Mar 12 09:00:00 +0000 2025","lang":"en","conversation_id":"1234500000","captured_at":"2025-03-12T09:01:23.456Z","operation":"SearchTimeline","source_url":"https://x.com/search?q=Israel&src=trend_click","topic":"Israel"}
```

| Field | Meaning |
|-------|---------|
| `id` | Tweet id (`rest_id`) |
| `full_text` | Post text, untruncated (prefers the long-form "note tweet" text) |
| `screen_name` | Author handle |
| `created_at` | X's original timestamp string |
| `lang` | X's detected language |
| `conversation_id` | Thread/conversation id |
| `captured_at` | ISO time the extension saw it (provenance) |
| `operation` | Which GraphQL operation delivered it (provenance) |
| `source_url` | The page URL you were on (provenance — "what you saw, where") |
| `topic` | The search query the post was collected under (e.g. an autopilot trend term), or `null` for non-search browsing |

---

## How it works

In MV3, content scripts run in an *isolated world* and **cannot see the page's
`fetch` / `XMLHttpRequest`**. X loads all post data as JSON (GraphQL). So:

```
 x.com page
 ├─ injected.js   (MAIN world, document_start)
 │    monkeypatches window.fetch + XMLHttpRequest, filters /i/api/graphql/,
 │    reads a CLONE of each JSON response, window.postMessage(rawText)
 │                                   │
 ├─ content.js    (ISOLATED world)  ▼
 │    validates the message, chrome.runtime.sendMessage(rawText)
 │                                   │
 extension                          ▼
 ├─ background.js (service worker)
 │    JSON.parse → extractTweets() (recursive walk) → dedup by id → storage.local
 │
 └─ popup.js
      shows count, builds the NDJSON Blob, triggers the download
```

**Why interception, not DOM scraping?** X *virtualizes* its feeds (off-screen
posts are removed from the DOM), so a DOM scraper silently loses anything you
scroll past, and X's markup changes constantly. Interception captures each
response when it arrives, regardless of what's painted — immune to both problems.

**Files:**

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest, permissions, content-script registration |
| `injected.js` | MAIN-world `fetch`/XHR hook |
| `content.js` | isolated-world → background bridge |
| `extractor.js` | `extractTweets()` recursive walk (+ Node-testable) |
| `background.js` | service worker: parse, extract, dedup, persist |
| `popup.html` / `popup.js` | UI: count, NDJSON export, reset |
| `fixtures/`, `test/` | synthetic GraphQL responses + unit tests |

### Retweets & quote tweets (design choice)

The recursive walk captures **every** Tweet object it finds, each under its own
`id` — a faithful "feed as experienced" record. That means:

- A **retweet** yields two records: the retweet (attributed to the retweeter)
  **and** the inner original (attributed to the author). The retweet's
  `full_text` is **resolved to the original's full text**, not the truncated
  `RT @user: …` string, so the dataset carries clean content.
- A **quote tweet** yields the quote **and** the quoted original, distinctly.

If you only want originals, post-filter the NDJSON; the records are
distinguishable by `id`/`screen_name`. (Changing this is a one-line tweak in
`extractor.js`.)

---

## Testing

```bash
npm test          # runs node --test against fixtures/
```

The extractor is pure (no browser APIs), so it's unit-tested in Node against the
synthetic fixtures in `fixtures/`. See `fixtures/README.md` for how to drop in
**real** captured responses and re-validate after an X change.

Manual checks worth doing in the browser:

- **Plumbing:** `chrome://extensions` → the extension → **service worker** →
  set `DEBUG = true` in `background.js`, reload, scroll x.com, watch captures log.
- **Virtualization (the whole point):** scroll a profile past 100 posts, export,
  confirm early posts no longer in the DOM are still in the NDJSON.
- **Dedup:** scroll up and back down — the count must not inflate.
- **UTF-8 / no truncation:** check a long "note" tweet and one with emoji /
  non-Latin script in the export.

---

## Maintenance

**X reshapes its GraphQL responses periodically** — this is the same maintenance
treadmill Zeeschuimer rides; it is inherent to the problem, not a defect. The
extractor is built to absorb most of it: it does **not** hardcode the path from
the response root. It recursively walks the JSON and matches any node that *looks
like* a Tweet (`rest_id`/`__typename: "Tweet"` **and** `legacy.full_text`), which
is far more stable than the wrapper around it.

When something does break (e.g. handles come out `null`, or text is empty):

1. Capture a fresh real response (`fixtures/README.md`).
2. Diff its Tweet object against the predicate / field paths in `extractor.js`
   (`resolveText`, `screenName`, the `looksLikeTweet` check).
3. Update those, add the fixture to the test suite, `npm test`.

**Most likely drift point:** X has been migrating per-user fields (`screen_name`,
`name`, `created_at`) out of `legacy` into a newer `core` object. `screenName()`
already reads `core.user_results.result.core.screen_name` first and falls back to
`…legacy.screen_name`. If handles ever come out `null`, check whether the field
moved again and add the new path to that helper.

If capture yields **nothing at all**, the first suspect is MAIN-world injection
timing (see Troubleshooting) — not the extractor.

## Troubleshooting

- **Nothing is captured.** Confirm `injected.js` is running in the MAIN world at
  `document_start`. On some Chromium forks the declarative `world: "MAIN"`
  content script can be unreliable; switch to the tag-injection fallback:
  remove the second content-script entry from `manifest.json` and uncomment the
  fallback block at the bottom of `content.js`. The `web_accessible_resources`
  entry needed for that is already in the manifest.
- **Count climbs but export is empty / fails.** The export Blob is built in the
  popup (MV3 service workers have no `URL.createObjectURL`); check the popup's
  devtools console.

## Scope, ethics & limitations

- **Passive, session-scoped.** Reads only your own logged-in session's traffic —
  passive observation, like Zeeschuimer. It is **not** a bulk crawler; it
  captures only what you actually browse. For systematic, query-driven collection
  at volume, use a dedicated tool (`minet`, `twscrape`, `Scweet`).
- **X data under X's Terms of Service.** Intended for academic research; run it
  in line with your institution's data-protection / ethics review. By design it
  collects only post text + minimal provenance — keep it that way.
- **v1 scope:** post text only. Engagement metrics, media, and exact 4CAT-import
  schema compatibility are out of scope (see the brief's stretch goals).
- **Storage:** captures live in `chrome.storage.local` (`unlimitedStorage` is
  requested so large sessions don't hit the default quota and silently drop
  data). Export and **Reset** between studies to keep the store lean.

## License

MIT.
