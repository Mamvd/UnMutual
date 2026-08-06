/* test-x.js — headless smoke tests for the X (Twitter) bookmarklet (script-x.js).
 *
 *   node test-x.js
 *
 * Stubs a minimal DOM / storage / fetch and drives the real app logic:
 * boot, scanning (following + followers), filtering, throttle handling, cancel,
 * caps, unfollow. The last test executes the minified output end-to-end.
 */
"use strict";

const vm = require("vm");
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "script-x.js"), "utf8");
const { minify } = require("./build.js");

/* ---------------- minimal DOM stubs ---------------- */
function makeClassList() {
  const set = new Set();
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    toggle: (c) => (set.has(c) ? set.delete(c) : set.add(c)),
    contains: (c) => set.has(c),
  };
}

const registry = new Map();

function makeEl(id) {
  const el = {
    id: id || "",
    _html: "",
    children: [],
    style: { setProperty() {} },
    dataset: {},
    classList: makeClassList(),
    value: "",
    files: null,
    checked: false,
    textContent: "",
    parentNode: null,
    set innerHTML(v) {
      this._html = String(v);
    },
    get innerHTML() {
      return this._html;
    },
    appendChild(c) {
      c.parentNode = this;
      this.children.push(c);
      return c;
    },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i !== -1) this.children.splice(i, 1);
      c.parentNode = null;
    },
    insertAdjacentHTML(pos, html) {
      if (pos === "beforeend") this._html += String(html);
    },
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    closest() {
      return null;
    },
    focus() {},
    select() {},
    click() {},
  };
  if (id) registry.set(id, el);
  return el;
}

const document = {
  title: "",
  body: makeEl("body"),
  head: makeEl("head"),
  documentElement: { style: { setProperty() {} } },
  cookie: "auth_token=auth123; twid=u%3D123456; ct0=tok123;",
  createElement: () => makeEl(),
  createTextNode: (t) => ({ textContent: String(t) }),
  addEventListener() {},
  removeEventListener() {},
  execCommand: () => false,
  getElementById: (id) => {
    if (!registry.has(id)) registry.set(id, makeEl(id));
    return registry.get(id);
  },
};

/* ---------------- storage stub ---------------- */
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

/* Seed settings: instant pacing + high caps so tests run fast. */
store.set(
  "unmutual.x.v2.settings",
  JSON.stringify({
    pageDelayMean: 0,
    pageDelaySpread: 0,
    burstSize: 0,
    restMean: 0,
    restSpread: 0,
    cooldownEvery: 0,
    cooldownMean: 0,
    cooldownSpread: 0,
    maxScanPages: 100,
    maxScansPerDay: 100,
    minMinutesBetweenScans: 0,
    pageSize: 3,
    persistSnapshot: true,
    accent: "twitter",
    copyFormat: "username",
  }),
);

/* ---------------- sandbox ---------------- */
let fetchImpl = null;

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Date,
  Math,
  JSON,
  Promise,
  Map,
  Set,
  Array,
  Object,
  String,
  Number,
  Boolean,
  encodeURIComponent,
  decodeURIComponent,
  alert: (m) => console.log("[alert]", m),
  confirm: () => true,
  document,
  localStorage,
  location: { hostname: "x.com" },
  navigator: { clipboard: { writeText: async () => {} } },
  addEventListener() {},
  removeEventListener() {},
  fetch: (url, opts) =>
    fetchImpl
      ? fetchImpl(url, opts)
      : Promise.reject(new Error("no fetch stub")),
  Blob: class {
    constructor(parts) {
      this.parts = parts;
    }
  },
  URL: { createObjectURL: () => "blob:stub", revokeObjectURL: () => {} },
  FileReader: class {
    readAsText() {}
  },
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(SRC, sandbox);

const app = sandbox.__UNM_APP__;
if (!app) {
  console.error("✖ App did not boot (window.__UNM_APP__ missing)");
  process.exit(1);
}
const S = app.state;

/* ---------------- fake X following + followers REST endpoints ---------------- */
// Following list: 8 users, even indices follow you back (mutuals), odd ones don't.
const USERNAMES = [
  "alice",
  "bob",
  "carol",
  "dave",
  "erin",
  "frank",
  "grace",
  "heidi",
];
// Followers list: the 4 mutuals (alice, carol, erin, grace) plus 3 followers you
// do NOT follow back (zoe, quin, rex) — the "don't follow back" category.
const FOLLOWER_ONLY = ["zoe", "quin", "rex"];
const FOLLOWING_TOTAL = USERNAMES.length; // 8
const FOLLOWERS_TOTAL = 4 + FOLLOWER_ONLY.length; // 7
const TOTAL = FOLLOWING_TOTAL + FOLLOWER_ONLY.length; // 11 unique after merge
const FBY = FOLLOWERS_TOTAL;

