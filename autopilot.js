// autopilot.js — OPTIONAL active-collection driver (isolated world, document_idle).
//
// ⚠️ This is the one part of Zeezeef that is NOT passive. When started, it
// scrolls the page and navigates between topics on its own to drive the feed so
// the passive capture pipeline (injected.js → content.js → background.js) sees
// more posts. That is automation; X's ToS restricts it and it raises the risk of
// rate-limits / suspension on the logged-in account. It is OFF by default and
// fully separate from the passive core — start it explicitly from the popup.
//
// Design: a resumable state machine. Switching topics is a real navigation, so
// the content script re-injects each time; runtime state lives in
// chrome.storage.local and the driver resumes on load. The run is bound to one
// tab id so it can't hijack the user's other x.com tabs.

(() => {
  if (window.top !== window) return; // top frame only — never drive iframes

  const RUN_KEY = "autopilot_run"; // runtime state (running, queue, idx, counters)
  const CFG_KEY = "autopilot_cfg"; // user settings
  const BADGE_ID = "__xcap_autopilot_badge";
  const TRENDING_URL = "https://x.com/explore/tabs/trending";

  const DEFAULTS = {
    mode: "trending", // "trending" | "manual" | "current"
    manualTopics: [],
    dwellSec: 90, // scroll each topic this long
    cadenceSec: 2, // base seconds between scroll steps
    maxTopics: 10, // stop after this many topics
    sessionMaxMin: 30, // hard wall-clock cap for the whole run
    loop: false, // when the queue is exhausted, start over (refresh trends)
    threadDives: true, // occasionally dip into a comment thread, then return
    threadDwellSec: 20, // how long to scroll inside a thread
  };

  let aborted = false; // module-local instant abort (badge / stop message)
  let busy = false; // guard against overlapping drive() runs

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (ms, f = 0.4) => Math.max(250, ms * (1 + (Math.random() * 2 - 1) * f));
  const getLocal = (k) =>
    chrome.storage.local.get(k).then((o) => o[k]).catch(() => undefined);
  const setRun = (run) => chrome.storage.local.set({ [RUN_KEY]: run }).catch(() => {});

  // Ask the background worker for our own tab id (content scripts can't read it).
  function myTabId() {
    return chrome.runtime
      .sendMessage({ type: "autopilot_whoami" })
      .then((r) => (r && r.tabId != null ? r.tabId : null))
      .catch(() => null);
  }

  // React to popup start/stop without needing a reload.
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return false;
    if (msg.type === "autopilot_start") { aborted = false; drive(); }
    if (msg.type === "autopilot_stop") { aborted = true; stop("stopped from popup"); }
    return false;
  });

  // Resume after each topic navigation.
  drive();

  async function drive() {
    if (busy) return;
    busy = true;
    try {
      await step();
    } catch (_) {
      /* never throw into the page */
    } finally {
      busy = false;
    }
  }

  async function step() {
    const run = await getLocal(RUN_KEY);
    if (!run || !run.running) { removeBadge(); return; }
    const cfg = { ...DEFAULTS, ...((await getLocal(CFG_KEY)) || {}) };

    // Only the tab that started the run drives (avoid hijacking other tabs).
    const myId = await myTabId();
    if (run.tabId != null && myId != null && run.tabId !== myId) return;

    // Hard caps + stale-run guard (a run older than the session cap won't resume,
    // e.g. after a browser restart).
    if (Date.now() - run.startedAt > cfg.sessionMaxMin * 60000)
      return stop("session time cap reached");
    if ((run.visited || 0) >= cfg.maxTopics) return stop("max topics reached");
    if (isChallenged()) return stop("hit a verification / rate-limit challenge — stopped to protect the account");

    // Trending: seed the queue from the Explore → Trending tab (a dense list of
    // short trend terms). Navigate there once — `seededFrom` guards against a
    // redirect loop — read the cells, then cycle each as a plain /search?q=term.
    if (cfg.mode === "trending" && (!run.queue || run.queue.length === 0)) {
      if (!onTrendingTab() && !run.seededFrom) {
        run.seededFrom = true;
        await setRun(run);
        return go(TRENDING_URL);
      }
      const trends = await readTrends(cfg.maxTopics);
      if (!trends.length)
        return stop("couldn't read the Trending tab — reload x.com and retry, or use Manual mode");
      run.queue = trends;
      run.idx = 0;
      run.seededFrom = false;
      await setRun(run);
      return go(trends[0].url);
    }

    showBadge(currentLabel(run, cfg));
    const res = await scrollPage(cfg.dwellSec * 1000, cfg, { allowDives: true, checkRun: true });
    if (aborted || res === "abort" || res === "stop") return;

    // Re-read: the user may have stopped mid-dwell.
    const r = await getLocal(RUN_KEY);
    if (!r || !r.running) { removeBadge(); return; }
    r.visited = (r.visited || 0) + 1;

    if (cfg.mode === "current") return stop("done (single page)");

    let next = r.idx + 1;
    if (next >= r.queue.length) {
      if (cfg.loop && cfg.mode === "trending") {
        r.queue = []; r.idx = 0; r.seededFrom = false; await setRun(r);
        return go(TRENDING_URL); // refresh trends
      }
      if (cfg.loop && cfg.mode === "manual") next = 0;
      else return stop("completed all topics");
    }
    r.idx = next;
    await setRun(r);
    go(r.queue[next].url);
  }

  // Scroll the current page for `durationMs` with human-ish jittered cadence, an
  // end-of-feed backoff, and periodic abort / challenge / session-cap checks.
  // With opts.allowDives, it occasionally dips into a comment thread and extends
  // the window by the time spent there (so the feed still gets its full scroll).
  // Returns "abort" | "stop" | "exhausted" | "done".
  async function scrollPage(durationMs, cfg, opts = {}) {
    let end = Date.now() + durationMs;
    const scroller = document.scrollingElement || document.documentElement;
    let lastH = 0, stale = 0, n = 0, dives = 0;
    let nextDiveAt = Date.now() + jitter(35000);

    while (Date.now() < end) {
      if (aborted) return "abort";

      if (n % 5 === 0) {
        if (isChallenged()) {
          stop("hit a verification / rate-limit challenge — stopped to protect the account");
          return "stop";
        }
        if (opts.checkRun) {
          const r = await getLocal(RUN_KEY);
          if (!r || !r.running) return "stop";
          if (Date.now() - r.startedAt > cfg.sessionMaxMin * 60000) {
            stop("session time cap reached");
            return "stop";
          }
        }
      }

      // Occasional comment-thread dive (main feed only, capped per topic).
      if (
        opts.allowDives && cfg.threadDives && dives < 2 &&
        Date.now() >= nextDiveAt && end - Date.now() > cfg.threadDwellSec * 1000 + 5000
      ) {
        const t0 = Date.now();
        const dove = await threadDive(cfg);
        if (aborted) return "abort";
        if (dove) { dives++; end += Date.now() - t0; } // don't let the dive eat scroll time
        nextDiveAt = Date.now() + jitter(35000);
        continue;
      }

      window.scrollBy(0, Math.round(window.innerHeight * (0.7 + Math.random() * 0.25)));
      n++;

      const h = scroller.scrollHeight;
      const atBottom = window.scrollY + window.innerHeight >= h - 200;
      if (atBottom && h === lastH) {
        if (++stale >= 4) return "exhausted"; // feed exhausted
      } else {
        stale = 0;
      }
      lastH = h;

      const base = cfg.cadenceSec * 1000;
      await sleep(jitter(n % 7 === 0 ? base * 3 : base));
    }
    return "done";
  }

  // Pop into a comment thread: open a visible post's conversation (SPA — so the
  // capture hook keeps running and the feed's scroll is restored on back), scroll
  // the replies briefly, then return. Best-effort: any failure just resumes the
  // feed. The replies are flagged downstream via `is_reply` and tagged with the
  // current topic (background falls back to the run's topic on /status/ pages).
  async function threadDive(cfg) {
    try {
      const link = pickVisibleTweetLink();
      if (!link) return false;
      const fromPath = location.pathname;
      link.click(); // X's router handles the timestamp permalink → conversation
      const opened = await waitForCondition(() => /\/status\/\d+/.test(location.pathname), 4000);
      if (!opened) return false;
      await scrollPage(cfg.threadDwellSec * 1000, cfg); // scroll the replies
      if (aborted) return true;
      history.back(); // SPA back → feed, scroll position restored
      await waitForCondition(() => location.pathname === fromPath, 4000);
      await sleep(jitter(900));
      return true;
    } catch (_) {
      return false;
    }
  }

  // A visible post's timestamp permalink (it wraps a <time>) — the reliable route
  // into a conversation; avoids reply/quote/media sub-links.
  function pickVisibleTweetLink() {
    const links = Array.from(
      document.querySelectorAll('article[data-testid="tweet"] a[href*="/status/"]')
    ).filter((a) => {
      if (!a.querySelector("time")) return false;
      const r = a.getBoundingClientRect();
      return r.top > 80 && r.bottom < window.innerHeight - 80;
    });
    return links.length ? links[Math.floor(Math.random() * links.length)] : null;
  }

  function waitForCondition(fn, timeoutMs) {
    return new Promise((res) => {
      if (fn()) return res(true);
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (fn() || Date.now() - t0 > timeoutMs) {
          clearInterval(iv);
          res(!!fn());
        }
      }, 200);
    });
  }

  function go(url) {
    try { location.assign(url); } catch (_) {}
  }

  // Stop the instant X challenges the session. Pushing through a captcha /
  // verification is exactly what escalates a flag into a suspension, so we halt
  // on the first sign: a challenge URL, or a Cloudflare/Arkose human-check frame.
  function isChallenged() {
    if (/^\/(i\/flow|account\/access|login|logout|suspended)/.test(location.pathname)) return true;
    try {
      if (
        document.querySelector(
          'iframe[src*="challenges.cloudflare.com"], iframe[src*="arkoselabs"], iframe[title*="human" i]'
        )
      )
        return true;
    } catch (_) {}
    return false;
  }

  function onTrendingTab() {
    return location.pathname.startsWith("/explore");
  }

  // Read the rendered trend terms (the Explore → Trending cells). Markup-
  // dependent — this is a maintenance point (like the GraphQL extractor). Each
  // becomes a plain search, exactly like clicking the trend: /search?q=<term>.
  async function readTrends(limit) {
    await waitFor('[data-testid="trend"]', 8000);
    const out = [], seen = new Set();
    document.querySelectorAll('[data-testid="trend"]').forEach((el) => {
      const name = pickTrendName((el.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean));
      if (!name) return;
      const url = `https://x.com/search?q=${encodeURIComponent(name)}&src=trend_click`;
      if (seen.has(url)) return;
      seen.add(url);
      out.push({ label: name, url });
    });
    return out.slice(0, limit);
  }

  // A trend cell shows ~3 lines: a category ("… · Trending" / "Trending in …"),
  // the short trend term, and a post count. Drop the boilerplate, then take the
  // first SHORT remaining line — the term. The length cap rejects the long
  // headlines of curated news/event cards (which aren't usable as searches).
  function pickTrendName(lines) {
    const drop = /(trending|^promoted$|posts$|^\d[\d.,]*\s*(k|m)?$|^·|^\d+$)/i;
    const cand = lines.filter((l) => l && !drop.test(l));
    return cand.find((l) => l.length <= 50) || null;
  }

  function waitFor(sel, timeoutMs) {
    return new Promise((res) => {
      if (document.querySelector(sel)) return res(true);
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (document.querySelector(sel) || Date.now() - t0 > timeoutMs) {
          clearInterval(iv);
          res(!!document.querySelector(sel));
        }
      }, 400);
    });
  }

  async function stop(reason) {
    aborted = true;
    const run = (await getLocal(RUN_KEY)) || {};
    run.running = false;
    run.reason = reason;
    run.stoppedAt = Date.now();
    await setRun(run);
    removeBadge();
  }

  function currentLabel(run, cfg) {
    if (cfg.mode === "current") return "this page";
    const item = run.queue && run.queue[run.idx];
    return item ? item.label : "…";
  }

  // Always-visible abort affordance (the popup closes on each navigation).
  function showBadge(label) {
    let b = document.getElementById(BADGE_ID);
    if (!b) {
      b = document.createElement("div");
      b.id = BADGE_ID;
      b.style.cssText =
        "position:fixed;z-index:2147483647;top:10px;right:10px;background:#1d9bf0;" +
        "color:#fff;font:600 12px/1 -apple-system,BlinkMacSystemFont,sans-serif;" +
        "padding:9px 13px;border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,.35);" +
        "cursor:pointer;user-select:none;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      b.title = "Click to stop Zeezeef autopilot";
      b.addEventListener("click", () => { aborted = true; stop("stopped from on-page button"); });
      document.documentElement.appendChild(b);
    }
    b.textContent = `■ Stop autopilot — ${label}`;
  }
  function removeBadge() {
    const b = document.getElementById(BADGE_ID);
    if (b) b.remove();
  }
})();
