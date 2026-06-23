# zeerover — Hub

> Chrome MV3 extension that captures X/Twitter post text → NDJSON for research; a Chromium-side counterpart to Zeeschuimer. · Status: WIP — passive capture done in code/tests, autopilot merged but not browser-validated. · Refresh with `/hub`.

X/Twitter capture extension (formerly "Zeezeef"). Repo: `danieldager/zeerover`.

## 🧭 Navigate

| Concern | Where |
|---|---|
| Project guide / install / ethics | [README.md](README.md) |
| Architecture & file map | [Architecture](#-architecture) (below — no REPO_MAP.md yet) |
| Backlog (open + pre-merge) | [clog/TASKS.md](clog/TASKS.md) |
| History (latest clog) | <!-- auto:clog -->[clog/010626.md](clog/010626.md)<!-- /auto:clog --> · also `git log` |
| Test data / fixtures | [fixtures/README.md](fixtures/README.md) |
| Sample output | `x_capture_*.ndjson` (4 local files, gitignored per X ToS) |
| Eval results | _(N/A — this is an extension, not an ML pipeline)_ |
| Cross-project knowledge | vault -> projects/zeerover |

## 📌 Status at a glance

- **Passive capture pipeline is v1-complete in code + tests:** MAIN-world fetch/XHR hook (`injected.js`) → bridge (`content.js`) → recursive GraphQL walk (`extractor.js`) → dedup + storage in the service worker (`background.js`) → popup export (`popup.js`). `npm test` (node --test) green (12/12 per last clog).
- **Dual output:** stores the **raw** tweet object (4CAT/Zeeschuimer-native, source of truth) and derives a **simplified** schema for download. Export = simplified; 4CAT upload = raw.
- **Autopilot (`autopilot.js`) — active collection** is built and merged to `main`: resumable state machine in `chrome.storage`, trend cycling + thread dives + home-feed interleave + a home-only mode, human-like motion (log-normal pauses, eased smooth-scroll), a ~100 posts/min cap, and stop-on-challenge (Cloudflare Turnstile / Arkose).
- **Real output exists locally:** 4 capture sessions (2026-06-02 / 06-05), ~1383 simplified records total — evidence the passive path runs in a browser. Not committed (`.gitignore` blocks `*.ndjson`).
- **Honest gaps:** all of autopilot is **untested in a live browser**; the trend-DOM reading and SPA thread-dive are the most fragile, markup-dependent parts. The `X-Zeeschuimer-Platform: twitter` header + `__import_meta` fields are **unverified against a live 4CAT**.
- **Risk posture:** read-only automation (scroll + search only); jitter/dwell/caps/single-account are deliberate mitigations, but automated collection is ToS-prohibited — not guaranteed safe.

## 🔬 Open questions / next work

From [clog/TASKS.md](clog/TASKS.md):
- Keep finding **fresh trends when a trend runs dry** (make the re-seed path explicit/robust).
- Split **Duration** vs **Post-count** into two mutually-exclusive modes (post-count the new default, 1000 @ 100/min).
- **Capture on/off master toggle** — pause passive capture during normal browsing.
- Pre-merge debt: add an Autopilot section to the README; live in-browser validation; verify the 4CAT import fields against a real instance.

## 🏗 Architecture

Capture path: `injected.js` (MAIN world, hooks `fetch`/`XHR`, clones response synchronously) → `content.js` (origin-checked bridge) → `background.js` service worker (`importScripts("extractor.js")`, serialized read-modify-write to avoid lost-tweet races, persistent `seen_ids` dedup) → `popup.js`/`popup.html` (count, per-op breakdown, NDJSON export, reset, 4CAT upload). `extractor.js` = `extractRaw(json)` + `projectSimplified(node)`; doubles as a CommonJS module for Node tests. `autopilot.js` is an isolated-world driver layered on top — it only navigates/scrolls so the passive hook sees more. `fixtures/` holds synthetic GraphQL responses for `test/extractor.test.js`; `gen_icons.py` makes the icons.

## 🤖 For agents

Start at [README.md](README.md), then this hub's Architecture, then [clog/TASKS.md](clog/TASKS.md) for open work. Log notable decisions/tests to `clog/DDMMYY.md` (HH:MM entries); keep the forward-looking backlog in `clog/TASKS.md`. Shared concepts live in the vault at `projects/zeerover`.