function followingUserObj(i) {
  return {
    id_str: String(1000 + i),
    screen_name: USERNAMES[i],
    name: USERNAMES[i][0].toUpperCase() + USERNAMES[i].slice(1) + " " + i,
    verified: i === 0,
    protected: i === 1,
    profile_image_url_https:
      i === 7 ? "https://pbs.twimg.com/default" : "https://pbs.twimg.com/a" + i,
    following: true, // you follow them
    followed_by: i % 2 === 0, // they follow you back (mutual)
  };
}

function followerUserObj(k) {
  if (k < 4) {
    // The mutuals, as seen from the followers side (you follow them back).
    const n = followingUserObj(k * 2); // 0,2,4,6 -> alice, carol, erin, grace
    return { ...n, followed_by: true };
  }
  const name = FOLLOWER_ONLY[k - 4];
  return {
    id_str: String(9000 + k),
    screen_name: name,
    name: name[0].toUpperCase() + name.slice(1),
    verified: false,
    protected: false,
    profile_image_url_https: "https://pbs.twimg.com/f" + k,
    following: false, // you don't follow them back
    followed_by: true, // they follow you
  };
}

function makeGoodFetch() {
  return (url) => {
    const u = String(url);
    const isFol = u.indexOf("followers/list.json") !== -1;
    let start = 0;
    try {
      const q = u.indexOf("?") !== -1 ? u.split("?")[1] : "";
      const m = /[?&]cursor=([^&]*)/.exec(q);
      if (m) start = Number(decodeURIComponent(m[1]).replace("cursor-", ""));
    } catch (e) {}
    const size = 3;
    const total = isFol ? FOLLOWERS_TOTAL : FOLLOWING_TOTAL;
    const slice = [];
    for (let i = start; i < Math.min(total, start + size); i++)
      slice.push(isFol ? followerUserObj(i) : followingUserObj(i));
    const end = start + size;
    return Promise.resolve({
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            users: slice,
            next_cursor_str: end < total ? "cursor-" + end : "0",
          }),
        ),
    });
  };
}

/* Fake unfollow endpoint: mode "ok" | "throttle" | "fail" | "loginwall". */
let lastUnfollow = null;
function makeUnfollowFetch(mode) {
  const graph = makeGoodFetch();
  return (url, opts) => {
    if (String(url).indexOf("/friendships/destroy.json") !== -1) {
      lastUnfollow = { url: String(url), opts: opts || {} };
      if (mode === "throttle") {
        return Promise.resolve({
          status: 429,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                errors: [{ code: 88, message: "Rate limit exceeded" }],
                retry_after: 30,
              }),
            ),
        });
      }
      if (mode === "fail") {
        return Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({ errors: [{ code: 50, message: "User not found." }] }),
            ),
        });
      }
      if (mode === "loginwall") {
        return Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({ errors: [{ code: 64, message: "Could not authenticate you." }] }),
            ),
        });
      }
      return Promise.resolve({
        status: 200,
        text: () =>
          Promise.resolve(JSON.stringify({ id_str: "1001", screen_name: "bob" })),
      });
    }
    return graph(url, opts);
  };
}

/* Poll until cond() is truthy or timeout. */
function waitFor(cond, timeout = 5000, what = "condition") {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      if (cond()) return resolve();
      if (Date.now() - t0 > timeout)
        return reject(new Error("timeout waiting for " + what));
      setTimeout(poll, 10);
    })();
  });
}

