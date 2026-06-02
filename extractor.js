// extractor.js — path-agnostic recursive tweet extraction.
//
// X reshapes the WRAPPER around its data (instruction types, entry kinds,
// cursors, modules, promoted content) far more often than it reshapes the
// Tweet object itself. So instead of hardcoding the path from the root, we
// recursively walk the parsed JSON and pick out any node that looks like a
// Tweet. The Tweet's own shape (rest_id/__typename + legacy.full_text) is the
// stable anchor.
//
// This file is loaded two ways:
//   • in the service worker via importScripts("extractor.js") — functions
//     become worker globals used by background.js;
//   • in Node via require("./extractor.js") for unit tests — see the
//     module.exports guard at the bottom.

// Some results are wrapped: { __typename: "TweetWithVisibilityResults",
// tweet: <Tweet> }. Peel that to reach the real Tweet. (The recursive walk
// would find the inner Tweet anyway; this helper is for resolving embedded
// retweet/quote originals where we hold the wrapper directly.)
function unwrapTweet(result) {
  if (!result || typeof result !== "object") return null;
  if (result.__typename === "TweetWithVisibilityResults" && result.tweet) {
    return result.tweet;
  }
  return result;
}

// Prefer the full "note tweet" text (long posts) over the truncated
// legacy.full_text. Returns null if neither is a usable string.
function resolveText(tweet) {
  if (!tweet || typeof tweet !== "object" || !tweet.legacy) return null;
  const note =
    tweet.note_tweet &&
    tweet.note_tweet.note_tweet_results &&
    tweet.note_tweet.note_tweet_results.result &&
    tweet.note_tweet.note_tweet_results.result.text;
  if (typeof note === "string" && note.length) return note;
  return typeof tweet.legacy.full_text === "string" ? tweet.legacy.full_text : null;
}

// Author handle. X has been migrating user fields out of `legacy` into `core`,
// so screen_name may live in either place depending on deployment — check both.
function screenName(tweet) {
  const r =
    tweet.core && tweet.core.user_results && tweet.core.user_results.result;
  if (!r || typeof r !== "object") return null;
  if (r.core && typeof r.core.screen_name === "string") return r.core.screen_name;
  if (r.legacy && typeof r.legacy.screen_name === "string") return r.legacy.screen_name;
  return null;
}

function extractTweets(root) {
  const out = [];
  const seenLocal = new Set();

  (function walk(node) {
    if (!node || typeof node !== "object") return;

    const looksLikeTweet =
      (node.__typename === "Tweet" || typeof node.rest_id === "string") &&
      node.legacy &&
      typeof node.legacy.full_text === "string";

    if (looksLikeTweet) {
      const id = node.rest_id || node.legacy.id_str;
      if (id && !seenLocal.has(id)) {
        seenLocal.add(id);

        // Retweet wrapper: the wrapper's own full_text is the truncated
        // "RT @user: …" form. Resolve to the embedded original's full text so
        // the dataset carries clean content. The inner original is also walked
        // and captured under its own id (faithful "feed as experienced").
        const rtInner =
          node.legacy.retweeted_status_result &&
          unwrapTweet(node.legacy.retweeted_status_result.result);
        const text = (rtInner ? resolveText(rtInner) : null) || resolveText(node);

        out.push({
          id,
          full_text: text,
          screen_name: screenName(node),
          created_at: node.legacy.created_at || null,
          lang: node.legacy.lang || null,
          conversation_id: node.legacy.conversation_id_str || null,
        });
      }
    }

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i]);
    } else {
      for (const k in node) walk(node[k]);
    }
  })(root);

  return out;
}

// Pull the GraphQL OperationName from the request URL:
//   /i/api/graphql/<query-id-hash>/<OperationName>?variables=...
function opName(url) {
  const m = /\/graphql\/[^/]+\/([^/?#]+)/.exec(url || "");
  return m ? m[1] : null;
}

// The search query a post was collected under — the `q` of a /search page URL
// (for autopilot trending, exactly the trend term we navigated to). null for
// non-search browsing (home, profiles, threads). Decoding is automatic.
function topicFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.pathname === "/search") {
      const q = u.searchParams.get("q");
      return q && q.trim() ? q.trim() : null;
    }
  } catch (_) {}
  return null;
}

// Dual environment: CommonJS (Node tests) gets named exports; the service
// worker (classic importScripts) just sees these as globals and skips this.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { extractTweets, opName, topicFromUrl, unwrapTweet, resolveText, screenName };
}
