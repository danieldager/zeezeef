// Unit tests for the extractor, runnable with `npm test` (node --test).
// Fixtures are synthetic but mirror real X GraphQL response shapes — see
// fixtures/README.md for how to replace them with real captures.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { extractTweets, opName, topicFromUrl, unwrapTweet, resolveText, screenName } =
  require("../extractor.js");

function load(name) {
  const p = path.join(__dirname, "..", "fixtures", name);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function byId(tweets) {
  const m = new Map();
  for (const t of tweets) m.set(t.id, t);
  return m;
}

test("home timeline: plain, note, and visibility-wrapped tweets; noise ignored", () => {
  const tweets = extractTweets(load("home_timeline.json"));
  const m = byId(tweets);

  // exactly the three real tweets — not the who-to-follow user, not the cursor
  assert.equal(tweets.length, 3);
  assert.deepEqual([...m.keys()].sort(), ["1001", "1002", "1003"]);

  // plain tweet, screen_name from legacy (older location)
  assert.equal(m.get("1001").full_text, "Hello world from the timeline");
  assert.equal(m.get("1001").screen_name, "alice");
  assert.equal(m.get("1001").lang, "en");
  assert.equal(m.get("1001").conversation_id, "1001");
  assert.equal(m.get("1001").created_at, "Wed Mar 12 09:00:00 +0000 2025");

  // note tweet: must prefer the FULL note text, not the truncated legacy text
  const bob = m.get("1002");
  assert.match(bob.full_text, /^This is the FULL/);
  assert.match(bob.full_text, /legacy boundary\.$/); // full sentence, no ellipsis
  assert.ok(!bob.full_text.includes("…"), "note text must not be truncated");
  assert.equal(bob.screen_name, "bob"); // screen_name from core (newer location)

  // visibility-wrapped tweet with emoji + non-Latin script, fully intact
  const carol = m.get("1003");
  assert.equal(carol.full_text, "你好 🌏 café — emoji and non-Latin script test");
  assert.equal(carol.screen_name, "carol");
  assert.equal(carol.lang, "zh");
});

test("user tweets: retweets resolve to full original text; quotes captured", () => {
  const tweets = extractTweets(load("user_tweets.json"));
  const m = byId(tweets);

  // RT wrapper + inner original + quote wrapper + quoted original = 4
  assert.equal(tweets.length, 4);
  assert.deepEqual([...m.keys()].sort(), ["1999", "2000", "2001", "2002"]);

  const FULL =
    "This is the original but it is going to be cut off because retweets are truncated. Except now it is shown in full.";

  // RT wrapper text is resolved to the original's full text, attributed to the
  // retweeter — never the truncated "RT @user: …" string.
  const rt = m.get("2001");
  assert.equal(rt.full_text, FULL);
  assert.equal(rt.screen_name, "dave");
  assert.ok(!rt.full_text.startsWith("RT @"), "RT prefix must be resolved away");

  // inner original captured under its own id, attributed to the real author
  const orig = m.get("2000");
  assert.equal(orig.full_text, FULL);
  assert.equal(orig.screen_name, "origauthor");

  // quote tweet and the quoted original are both captured, distinctly
  assert.equal(m.get("2002").screen_name, "eve");
  assert.equal(m.get("2002").full_text, "Look at this take 👀 https://t.co/abc123");
  assert.equal(m.get("1999").screen_name, "frank");
  assert.equal(m.get("1999").full_text, "The quoted message that eve is reacting to.");
});

test("search timeline: tombstones skipped; rest_id-only tweets captured", () => {
  const tweets = extractTweets(load("search_timeline.json"));
  const m = byId(tweets);

  assert.equal(tweets.length, 2);
  assert.deepEqual([...m.keys()].sort(), ["3001", "3003"]);
  assert.equal(m.get("3001").screen_name, "grace");
  // matched via rest_id even though __typename is absent
  assert.equal(m.get("3003").screen_name, "heidi");
});

test("thread detail: pin entry + module items[] are all captured", () => {
  // Validates the recursive walk against TimelinePinEntry and the
  // TimelineTimelineModule `items[].item.itemContent` path (which differs from
  // the normal `content.itemContent` path), plus a cursor inside the module.
  const tweets = extractTweets(load("tweet_detail.json"));
  const m = byId(tweets);

  assert.equal(tweets.length, 3);
  assert.deepEqual([...m.keys()].sort(), ["4000", "4001", "4002"]);
  assert.equal(m.get("4000").screen_name, "ivan"); // pin entry, core handle
  assert.equal(m.get("4001").screen_name, "judy"); // normal entry, legacy handle
  assert.equal(m.get("4002").screen_name, "mallory"); // module items[] path
  assert.match(m.get("4002").full_text, /module items\[\] array/);
});

test("dedup within a single response", () => {
  const dup = {
    a: { __typename: "Tweet", rest_id: "9", legacy: { full_text: "once" } },
    b: { __typename: "Tweet", rest_id: "9", legacy: { full_text: "once" } },
  };
  const tweets = extractTweets(dup);
  assert.equal(tweets.length, 1);
  assert.equal(tweets[0].id, "9");
});

test("robust to junk input", () => {
  assert.deepEqual(extractTweets(null), []);
  assert.deepEqual(extractTweets(undefined), []);
  assert.deepEqual(extractTweets(42), []);
  assert.deepEqual(extractTweets("a string"), []);
  assert.deepEqual(extractTweets({}), []);
  assert.deepEqual(extractTweets([]), []);
});

test("opName parses the GraphQL operation name", () => {
  assert.equal(
    opName("https://x.com/i/api/graphql/aBc123-XyZ/HomeTimeline?variables=%7B%7D"),
    "HomeTimeline"
  );
  assert.equal(opName("https://x.com/i/api/graphql/hash/UserTweets"), "UserTweets");
  assert.equal(
    opName("https://x.com/i/api/graphql/hash/SearchTimeline?q=1#frag"),
    "SearchTimeline"
  );
  assert.equal(opName(""), null);
  assert.equal(opName(undefined), null);
  assert.equal(opName("https://x.com/home"), null);
});

test("flags replies/comments via in_reply_to_status_id_str", () => {
  const root = {
    a: { __typename: "Tweet", rest_id: "5", legacy: { full_text: "a reply", in_reply_to_status_id_str: "4" } },
    b: { __typename: "Tweet", rest_id: "6", legacy: { full_text: "top-level post" } },
  };
  const m = byId(extractTweets(root));
  assert.equal(m.get("5").is_reply, true);
  assert.equal(m.get("5").reply_to, "4");
  assert.equal(m.get("6").is_reply, false);
  assert.equal(m.get("6").reply_to, null);
});

test("topicFromUrl extracts the search query a post was collected under", () => {
  assert.equal(topicFromUrl("https://x.com/search?q=Israel&src=trend_click"), "Israel");
  assert.equal(topicFromUrl("https://x.com/search?q=State%20of%20Play&f=live"), "State of Play");
  assert.equal(topicFromUrl("https://x.com/search?q=%23climate"), "#climate");
  assert.equal(topicFromUrl("https://x.com/home"), null);
  assert.equal(topicFromUrl("https://x.com/someuser/status/123"), null);
  assert.equal(topicFromUrl("https://x.com/search?q="), null);
  assert.equal(topicFromUrl(""), null);
  assert.equal(topicFromUrl(undefined), null);
});

test("helpers: unwrapTweet, resolveText, screenName", () => {
  const inner = { __typename: "Tweet", rest_id: "1", legacy: { full_text: "x" } };
  assert.equal(
    unwrapTweet({ __typename: "TweetWithVisibilityResults", tweet: inner }),
    inner
  );
  assert.equal(unwrapTweet(inner), inner);
  assert.equal(unwrapTweet(null), null);

  assert.equal(resolveText({ legacy: { full_text: "short" } }), "short");
  assert.equal(
    resolveText({
      legacy: { full_text: "short" },
      note_tweet: { note_tweet_results: { result: { text: "long" } } },
    }),
    "long"
  );
  assert.equal(resolveText({}), null);

  assert.equal(
    screenName({ core: { user_results: { result: { core: { screen_name: "a" } } } } }),
    "a"
  );
  assert.equal(
    screenName({ core: { user_results: { result: { legacy: { screen_name: "b" } } } } }),
    "b"
  );
  assert.equal(screenName({}), null);
});