/* Fresh mini environment for executing the MINIFIED build end-to-end. */
function makeMiniEnv(min) {
  const reg = new Map();
  function makeEl(id) {
    const el = {
      id: id || "",
      _html: "",
      children: [],
      style: { setProperty() {} },
      dataset: {},
      classList: makeClassList(),
      value: "",
      files: null,
      checked: false,
      textContent: "",
      parentNode: null,
      set innerHTML(v) {
        this._html = String(v);
      },
      get innerHTML() {
        return this._html;
      },
      appendChild(c) {
        c.parentNode = this;
        this.children.push(c);
        return c;
      },
      removeChild(c) {
        const i = this.children.indexOf(c);
        if (i !== -1) this.children.splice(i, 1);
      },
      insertAdjacentHTML(pos, html) {
        if (pos === "beforeend") this._html += String(html);
      },
      setAttribute() {},
      addEventListener() {},
      removeEventListener() {},
      closest() {
        return null;
      },
      focus() {},
      select() {},
      click() {},
    };
    if (id) reg.set(id, el);
    return el;
  }
  const doc = {
    title: "",
    body: makeEl("body"),
    head: makeEl("head"),
    documentElement: { style: { setProperty() {} } },
    cookie: "auth_token=auth123; twid=u%3D123456; ct0=tok123;",
    createElement: () => makeEl(),
    createTextNode: () => ({}),
    addEventListener() {},
    removeEventListener() {},
    execCommand: () => false,
    getElementById: (id) =>
      reg.has(id) ? reg.get(id) : (reg.set(id, makeEl(id)), reg.get(id)),
  };
  const st = new Map();
  st.set(
    "unmutual.x.v2.settings",
    JSON.stringify({
      pageDelayMean: 0,
      pageDelaySpread: 0,
      burstSize: 0,
      restMean: 0,
      restSpread: 0,
      cooldownEvery: 0,
      cooldownMean: 0,
      cooldownSpread: 0,
      maxScanPages: 100,
      maxScansPerDay: 100,
      minMinutesBetweenScans: 0,
      pageSize: 3,
      persistSnapshot: true,
      accent: "twitter",
      copyFormat: "username",
    }),
  );
  const ls = {
    getItem: (k) => (st.has(k) ? st.get(k) : null),
    setItem: (k, v) => st.set(k, String(v)),
    removeItem: (k) => st.delete(k),
    clear: () => st.clear(),
  };
  const unf = makeUnfollowFetch("ok");
  const sb = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Math,
    JSON,
    Promise,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    encodeURIComponent,
    decodeURIComponent,
    alert: () => {},
    confirm: () => true,
    document: doc,
    localStorage: ls,
    location: { hostname: "x.com" },
    navigator: { clipboard: { writeText: async () => {} } },
    addEventListener() {},
    removeEventListener() {},
    fetch: (u, o) => unf(u, o),
    Blob: class {},
    URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => {} },
    FileReader: class {
      readAsText() {}
    },
  };
  sb.window = sb;
  sb.self = sb;
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(min, sb);
  return sb;
}

/* ---------------- tiny test harness ---------------- */
let pass = 0,
  fail = 0;
function t(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("  ✔ " + name);
  } else {
    fail++;
    console.error("  ✖ " + name + (extra ? " — " + extra : ""));
  }
}

