# TASKS — Zeezeef / X capture

Forward-looking backlog. The clog is the historical record; this is what's still open.

## Open

- [ ] **Keep finding fresh trends when a trend runs dry.** When a trend's feed is
  exhausted (or all current trends are), pull *new* trends and continue instead of
  re-cycling stale ones. Today: per-topic end-of-feed advances the queue; queue
  exhaustion re-seeds the Trending tab — make the "get more trends" path explicit/robust.
- [ ] **Split Duration and Post-count into two mutually-exclusive modes** (replaces the
  combined "run X min OR until Y posts"):
  - *Duration mode:* user sets time + speed (posts/min); show a live estimate of total
    posts (≈ time × speed).
  - *Post-count mode* (new DEFAULT, default 1000): fixed 100 posts/min, maintained until
    the count is hit (~10 min for 1000). Supersedes target-priority/extend-to-2h logic.
- [ ] **Capture on/off master toggle.** Pause passive capture even when autopilot is off —
  for when the user browses X normally and doesn't want posts harvested. Background skips
  persisting payloads while off; popup reflects state.

## Done

- [x] **Session capture count on the on-page badge** (2026-06-05). Badge now reads
  `■ Stop autopilot — <topic> · N captured · ~M/min`.
- [x] **Home-feed interleave** (2026-06-05). ~50% of topic-advances detour to `/home`
  before the next topic (Trending + Manual; Current excluded). Home tweets bucketed as
  `(home feed)`; global dedup prevents double-counting.
- [x] **Home-feed-only mode** (2026-06-05). New `home` source: stays on `/home`, scrolls +
  dives, loops until session end.
- [x] **Clean dive attribution** (2026-06-05). Driver stamps `run.context`; background
  attributes by op (`HomeTimeline` → `(home feed)`, timing-proof) then falls back to the
  stamped context for dives — so a thread-dive off home stays `(home feed)` instead of
  leaking the last trend topic.

## Pre-merge (branch `autopilot` → `main`)

- [ ] Add an Autopilot section to the README; revise the "passive observation / not a bulk
  crawler" claims to honestly reflect the active mode.
- [ ] Live in-browser validation of the scroll/navigate loop, trend-DOM reading, tab
  binding, stop-on-challenge, thread dives, and now the home interleave.
- [ ] Verify `X-Zeeschuimer-Platform: twitter` + `__import_meta` fields against a live 4CAT.