(async () => {
  console.log("Test: boot");
  t(
    "page title set",
    document.title.indexOf("X") !== -1,
    document.title,
  );
  t(
    "app rendered (tabs present)",
    registry.get("um-tabs")._html.indexOf("All") !== -1,
  );
  t("state status is initial", S.status === "initial");
  t("settings loaded from storage (pageSize 3)", S.settings.pageSize === 3);
  t("default accent is twitter", S.settings.accent === "twitter");

  console.log("Test: utils");
  t(
    "getUserId from twid cookie",
    app.utils.getUserId() === "123456",
    String(app.utils.getUserId()),
  );
  t(
    "getCookie reads ct0",
    app.utils.getCookie("ct0") === "tok123",
  );
  t("randHuman(0) is 0", app.utils.randHuman(0, 0) === 0);
  const d = app.utils.randHuman(1000, 200);
  t("randHuman stays in human bounds", d >= 350 && d <= 2600, String(d));
  const nf = app.utils.normalizeUser({
    screen_name: "x",
    followed_by: false,
  });
  t(
    "normalizeUser: non-mutual",
    nf.isMutual === false && nf.unknown === false && nf.inFollowing === true,
  );
  const nfol = app.utils.normalizeUser(
    { screen_name: "z", following: false },
    "followers",
  );
  t(
    "normalizeUser: followers side marks inFollowers",
    nfol.inFollowers === true && nfol.inFollowing === false && nfol.isMutual === false,
  );
  const nu = app.utils.normalizeUser({ screen_name: "y" });
  t("normalizeUser: unknown when flag missing", nu.unknown === true);
  t("esc escapes HTML", app.utils.esc("<b>&") === "&lt;b&gt;&amp;");
  const url = app.utils.buildFollowingUrl("123", "c1");
  t(
    "following url uses friendships/list.json",
    url.indexOf("friendships/list.json") !== -1,
    url,
  );
  t("url has user_id", url.indexOf("user_id=123") !== -1);
  t("url has page size", url.indexOf("count=3") !== -1);
  t("url has cursor", url.indexOf("cursor=c1") !== -1);
  const furl = app.utils.buildFollowersUrl("123");
  t(
    "followers url uses followers/list.json",
    furl.indexOf("followers/list.json") !== -1,
  );
  const th = app.utils.detectThrottle(429, "", {
    errors: [{ code: 88, message: "Rate limit exceeded" }],
    retry_after: 30,
  });
  t(
    "detectThrottle flags 429 with retryAfter",
    th && th.reason.indexOf("Rate limit exceeded") !== -1 && th.retryAfter === 30,
    JSON.stringify(th),
  );
  const th64 = app.utils.detectThrottle(200, "", {
    errors: [{ code: 64, message: "Could not authenticate you." }],
  });
  t(
    "detectThrottle code 64 is non-resumable",
    th64 && th64.resumable === false,
    JSON.stringify(th64),
  );
  t(
    "detectThrottle ignores 200 ok",
    app.utils.detectThrottle(200, "{}", { users: [] }) === null,
  );

  console.log("Test: scan (both lists)");
  fetchImpl = makeGoodFetch();
  await app.scan();
  t("scan loads all unique users", S.users.length === TOTAL, String(S.users.length));
  t("status ready", S.status === "ready");
  t("following count tracked", S.countTotal === FOLLOWING_TOTAL, String(S.countTotal));
  t("followers count tracked", S.followersCount === FBY, String(S.followersCount));
  const muts = S.users.filter((u) => u.isMutual).length;
  const nons = S.users.filter((u) => u.inFollowing !== false && !u.isMutual && !u.unknown).length;
  const dnbs = S.users.filter((u) => u.inFollowers === true && !u.isMutual && !u.unknown).length;
  t("4 mutuals", muts === 4, String(muts));
  t("4 non-followers", nons === 4, String(nons));
  t("3 don't-follow-back", dnbs === 3, String(dnbs));
  t("merged mutuals flagged on both sides", S.users.filter((u) => u.isMutual && u.inFollowers && u.inFollowing).length === 4);
  t("history recorded", S.history.length === 1 && S.history[0].kind === "done");
  t("snapshot saved", store.has("unmutual.x.v2.snapshot"));
  t(
    "results rendered",
    registry.get("um-results")._html.indexOf("alice") !== -1,
  );

  console.log("Test: snapshot restore");
  S.users = [];
  S.countTotal = null;
  S.followersCount = null;
  S.snapshot = JSON.parse(store.get("unmutual.x.v2.snapshot"));
  app.actions["restore-snapshot"]();
  t(
    "snapshot restore loads users",
    S.users.length === TOTAL && S.status === "ready",
    String(S.users.length),
  );
  t("snapshot cleared after restore", S.snapshot === null);

  console.log("Test: XSS escaping in rendered rows");
  S.users.push({
    id: "9999",
    username: "xssuser",
    fullName: "<img src=x onerror=alert(1)>",
    isVerified: false,
    isPrivate: false,
    avatar: "",
    isMutual: false,
    unknown: false,
  });
  app.render();
  const rowsHtml = registry.get("um-results")._html;
  t(
    "full_name is escaped in row HTML",
    rowsHtml.indexOf("&lt;img") !== -1 &&
      rowsHtml.indexOf("<img src=x onerror") === -1,
    rowsHtml.slice(0, 160),
  );
  S.users.pop();
  app.render();

  console.log("Test: copy / filters");
  const nonList = S.users.filter(
    (u) => u.inFollowing !== false && !u.isMutual && !u.unknown,
  );
  t(
    "non-follower usernames copy",
    app.utils.getCopyText(nonList, "username") === "bob\ndave\nfrank\nheidi",
  );
  const csv = app.utils.getCopyText(nonList, "csv");
  t(
    "csv starts with header",
    csv.split("\n")[0] === "username,full_name,private,verified,follows_back",
  );
  t(
    "nameuser format",
    app.utils.getCopyText(
      [{ username: "bob", fullName: "Bob" }],
      "nameuser",
    ) === "Bob (@bob)",
  );

  console.log("Test: search / tabs / sort");
  S.tab = "all";
  S.search = "a";
  const hits = app.utils.getFiltered().length;
  t("search 'a' matches 5", hits === 5, String(hits));
  S.search = "";
  S.tab = "nonfollowers";
  t("nonfollowers tab filtered", app.utils.getFiltered().length === 4);
  S.tab = "dontfollowback";
  t(
    "dont-follow-back tab filtered",
    app.utils.getFiltered().length === 3,
    String(app.utils.getFiltered().length),
  );
  S.tab = "all";
  S.sort = "az";
  const sorted = app.utils.getFiltered().map((u) => u.username);
  t(
    "sort az works",
    sorted[0] === "alice" && sorted[sorted.length - 1] === "zoe",
    sorted.join(","),
  );
  S.sort = "default";

  console.log("Test: selection");
  S.selected = new Set(["alice", "bob"]);
  const selCount = S.users.filter((u) => S.selected.has(u.username)).length;
  t("selection tracked", selCount === 2);
  S.selected.clear();

  console.log("Test: throttle handling");
  fetchImpl = () =>
    Promise.resolve({
      status: 429,
      text: () =>
        Promise.resolve(
          JSON.stringify({ errors: [{ code: 88, message: "Rate limit exceeded" }], retry_after: 30 }),
        ),
    });
  await app.scan();
  t("status becomes throttled", S.status === "throttled", S.status);
  t(
    "throttle reason recorded",
    S.throttle && S.throttle.reason.indexOf("Rate limit exceeded") !== -1,
  );
  const bannerHtml = registry.get("um-banner")._html;
  t(
    "rate-limit banner with resume",
    bannerHtml.indexOf("rate-limiting") !== -1 &&
      bannerHtml.indexOf("resume") !== -1,
    bannerHtml.slice(0, 80),
  );
  t(
    "throttled attempt recorded",
    S.history[0] && S.history[0].kind === "throttled",
  );
  fetchImpl = makeGoodFetch();
  await app.scan(true);
  t(
    "resume completes scan",
    S.status === "ready" && S.users.length === TOTAL,
    S.status + " / " + S.users.length,
  );

  console.log("Test: login wall (non-JSON response)");
  fetchImpl = () =>
    Promise.resolve({
      status: 200,
      text: () => Promise.resolve("<html><body>Please log in</body></html>"),
    });
  await app.scan();
  t("login wall stops the scan", S.status === "throttled", S.status);
  const lb = registry.get("um-banner")._html;
  t(
    "login wall banner has no Resume and explains",
    lb.indexOf("resume") === -1 && lb.indexOf("HTML page") !== -1,
    lb.slice(0, 120),
  );
  t(
    "non-resumable error recorded",
    S.history[0] && S.history[0].kind === "error",
  );

  console.log("Test: cancel");
  fetchImpl = makeGoodFetch();
  S.settings.pageDelayMean = 400;
  const p = app.scan();
  await new Promise((r) => setTimeout(r, 450));
  S.cancel = true;
  await p;
  t(
    "cancel keeps partial results",
    S.users.length > 0 && S.users.length < TOTAL,
    String(S.users.length),
  );
  t("cancel ends in ready state", S.status === "ready");
  S.settings.pageDelayMean = 0;

  console.log("Test: page cap");
  S.settings.maxScanPages = 2;
  await app.scan();
  t(
    "page cap stops scan with partial data",
    S.users.length === 9,
    String(S.users.length),
  );
  t(
    "followers counted even when capped",
    S.followersCount === 6,
    String(S.followersCount),
  );
  t(
    "capped recorded in history",
    S.history[0] && S.history[0].kind === "capped",
  );
  S.settings.maxScanPages = 100;

  console.log("Test: not logged in (no twid cookie)");
  const savedCookie = document.cookie;
  // auth_token is HttpOnly and invisible to JS — the gate must be the twid cookie.
  document.cookie = "auth_token=auth123; ct0=tok123;";
  await app.scan();
  t(
    "not-logged-in banner shown when twid missing",
    registry.get("um-banner")._html.indexOf("Not logged in") !== -1,
  );
  document.cookie = savedCookie;

  console.log("Test: session without readable auth_token still scans");
  const savedCookie3 = document.cookie;
  document.cookie = "twid=u%3D123456; ct0=tok123;"; // no auth_token (HttpOnly anyway)
  fetchImpl = makeGoodFetch();
  await app.scan();
  t(
    "scan works via twid alone",
    S.status === "ready" && S.users.length === TOTAL,
    S.status + " / " + S.users.length,
  );
  document.cookie = savedCookie3;

  console.log("Test: daily cap");
  S.settings.maxScansPerDay = 0; // 0 allowed → any history today blocks
  await app.scan();
  const toasts = registry
    .get("um-toasts")
    .children.map((c) => c._html)
    .join(" ");
  t(
    "daily cap blocks scan with toast",
    toasts.indexOf("Daily scan limit") !== -1,
    toasts,
  );
  t("status unchanged after blocked scan", S.status === "ready");
  S.settings.maxScansPerDay = 100;

  console.log("Test: profile links open in new tab");
  fetchImpl = makeGoodFetch();
  await app.scan();
  const rowHtml = registry.get("um-results")._html;
  t(
    "rows link to x.com profiles",
    rowHtml.indexOf("https://x.com/bob/") !== -1,
  );
  t(
    "profile links open in a new tab",
    rowHtml.indexOf('target="_blank"') !== -1 &&
      rowHtml.indexOf('rel="noopener noreferrer"') !== -1,
  );

  // Instant unfollow pacing so tests run fast.
  Object.assign(S.settings, {
    unfollowDelayMean: 0,
    unfollowDelaySpread: 0,
    unfollowBurstSize: 0,
    unfollowRestMean: 0,
    unfollowRestSpread: 0,
    unfollowCooldownEvery: 0,
    unfollowCooldownMean: 0,
    unfollowCooldownSpread: 0,
    maxUnfollowsPerSession: 100,
    maxUnfollowsPerDay: 100,
  });
  S.unfollowsToday = { date: "", count: 0 };

  console.log("Test: unfollow flow");
  fetchImpl = makeUnfollowFetch("ok");
  await app.scan();
  S.selected = new Set(["bob", "dave", "frank"]); // all non-followers (odd indices)
  app.actions["unfollow-selected"]();
  t(
    "confirm dialog shows breakdown",
    registry.get("um-modal")._html.indexOf("Confirm unfollow") !== -1,
  );
  t(
    "pending list matches selection",
    S.pendingUnfollow.length === 3,
    String(S.pendingUnfollow.length),
  );
  app.actions["confirm-unfollow"]();
  await waitFor(
    () => S.status === "ready" && S.unfollowQueue.length === 0,
    5000,
    "unfollow done",
  );
  t(
    "unfollowed users removed from list",
    !S.users.some((u) => u.username === "bob"),
    S.users.map((u) => u.username).join(","),
  );
  t("remaining users kept", S.users.length === 8, String(S.users.length));
  t(
    "daily counter incremented",
    S.unfollowsToday.count === 3,
    String(S.unfollowsToday.count),
  );
  const persisted = JSON.parse(store.get("unmutual.x.v2.unfollows"));
  t(
    "counter persisted to storage",
    persisted.count === 3 &&
      persisted.date === new Date().toISOString().slice(0, 10),
  );
  t(
    "destroy call uses the right endpoint with csrf",
    lastUnfollow &&
      lastUnfollow.url.indexOf(
        "https://x.com/i/api/1.1/friendships/destroy.json?user_id=",
      ) !== -1 &&
      lastUnfollow.opts.headers["x-csrf-token"] === "tok123",
    lastUnfollow ? lastUnfollow.url : "no POST",
  );
  const unfToasts = registry
    .get("um-toasts")
    .children.map((c) => c._html)
    .join(" ");
  t("completion toast", unfToasts.indexOf("3 unfollowed") !== -1, unfToasts);

  console.log("Test: unfollow throttled + resume");
  S.unfollowsToday = { date: "", count: 0 };
  fetchImpl = makeUnfollowFetch("throttle");
  await app.scan();
  S.selected = new Set(["bob", "dave"]);
  app.actions["unfollow-selected"]();
  app.actions["confirm-unfollow"]();
  await waitFor(() => S.status === "throttled", 5000, "unfollow throttle");
  t(
    "unfollow pauses on rate limit",
    S.status === "throttled" && S.mode === "unfollow",
  );
  t("throttle is resumable", S.throttle && S.throttle.resumable !== false);
  t(
    "resume button shown",
    registry.get("um-resume-btn").style.display !== "none",
  );
  fetchImpl = makeUnfollowFetch("ok");
  app.actions["resume"]();
  await waitFor(() => S.status === "ready", 5000, "unfollow resume");
  t(
    "resume finishes the rest",
    S.unfollowsToday.count === 2,
    String(S.unfollowsToday.count),
  );

  console.log("Test: unfollow daily cap");
  S.unfollowsToday = { date: new Date().toISOString().slice(0, 10), count: 99 };
  S.settings.maxUnfollowsPerDay = 100;
  fetchImpl = makeUnfollowFetch("ok");
  await app.scan();
  S.selected = new Set(["bob", "dave", "frank"]);
  app.actions["unfollow-selected"]();
  app.actions["confirm-unfollow"]();
  const capToasts = registry
    .get("um-toasts")
    .children.map((c) => c._html)
    .join(" ");
  t(
    "partial daily cap blocks overflow",
    capToasts.indexOf("Only 1 of the 3 selected accounts") !== -1,
    capToasts,
  );
  t(
    "no unfollow started",
    S.status !== "unfollowing" && S.unfollowQueue.length === 0,
  );
  // Fully reached cap → hard block.
  S.unfollowsToday = {
    date: new Date().toISOString().slice(0, 10),
    count: 100,
  };
  S.selected = new Set(["bob", "dave"]);
  app.actions["unfollow-selected"]();
  app.actions["confirm-unfollow"]();
  const capToasts2 = registry
    .get("um-toasts")
    .children.map((c) => c._html)
    .join(" ");
  t(
    "reached cap hard-blocks",
    capToasts2.indexOf("Daily unfollow limit reached") !== -1,
    capToasts2,
  );
  S.unfollowsToday = { date: "", count: 0 };
  S.settings.maxUnfollowsPerDay = 100;

  console.log("Test: unfollow blocked without ct0");
  const savedCookie2 = document.cookie;
  document.cookie = "auth_token=auth123; twid=u%3D123456;";
  fetchImpl = makeUnfollowFetch("ok");
  await app.scan();
  S.selected = new Set(["bob"]);
  app.actions["unfollow-selected"]();
  app.actions["confirm-unfollow"]();
  const csrfToasts = registry
    .get("um-toasts")
    .children.map((c) => c._html)
    .join(" ");
  t(
    "missing ct0 blocks unfollow",
    csrfToasts.indexOf("ct0") !== -1,
    csrfToasts,
  );
  t("status unchanged", S.status === "ready" && S.unfollowsToday.count === 0);
  document.cookie = savedCookie2;

  console.log("Test: unfollow-user (per-row action)");
  fetchImpl = makeUnfollowFetch("ok");
  await app.scan();
  app.actions["unfollow-user"]("heidi");
  t(
    "per-row unfollow opens confirm for that user",
    S.pendingUnfollow.length === 1 && S.pendingUnfollow[0].username === "heidi",
  );
  app.actions["modal-close"]();

  console.log("Test: don't-follow-back users can't be unfollowed");
  // zoe is a follower you don't follow back (inFollowing === false).
  S.selected = new Set(["zoe", "dave"]);
  app.actions["unfollow-selected"]();
  t(
    "non-followed account excluded from unfollow",
    S.pendingUnfollow.length === 1 && S.pendingUnfollow[0].username === "dave",
  );
  t(
    "excluded count shown in dialog",
    registry.get("um-modal")._html.indexOf("you don't follow were excluded") !==
      -1,
  );
  app.actions["modal-close"]();
  S.pendingUnfollow = null;
  app.actions["unfollow-user"]("zoe");
  t("per-row unfollow hidden for non-followed", S.pendingUnfollow === null);

  console.log("Test: non-resumable unfollow pause");
  S.unfollowsToday = { date: "", count: 0 };
  fetchImpl = makeUnfollowFetch("loginwall");
  await app.scan();
  S.selected = new Set(["bob", "dave"]);
  app.actions["unfollow-selected"]();
  app.actions["confirm-unfollow"]();
  await waitFor(() => S.status === "throttled", 5000, "non-resumable pause");
  t(
    "login-wall pause is non-resumable",
    S.throttle && S.throttle.resumable === false,
  );
  t(
    "no Resume in progress bar",
    registry.get("um-resume-btn").style.display === "none",
  );
  const preBanner = registry.get("um-banner")._html;
  t(
    "banner has no Resume action",
    preBanner.indexOf('data-act="resume"') === -1,
  );
  app.actions["resume"]();
  const nrToasts = registry
    .get("um-toasts")
    .children.map((c) => c._html)
    .join(" ");
  t(
    "resume rejected for non-resumable",
    nrToasts.indexOf("not resumable") !== -1,
    nrToasts,
  );
  t("still paused after rejected resume", S.status === "throttled");
  // Reset manually: non-resumable pause has no in-app escape hatch.
  S.status = "ready";
  S.mode = "scan";
  S.throttle = null;
  S.forcedBanner = null;
  S.unfollowQueue = [];
  S.unfollowIndex = 0;
  S.cancel = false;

  console.log("Test: unfollow blocked while scan throttled");
  fetchImpl = (url) => {
    if (String(url).indexOf("cursor-3") !== -1) {
      return Promise.resolve({
        status: 429,
        text: () =>
          Promise.resolve(
            JSON.stringify({ errors: [{ code: 88, message: "Rate limit exceeded" }] }),
          ),
      });
    }
    return makeGoodFetch()(url);
  };
  await app.scan();
  await waitFor(() => S.status === "throttled", 5000, "scan throttle");
  t("scan paused", S.status === "throttled" && S.mode === "scan");
  S.selected = new Set(["bob"]);
  app.actions["unfollow-selected"]();
  app.actions["confirm-unfollow"]();
  const hijackToasts = registry
    .get("um-toasts")
    .children.map((c) => c._html)
    .join(" ");
  t(
    "unfollow refused while scan paused",
    S.status === "throttled" &&
      S.mode === "scan" &&
      hijackToasts.indexOf("Resolve the paused scan") !== -1,
    hijackToasts,
  );
  S.status = "ready";
  S.throttle = null;
  S.forcedBanner = null;
  S.pendingUnfollow = null;

  console.log("Test: unfollow recorded in history");
  S.unfollowsToday = { date: "", count: 0 };
  fetchImpl = makeUnfollowFetch("ok");
  await app.scan();
  S.selected = new Set(["bob"]);
  app.actions["unfollow-selected"]();
  app.actions["confirm-unfollow"]();
  await waitFor(
    () => S.status === "ready" && S.unfollowQueue.length === 0,
    5000,
    "unfollow done",
  );
  t(
    "history records unfollow kind",
    S.history[0] && S.history[0].kind === "unfollow",
  );
  t(
    "history summary text",
    S.history[0] && S.history[0].warn.indexOf("1 unfollowed") !== -1,
    S.history[0] && S.history[0].warn,
  );
  app.actions["history-open"]();
  const histHtml = registry.get("um-modal")._html;
  t(
    "history modal renders unfollow summary",
    histHtml.indexOf("ig-h-sum") !== -1 || histHtml.indexOf("unfollow") !== -1,
    histHtml.slice(0, 200),
  );
  app.actions["modal-close"]();

  console.log("Test: unfollow doesn't consume a scan slot");
  const safetyHtml = registry.get("um-safety")._html;
  const scanKinds = S.history.filter(
    (h) =>
      h.kind === "done" ||
      h.kind === "capped" ||
      h.kind === "cancelled" ||
      h.kind === "throttled" ||
      h.kind === "error",
  ).length;
  t(
    "scans-today excludes unfollow history",
    S.history.some((h) => h.kind === "unfollow") &&
      safetyHtml.indexOf(
        scanKinds + " / " + S.settings.maxScansPerDay,
      ) !== -1,
    safetyHtml.slice(0, 160),
  );

  console.log("Test: boot guard (wrong hostname)");
  sandbox.location.hostname = "example.com";
  vm.runInContext(SRC, sandbox); // must not throw

  console.log("Test: minified build executes");
  const min = minify(SRC);
  const mb = makeMiniEnv(min);
  const mapp = mb.__UNM_APP__;
  t("minified app boots", !!mapp && mapp.state.status === "initial");
  await mapp.scan();
  t(
    "minified scan loads all users",
    mapp.state.users.length === TOTAL,
    String(mapp.state.users.length),
  );
  // Unfollow smoke: proves the minifier keeps the unfollow path semantically intact.
  Object.assign(mapp.state.settings, {
    unfollowDelayMean: 0,
    unfollowDelaySpread: 0,
    unfollowBurstSize: 0,
    unfollowRestMean: 0,
    unfollowRestSpread: 0,
    unfollowCooldownEvery: 0,
    unfollowCooldownMean: 0,
    unfollowCooldownSpread: 0,
    maxUnfollowsPerSession: 100,
    maxUnfollowsPerDay: 100,
  });
  mapp.state.unfollowsToday = { date: "", count: 0 };
  mapp.state.selected = new Set(["bob", "dave"]);
  mapp.actions["unfollow-selected"]();
  mapp.actions["confirm-unfollow"]();
  await waitFor(
    () =>
      mapp.state.status === "ready" && mapp.state.unfollowQueue.length === 0,
    5000,
    "minified unfollow",
  );
  t(
    "minified unfollow works",
    mapp.state.unfollowsToday.count === 2 &&
      !mapp.state.users.some((u) => u.username === "bob"),
    String(mapp.state.unfollowsToday.count),
  );

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("✖ Unhandled test error:", e);
  process.exit(1);
});
