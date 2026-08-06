/*!
 * UnMutual — X (Twitter) Follower Insights  (v1.0.0)
 * ---------------------------------------------------
 * A bookmarklet that runs on x.com / twitter.com while you are logged in.
 *
 * What it does:
 *   - Scans YOUR following list AND your followers list (read-only internal
 *     REST requests, the same i/api/1.1 endpoints the X web app uses).
 *   - Flags accounts that do not follow you back ("non-followers") and accounts
 *     you do not follow back ("don't follow back"), plus mutuals — with real
 *     counts of what the scan has seen.
 *   - Lets you search, filter, sort, copy and export everything.
 *   - Unfollow selected accounts — only what you explicitly pick and confirm,
 *     with human-like pacing and session/day caps.
 *
 * What it does NOT do:
 *   - No unattended automation: no unfollow-all, no follow-backs, nothing runs
 *     without your explicit confirmation.
 *   - No data leaves your browser except your own requests to x.com
 *     (read-only scans + the unfollow requests you confirm). No tracking,
 *     no third-party calls, no eval().
 *
 * Safety / anti-detection ("strict" profile):
 *   - Randomized human-like pacing between paginated requests and between
 *     unfollows (never fixed).
 *   - Burst/rest patterns and long cooldowns (a human pauses while browsing).
 *   - Daily scan caps + minimum time between scans; session and daily caps
 *     for unfollows (configurable).
 *   - Automatically pauses if X rate-limits or challenges the request,
 *     and only resumes when you explicitly click Resume.
 *
 * Build:  node build.js   ->  bookmarklet-x.txt (the javascript: URL)
 * Test:   node test-x.js
 */
(function () {
  "use strict";

  var VERSION = "1.0.0";
  // X/Twitter runs on several hostnames; the internal API is reachable from all.
  var X_HOSTNAMES = [
    "x.com",
    "www.x.com",
    "twitter.com",
    "www.twitter.com",
    "mobile.twitter.com",
  ];

  var K = {
    SETTINGS: "unmutual.x.v2.settings",
    HISTORY: "unmutual.x.v2.history",
    SNAPSHOT: "unmutual.x.v2.snapshot",
    UNFOLLOWS: "unmutual.x.v2.unfollows",
  };

  /* ============================================================
   * 1. Defaults (strict pacing profile)
   * ============================================================ */
  var DEFAULTS = {
    pageDelayMean: 2600, // mean delay between page fetches (ms)
    pageDelaySpread: 1100, // variance around the mean
    burstSize: 10, // pages per "burst" before a rest
    restMean: 20000, // rest after a burst (ms)
    restSpread: 8000,
    cooldownEvery: 40, // long cooldown every N pages (0 = off)
    cooldownMean: 120000, // cooldown duration (ms)
    cooldownSpread: 40000,
    maxScanPages: 120, // hard cap on pages per scan
    maxScansPerDay: 6, // daily scan cap (safety rail)
    minMinutesBetweenScans: 15, // cooldown between scans
    pageSize: 50, // users per request (20–200)
    persistSnapshot: true, // remember last scan locally
    accent: "twitter", // theme: twitter | instagram | aurora | ember | mint
    copyFormat: "username", // username | nameuser | csv
    // --- unfollow safety rails (strict profile) ---
    unfollowDelayMean: 4500, // mean delay between unfollows (ms)
    unfollowDelaySpread: 1800, // variance around the mean
    unfollowBurstSize: 5, // unfollows per burst before a rest
    unfollowRestMean: 45000, // rest after a burst (ms)
    unfollowRestSpread: 20000,
    unfollowCooldownEvery: 20, // cooldown every N unfollows (0 = off)
    unfollowCooldownMean: 300000,
    unfollowCooldownSpread: 120000,
    maxUnfollowsPerSession: 100, // hard stop per session
    maxUnfollowsPerDay: 150, // daily unfollow cap (safety rail)
  };

  var SETTING_FIELDS = [
    {
      key: "pageDelayMean",
      label: "Mean delay between pages (ms)",
      min: 0,
      max: 60000,
      step: 100,
    },
    {
      key: "pageDelaySpread",
      label: "Delay variance (ms)",
      min: 0,
      max: 30000,
      step: 100,
    },
    { key: "burstSize", label: "Pages per burst", min: 1, max: 50, step: 1 },
    {
      key: "restMean",
      label: "Rest after a burst (ms)",
      min: 0,
      max: 600000,
      step: 1000,
    },
    {
      key: "cooldownEvery",
      label: "Long cooldown every N pages (0 = off)",
      min: 0,
      max: 200,
      step: 1,
    },
    {
      key: "cooldownMean",
      label: "Cooldown duration (ms)",
      min: 0,
      max: 3600000,
      step: 10000,
    },
    {
      key: "maxScanPages",
      label: "Max pages per scan",
      min: 1,
      max: 1000,
      step: 1,
    },
    {
      key: "maxScansPerDay",
      label: "Max scans per day",
      min: 1,
      max: 50,
      step: 1,
    },
    {
      key: "minMinutesBetweenScans",
      label: "Min minutes between scans",
      min: 0,
      max: 240,
      step: 5,
    },
    {
      key: "pageSize",
      label: "Users per request (20–200)",
      min: 20,
      max: 200,
      step: 10,
    },
    // --- unfollow ---
    {
      key: "unfollowDelayMean",
      label: "Mean delay between unfollows (ms)",
      min: 1000,
      max: 120000,
      step: 500,
    },
    {
      key: "unfollowDelaySpread",
      label: "Unfollow delay variance (ms)",
      min: 0,
      max: 60000,
      step: 500,
    },
    {
      key: "unfollowBurstSize",
      label: "Unfollows per burst",
      min: 1,
      max: 20,
      step: 1,
    },
    {
      key: "unfollowRestMean",
      label: "Rest after a burst (ms)",
      min: 5000,
      max: 900000,
      step: 5000,
    },
    {
      key: "unfollowCooldownEvery",
      label: "Cooldown every N unfollows (0 = off)",
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: "unfollowCooldownMean",
      label: "Cooldown duration (ms)",
      min: 0,
      max: 1800000,
      step: 10000,
    },
    {
      key: "maxUnfollowsPerSession",
      label: "Max unfollows per session",
      min: 1,
      max: 1000,
      step: 1,
    },
    {
      key: "maxUnfollowsPerDay",
      label: "Max unfollows per day",
      min: 1,
      max: 2000,
      step: 10,
    },
  ];

  var ACCENTS = {
    twitter: ["#1d9bf0", "#0f90e8", "#7856ff"],
    instagram: ["#f09433", "#dc2743", "#bc1888"],
    aurora: ["#22d3ee", "#6366f1", "#a855f7"],
    ember: ["#f59e0b", "#ef4444", "#7f1d1d"],
    mint: ["#34d399", "#10b981", "#065f46"],
  };

  var THROTTLE_KEYS = [
    "rate_limit_error",
    "feedback_required",
    "checkpoint_challenge_required",
    "challenge_required",
    "login_required",
    "unauthorized",
    "please_wait",
    "too many requests",
    "try again later",
    "request blocked",
    // X / Twitter signals
    "rate limit exceeded",
    "over capacity",
    "temporarily locked",
    "could not authenticate",
    "account suspended",
    "forbidden",
    "you are unable to follow more people",
  ];

  /* X / Twitter internal API base. The web app's GraphQL query IDs rotate
     frequently, so this script uses the stable i/api/1.1 REST endpoints the
     web app and browser tools have used for years. If X ever shuts these down,
     only this section (6) needs to change. */
  var API_BASE = "https://x.com/i/api/1.1";
  /* The public guest token X's own web app sends on every i/api call. It is not
     a secret — it is hardcoded in X's web bundle — but requests without it are
     rejected with HTTP 403. */
  var X_GUEST_BEARER =
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

  /* ============================================================
   * 2. Small utilities
   * ============================================================ */
  function getCookie(name) {
    var parts = String(document.cookie || "").split(";");
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p.indexOf(name + "=") === 0) {
        try {
          return decodeURIComponent(p.slice(name.length + 1));
        } catch (e) {
          return p.slice(name.length + 1);
        }
      }
    }
    return null;
  }

  var ESC_MAP = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ESC_MAP[c];
    });
  }

  function fmtNum(n) {
    return typeof n === "number" && isFinite(n)
      ? n.toLocaleString("en-US")
      : String(n == null ? "—" : n);
  }

  function fmtDuration(ms) {
    var s = Math.max(1, Math.round(ms / 1000));
    if (s < 60) return s + "s";
    var m = Math.floor(s / 60),
      r = s % 60;
    if (m < 60) return m + "m " + r + "s";
    return Math.floor(m / 60) + "h " + (m % 60) + "m";
  }

  function fmtAgo(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    return Math.round(s / 3600) + "h ago";
  }

  /* Human-like random delay: bell-ish distribution, clamped so every delay
     is plausible (never the same value twice, never extreme). */
  function randHuman(mean, spread) {
    if (!mean) return 0;
    var g = (Math.random() + Math.random() + Math.random()) / 3; // 0..1 bell-ish
    var d = mean + (g - 0.5) * 4 * spread;
    d = Math.max(mean * 0.35, Math.min(d, mean * 2.6));
    return Math.max(0, Math.round(d));
  }

  /* Sleep that resolves early if the user cancels. */
  function sleepInterruptible(ms) {
    return new Promise(function (resolve) {
      var timer = setTimeout(function () {
        clearInterval(iv);
        resolve();
      }, ms);
      var iv = setInterval(function () {
        if (S.cancel) {
          clearTimeout(timer);
          clearInterval(iv);
          resolve();
        }
      }, 150);
    });
  }

  /* ============================================================
   * 3. Local persistence (settings / history / scan snapshot)
   * ============================================================ */
  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function defaultSettings() {
    var s = {};
    for (var k in DEFAULTS)
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) s[k] = DEFAULTS[k];
    return s;
  }

  function loadSettings() {
    var stored = loadJSON(K.SETTINGS, null) || {};
    delete stored.whitelist; // removed in v2.2 — never let the old key round-trip
    var s = defaultSettings();
    var k;
    for (k in stored)
      if (Object.prototype.hasOwnProperty.call(stored, k)) s[k] = stored[k];
    for (var i = 0; i < SETTING_FIELDS.length; i++) {
      var f = SETTING_FIELDS[i];
      if (typeof s[f.key] !== "number" || !isFinite(s[f.key]))
        s[f.key] = DEFAULTS[f.key];
    }
    // Clamp the safety rails even if storage was tampered with.
    if (typeof s.maxScanPages !== "number" || s.maxScanPages < 1)
      s.maxScanPages = DEFAULTS.maxScanPages;
    if (
      typeof s.pageSize !== "number" ||
      !isFinite(s.pageSize) ||
      s.pageSize < 1
    )
      s.pageSize = DEFAULTS.pageSize;
    else s.pageSize = Math.max(1, Math.min(200, Math.floor(s.pageSize)));
    if (!ACCENTS[s.accent]) s.accent = DEFAULTS.accent;
    if (["username", "nameuser", "csv"].indexOf(s.copyFormat) === -1)
      s.copyFormat = DEFAULTS.copyFormat;
    return s;
  }

  function saveSettings() {
    try {
      localStorage.setItem(K.SETTINGS, JSON.stringify(S.settings));
    } catch (e) {}
  }

  function saveHistory() {
    try {
      localStorage.setItem(K.HISTORY, JSON.stringify(S.history.slice(0, 20)));
    } catch (e) {}
  }

  function saveSnapshot() {
    try {
      var snap = {
        takenAt: Date.now(),
        countTotal: S.countTotal,
        followersCount: S.followersCount,
        users: S.users.map(function (u) {
          return [
            u.id,
            u.username,
            u.fullName,
            u.isVerified ? 1 : 0,
            u.isPrivate ? 1 : 0,
            u.avatar,
            u.isMutual ? 1 : 0,
            u.unknown ? 1 : 0,
            u.inFollowing ? 1 : 0,
            u.inFollowers ? 1 : 0,
          ];
        }),
      };
      localStorage.setItem(K.SNAPSHOT, JSON.stringify(snap));
    } catch (e) {}
  }

  /* (No legacy storage migration needed for the X platform — this script has
     always used the unmutual.x.v2.* namespace.) */

  /* ============================================================
   * 4. State
   * ============================================================ */
  var S = {
    version: VERSION,
    status: "initial", // initial | scanning | throttled | ready
    users: [],
    byId: null, // id -> user (dedupe across the following + followers scans)
    countTotal: null, // following count from the API
    followersCount: null, // followers count from the API
    pagesFetched: 0,
    phasePages: 0, // pages fetched in the current phase
    phase: "following", // following | followers
    scanStarted: 0,
    cursor: null,
    currentUserId: null,
    seen: null,
    cancel: false,
    throttle: null,
    capped: false,
    selected: new Set(),
    tab: "all", // all | nonfollowers | dontfollowback | mutuals
    search: "",
    sort: "default", // default | az | za
    filter: { verified: false, private: false },
    settings: loadSettings(),
    history: loadJSON(K.HISTORY, []),
    snapshot: loadJSON(K.SNAPSHOT, null),
    forcedBanner: null,
    mode: "scan", // scan | unfollow (drives progress/resume dispatch)
    unfollowQueue: [],
    unfollowIndex: 0,
    unfollowLog: [],
    unfollowStarted: 0,
    pendingUnfollow: null,
    unfollowsToday: loadJSON(K.UNFOLLOWS, { date: "", count: 0 }),
  };

  /* ============================================================
   * 5. Pacing engine (strict profile)
   * ============================================================ */
  function scanPause(nextPageIndex) {
    var s = S.settings;
    var ms = randHuman(s.pageDelayMean, s.pageDelaySpread);
    if (
      s.burstSize > 0 &&
      nextPageIndex > 0 &&
      nextPageIndex % s.burstSize === 0
    ) {
      ms += randHuman(s.restMean, s.restSpread);
    }
    if (
      s.cooldownEvery > 0 &&
      nextPageIndex > 0 &&
      nextPageIndex % s.cooldownEvery === 0
    ) {
      ms += randHuman(s.cooldownMean, s.cooldownSpread);
    }
    return ms;
  }

  function canScan() {
    var s = S.settings;
    var today = new Date().toISOString().slice(0, 10);
    var todayCount = 0;
    for (var i = 0; i < S.history.length; i++) {
      if (
        isScanKind(S.history[i].kind) &&
        new Date(S.history[i].t).toISOString().slice(0, 10) === today
      )
        todayCount++;
    }
    if (todayCount >= s.maxScansPerDay) {
      return {
        ok: false,
        reason:
          "Daily scan limit reached (" +
          todayCount +
          "/" +
          s.maxScansPerDay +
          "). The safety system stops scans to protect your account. You can raise the limit in Settings.",
      };
    }
    var last = S.history[0];
    if (last && Date.now() - last.t < s.minMinutesBetweenScans * 60000) {
      var wait = Math.ceil(
        (s.minMinutesBetweenScans * 60000 - (Date.now() - last.t)) / 60000,
      );
      return {
        ok: false,
        reason:
          "Safety cooldown active — please wait " +
          wait +
          " more minute(s) before the next scan.",
      };
    }
    return { ok: true };
  }

  /* ============================================================
   * 6. X (Twitter) API (read-only)
   * ============================================================ */
  /* Read the logged-in user's id from the twid cookie ("u=<user_id>" or the
     URL-encoded "u%3D<user_id>"), falling back to any digits in the value. */
  function getUserId() {
    var t = getCookie("twid");
    if (!t) return null;
    if (t.indexOf("u=") === 0) t = t.slice(2);
    else if (t.indexOf("u%3D") === 0) t = t.slice(4);
    t = String(t).replace(/[^0-9]/g, "");
    return t || null;
  }

  /* The internal API expects the same headers the web app sends: the guest
     bearer, the CSRF token from the ct0 cookie, and the session markers. */
  function buildHeaders() {
    return {
      authorization: "Bearer " + X_GUEST_BEARER,
      "x-csrf-token": getCookie("ct0") || "",
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type": "OAuth2Session",
      "x-requested-with": "XMLHttpRequest",
    };
  }

  function buildListUrl(list, userId, cursor) {
    var qs =
      "user_id=" +
      encodeURIComponent(String(userId)) +
      "&count=" +
      S.settings.pageSize +
      "&include_profile_interstitial_type=1&include_blocking=1&include_blocked_by=1" +
      "&include_followed_by=1&include_followee_whitelist=1&include_mutual_following=1" +
      "&include_user_can_subscribe=1&skip_status=1";
    if (cursor) qs += "&cursor=" + encodeURIComponent(String(cursor));
    return (
      API_BASE +
      "/" +
      (list === "followers" ? "followers" : "friendships") +
      "/list.json?" +
      qs
    );
  }

  function buildFollowingUrl(userId, cursor) {
    return buildListUrl("following", userId, cursor);
  }

  function buildFollowersUrl(userId, cursor) {
    return buildListUrl("followers", userId, cursor);
  }

  function detectThrottle(status, text, json) {
    var msg = "";
    var code = null;
    // X wraps errors as { errors: [ { code, message } ] }.
    if (json && Array.isArray(json.errors) && json.errors.length) {
      var e0 = json.errors[0];
      if (e0 && typeof e0 === "object") {
        if (e0.message) msg = String(e0.message);
        else if (e0.reason) msg = String(e0.reason);
        if (typeof e0.code === "number") code = e0.code;
      }
    }
    if (!msg && json && json.message) msg = String(json.message);
    if (!msg && json && json.spam) msg = String(json.spam);
    if (!msg && json && json.error) msg = String(json.error);
    if (!msg && json && json.status === "fail") msg = "request failed";
    if (!msg && text) msg = String(text).slice(0, 160);
    var low = msg.toLowerCase();
    // 64 = could not authenticate, 326 = account temporarily locked — both
    // mean "log in again"; the pause can't be resumed by clicking Resume.
    if (code === 64 || code === 326) {
      return { reason: msg || "X says you need to log in again", resumable: false };
    }
    if (status === 429 || status === 401 || status === 403) {
      return {
        reason: msg || "HTTP " + status,
        retryAfter: json && json.retry_after ? Number(json.retry_after) : null,
      };
    }
    if (status === 400) {
      return {
        reason: msg || "HTTP " + status,
        retryAfter: json && json.retry_after ? Number(json.retry_after) : null,
      };
    }
    if (json && json.status === "fail")
      return { reason: msg || "request failed" };
    for (var i = 0; i < THROTTLE_KEYS.length; i++) {
      if (low.indexOf(THROTTLE_KEYS[i]) !== -1) return { reason: msg };
    }
    return null;
  }

  /* list: "following" (user flag: followed_by = do they follow you?) or
     "followers" (user flag: following = do you follow them?).
     A user can appear in both lists (a mutual) — the scan merges by id. */
  function normalizeUser(n, list) {
    var isFol = list === "followers";
    var flag = isFol ? n.following : n.followed_by;
    return {
      id: String(n.id_str || n.id || ""),
      username: String(n.screen_name || ""),
      fullName: String(n.name || ""),
      isVerified: !!n.verified || !!n.is_blue_verified,
      isPrivate: !!n.protected,
      avatar: String(n.profile_image_url_https || ""),
      isMutual: flag === true,
      unknown: typeof flag !== "boolean",
      inFollowing: !isFol, // seen in the following list
      inFollowers: isFol, // seen in the followers list
    };
  }

  /* ============================================================
   * 7. Scan
   * ============================================================ */
  function clearResults() {
    var r = document.getElementById("um-results");
    if (r) r.innerHTML = "";
    var e = document.getElementById("um-empty");
    if (e) e.innerHTML = "";
  }

  function updateProgress() {
    var isFol = S.phase === "followers";
    var phaseTotal = isFol ? S.followersCount : S.countTotal;
    var phaseSeen = 0;
    for (var i = 0; i < S.users.length; i++) {
      var u = S.users[i];
      if (isFol ? u.inFollowers : u.inFollowing) phaseSeen++;
    }
    var pct = phaseTotal
      ? Math.min(100, Math.round((phaseSeen / phaseTotal) * 100))
      : 0;
    var elapsed = Date.now() - S.scanStarted;
    var eta = "";
    var pace = elapsed > 1000 && phaseSeen > 0 ? phaseSeen / elapsed : 0;
    if (pace > 0 && phaseTotal && phaseSeen < phaseTotal) {
      var rem = Math.round((phaseTotal - phaseSeen) / pace);
      eta = " · ~" + fmtDuration(rem) + " left";
    }
    var bar = document.getElementById("um-progressbar");
    if (bar) bar.style.width = pct + "%";
    var txt = document.getElementById("um-progress-text");
    if (txt)
      txt.textContent =
        (isFol ? "Scanning followers" : "Scanning following") +
        " · " +
        phaseSeen +
        " / " +
        (phaseTotal != null ? fmtNum(phaseTotal) : "?") +
        eta;
  }

  function renderProgress(status) {
    var p = document.getElementById("um-progress");
    if (!p) return;
    if (
      status === "scanning" ||
      status === "unfollowing" ||
      status === "throttled"
    ) {
      p.style.display = "block";
      var cb = document.getElementById("um-cancel-btn");
      var rb = document.getElementById("um-resume-btn");
      var resumable =
        status !== "throttled" || !S.throttle || S.throttle.resumable !== false;
      if (cb) cb.style.display = status === "throttled" ? "none" : "";
      if (rb)
        rb.style.display = status === "throttled" && resumable ? "" : "none";
      if (status === "scanning") updateProgress();
      else if (status === "unfollowing") updateUnfollowProgress();
    } else {
      p.style.display = "none";
    }
  }

  /* History kinds that represent a scan attempt (unfollow batches are excluded
     from scan caps / scan stats). */
  function isScanKind(k) {
    return (
      k === "done" ||
      k === "capped" ||
      k === "cancelled" ||
      k === "throttled" ||
      k === "error"
    );
  }

  function recordHistory(kind, ms, warn, users, pages) {
    S.history.unshift({
      t: Date.now(),
      kind: kind,
      users: typeof users === "number" ? users : S.users.length,
      pages: typeof pages === "number" ? pages : S.pagesFetched,
      ms: ms,
      warn: warn || "",
    });
    S.history = S.history.slice(0, 20);
    saveHistory();
  }

  function finishScan(kind) {
    var ms = Date.now() - S.scanStarted;
    S.status = "ready";
    recordHistory(kind, ms, S.throttle ? S.throttle.reason : "");
    if (kind === "done") {
      toast(
        "Scan complete: " + S.users.length + " accounts analyzed",
        "success",
      );
      if (S.settings.persistSnapshot) saveSnapshot();
    } else if (kind === "capped") {
      toast(
        "Scan hit the page limit — showing partial results (" +
          S.users.length +
          " of " +
          (S.countTotal != null ? fmtNum(S.countTotal) : "?") +
          "). Raise the limit in Settings.",
        "warning",
      );
    } else {
      toast("Scan stopped with " + S.users.length + " accounts loaded", "info");
    }
    renderPill();
    renderProgress("ready");
    renderStats();
    renderSafety();
    renderBanner();
  }

  function scan(resume) {
    if (S.status === "scanning" || S.status === "unfollowing")
      return Promise.resolve();
    if (!resume) {
      var check = canScan();
      if (!check.ok) {
        toast(check.reason, "error");
        return Promise.resolve();
      }
      // X's auth_token cookie is HttpOnly — JavaScript cannot read it. The
      // readable logged-in signal is the twid cookie, which holds your user id
      // ("u=<id>" or URL-encoded "u%3D<id>").
      var uid = getUserId();
      if (!uid) {
        banner(
          "error",
          "Not logged in",
          "Could not read your X login (the twid cookie holds your user id). Open X/Twitter, log in, then run the bookmarklet again.",
        );
        return Promise.resolve();
      }
      S.forcedBanner = null;
      S.status = "scanning";
      S.cancel = false;
      S.throttle = null;
      S.users = [];
      S.byId = new Map();
      S.capped = false;
      S.selected.clear();
      S.countTotal = null;
      S.followersCount = null;
      S.pagesFetched = 0;
      S.phasePages = 0;
      S.phase = "following";
      S.cursor = null;
      S.currentUserId = uid;
      S.scanStarted = Date.now();
      clearResults();
    } else {
      S.forcedBanner = null;
      S.status = "scanning";
      S.cancel = false;
      S.throttle = null;
    }
    renderPill();
    renderProgress("scanning");
    renderBanner();
    renderStats();

    var done = false;
    var loop = new Promise(function (resolve) {
      (function next() {
        if (done || S.cancel) {
          resolve();
          return;
        }
        if (S.throttle) {
          resolve();
          return;
        }
        if (
          S.settings.maxScanPages > 0 &&
          S.phasePages >= S.settings.maxScanPages
        ) {
          // Page cap hit for the current list — mark partial, but still scan
          // the other list so followers get counted too.
          S.capped = true;
          if (S.phase === "following") {
            S.phase = "followers";
            S.phasePages = 0;
            S.cursor = null;
          } else {
            done = true;
            resolve();
            return;
          }
        }
        if (S.phasePages > 0) {
          sleepInterruptible(scanPause(S.phasePages)).then(function () {
            if (done || S.cancel || S.throttle) {
              resolve();
              return;
            }
            fetchPage().then(next);
          });
          return;
        }
        fetchPage().then(next);
      })();
    });

    return loop.then(function () {
      if (S.status === "scanning")
        finishScan(S.cancel ? "cancelled" : S.capped ? "capped" : "done");
    });

    function fetchPage() {
      var isFol = S.phase === "followers";
      var url = isFol
        ? buildFollowersUrl(S.currentUserId, S.cursor)
        : buildFollowingUrl(S.currentUserId, S.cursor);
      return fetch(url, {
        method: "GET",
        credentials: "include",
        headers: buildHeaders(),
      })
        .then(function (resp) {
          return resp.text().then(function (text) {
            return { status: resp.status, text: text };
          });
        })
        .then(function (res) {
          var json = null;
          try {
            json = JSON.parse(res.text);
          } catch (e) {
            json = null;
          }
          var th = detectThrottle(res.status, res.text, json);
          if (!th && !json)
            th = {
              reason:
                "X returned an HTML page instead of data (login wall or checkpoint?). Reload x.com and try again.",
              resumable: false,
            };
          if (th) {
            S.throttle = th;
            return;
          }
          var users = json && Array.isArray(json.users) ? json.users : null;
          if (!users) {
            S.throttle = {
              reason: "Unexpected response shape from X.",
              resumable: true,
            };
            return;
          }
          for (var i = 0; i < users.length; i++) {
            var u = normalizeUser(users[i], S.phase);
            if (!u.id) continue;
            var ex = S.byId.get(u.id);
            if (ex) {
              // Seen in both lists (a mutual): merge flags, keep richer fields.
              ex.inFollowing = ex.inFollowing || u.inFollowing;
              ex.inFollowers = ex.inFollowers || u.inFollowers;
              if (u.isMutual) ex.isMutual = true;
              ex.unknown = ex.unknown && u.unknown; // known if either side knows
            } else {
              S.byId.set(u.id, u);
              S.users.push(u);
              appendRow(u);
            }
          }
          S.pagesFetched++;
          S.phasePages++;
          // The REST lists report no totals — track running counts per phase.
          var seen = 0;
          for (var j = 0; j < S.users.length; j++) {
            if (isFol ? S.users[j].inFollowers : S.users[j].inFollowing) seen++;
          }
          if (isFol) S.followersCount = seen;
          else S.countTotal = seen;
          var nc = json.next_cursor_str;
          var hasNext = typeof nc === "string" && nc !== "" && nc !== "0";
          S.cursor = hasNext ? nc : null;
          if (!hasNext) {
            if (isFol) {
              done = true; // both lists finished
            } else {
              // Move on to the followers list.
              S.phase = "followers";
              S.phasePages = 0;
              S.cursor = null;
            }
          }
          updateProgress();
          renderStats();
        })
        .catch(function (err) {
          S.throttle = {
            reason:
              "Network error: " +
              (err && err.message ? err.message : String(err)),
          };
        })
        .then(function () {
          if (S.throttle) {
            S.status = "throttled";
            renderPill();
            renderProgress("throttled");
            var resumable = S.throttle.resumable !== false;
            var waitTxt = S.throttle.retryAfter
              ? " X says to wait ~" + S.throttle.retryAfter + "s."
              : "";
            var title = resumable
              ? "X is rate-limiting the scan"
              : "Scan could not continue";
            var body =
              esc(S.throttle.reason) +
              waitTxt +
              (resumable
                ? " Wait a few minutes, then click Resume. Nothing was lost — the scan continues where it stopped."
                : "");
            banner("error", title, body, resumable ? "resume" : null);
            toast(resumable ? "Scan paused by X" : "Scan stopped", "error");
            recordHistory(
              resumable ? "throttled" : "error",
              Date.now() - S.scanStarted,
              S.throttle.reason,
            );
            renderStats();
            renderSafety();
          }
        });
    }
  }

  /* ============================================================
   * 7.5 Unfollow engine (strict profile, explicit user actions only)
   * ============================================================ */
  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function saveUnfollows() {
    try {
      localStorage.setItem(K.UNFOLLOWS, JSON.stringify(S.unfollowsToday));
    } catch (e) {}
  }

  function unfollowPause(index) {
    var s = S.settings;
    var ms = randHuman(s.unfollowDelayMean, s.unfollowDelaySpread);
    if (
      s.unfollowBurstSize > 0 &&
      index > 0 &&
      index % s.unfollowBurstSize === 0
    ) {
      ms += randHuman(s.unfollowRestMean, s.unfollowRestSpread);
    }
    if (
      s.unfollowCooldownEvery > 0 &&
      index > 0 &&
      index % s.unfollowCooldownEvery === 0
    ) {
      ms += randHuman(s.unfollowCooldownMean, s.unfollowCooldownSpread);
    }
    return ms;
  }

  function canUnfollow(count) {
    var s = S.settings;
    var today = todayStr();
    if (
      !S.unfollowsToday ||
      S.unfollowsToday.date !== today ||
      typeof S.unfollowsToday.count !== "number"
    ) {
      S.unfollowsToday = { date: today, count: 0 };
    }
    var allowed = s.maxUnfollowsPerDay - S.unfollowsToday.count;
    if (allowed <= 0) {
      return {
        ok: false,
        reason:
          "Daily unfollow limit reached (" +
          S.unfollowsToday.count +
          "/" +
          s.maxUnfollowsPerDay +
          "). The safety system stops unfollowing to protect your account. Raise the limit in Settings if you must.",
      };
    }
    if (count > allowed) {
      return {
        ok: false,
        reason:
          "Only " +
          allowed +
          " of the " +
          count +
          " selected accounts can be unfollowed today (daily cap " +
          s.maxUnfollowsPerDay +
          "). Raise the limit in Settings, or pick fewer.",
      };
    }
    return { ok: true };
  }

  function unfollowOne(user) {
    var csrf = getCookie("ct0");
    if (!csrf) {
      return Promise.resolve({
        ok: false,
        error: "ct0 cookie is missing — log in to X and try again",
      });
    }
    var headers = buildHeaders();
    headers["content-type"] = "application/x-www-form-urlencoded";
    return fetch(
      API_BASE +
        "/friendships/destroy.json?user_id=" +
        encodeURIComponent(user.id),
      {
        method: "POST",
        mode: "cors",
        credentials: "include",
        headers: headers,
      },
    )
      .then(function (resp) {
        return resp.text().then(function (text) {
          return { status: resp.status, text: text };
        });
      })
      .then(function (res) {
        var json = null;
        try {
          json = JSON.parse(res.text);
        } catch (e) {
          json = null;
        }
        var th = detectThrottle(res.status, res.text, json);
        if (th) {
          th.resumable = !/challenge|checkpoint|login|feedback|spam|locked|authenticate|suspended/i.test(
            th.reason,
          );
          return { ok: false, throttle: th };
        }
        // A successful destroy returns the unfollowed user object.
        if (json && (json.id_str || json.id)) return { ok: true };
        return {
          ok: false,
          error:
            json && Array.isArray(json.errors) && json.errors[0]
              ? String(
                  json.errors[0].message ||
                    json.errors[0].reason ||
                    "request failed",
                )
              : json && json.message
                ? String(json.message)
                : "HTTP " + res.status,
        };
      })
      .catch(function (err) {
        return {
          ok: false,
          error:
            "Network error: " +
            (err && err.message ? err.message : String(err)),
        };
      });
  }

  function onUnfollowed(user) {
    S.users = S.users.filter(function (u) {
      return u.id !== user.id;
    });
    if (typeof S.countTotal === "number" && S.countTotal > 0) S.countTotal--;
    S.selected.delete(user.username);
    var today = todayStr();
    if (!S.unfollowsToday || S.unfollowsToday.date !== today)
      S.unfollowsToday = { date: today, count: 0 };
    S.unfollowsToday.count++;
    saveUnfollows();
    renderStats();
    renderSafety();
  }

  function updateUnfollowProgress() {
    var total = S.unfollowQueue.length;
    var pct = total
      ? Math.min(100, Math.round((S.unfollowIndex / total) * 100))
      : 0;
    var elapsed = Date.now() - S.unfollowStarted;
    var eta = "";
    var pace =
      elapsed > 1000 && S.unfollowIndex > 0 ? S.unfollowIndex / elapsed : 0;
    if (pace > 0 && S.unfollowIndex < total) {
      eta =
        " · ~" +
        fmtDuration(Math.round((total - S.unfollowIndex) / pace)) +
        " left";
    }
    var bar = document.getElementById("um-progressbar");
    if (bar) bar.style.width = pct + "%";
    var txt = document.getElementById("um-progress-text");
    if (txt)
      txt.textContent = "Unfollowing " + S.unfollowIndex + " / " + total + eta;
  }

  function startUnfollow(users) {
    if (!users || !users.length) return;
    if (S.status === "scanning" || S.status === "unfollowing") return;
    if (S.mode === "scan" && S.status === "throttled") {
      toast(
        "Resolve the paused scan first — Resume or Stop it, then unfollow",
        "error",
      );
      return;
    }
    var list = users.filter(function (u) {
      return u.inFollowing !== false; // only accounts you follow can be unfollowed
    });
    if (!list.length) {
      toast(
        "Nothing to unfollow — you don't follow these accounts",
        "info",
      );
      return;
    }
    var check = canUnfollow(list.length);
    if (!check.ok) {
      toast(check.reason, "error");
      return;
    }
    if (!getCookie("ct0")) {
      toast(
        "Could not find the ct0 cookie — log in to X and try again",
        "error",
      );
      return;
    }
    S.pendingUnfollow = null;
    closeModal();
    S.mode = "unfollow";
    S.status = "unfollowing";
    S.cancel = false;
    S.throttle = null;
    S.forcedBanner = null;
    S.unfollowQueue = list;
    S.unfollowIndex = 0;
    S.unfollowLog = [];
    S.unfollowStarted = Date.now();
    renderPill();
    renderProgress("unfollowing");
    renderBanner();
    unfollowStep();
  }

  function resumeUnfollow() {
    if (S.status !== "throttled" || S.mode !== "unfollow") return;
    if (S.throttle && S.throttle.resumable === false) {
      toast("This pause is not resumable — re-run the bookmarklet instead", "error");
      return;
    }
    S.forcedBanner = null;
    S.status = "unfollowing";
    S.cancel = false;
    S.throttle = null;
    renderPill();
    renderProgress("unfollowing");
    renderBanner();
    unfollowStep();
  }

  function unfollowStep() {
    if (S.status !== "unfollowing") return;
    if (S.cancel || S.throttle) {
      finishUnfollow();
      return;
    }
    if (S.unfollowIndex >= S.unfollowQueue.length) {
      finishUnfollow();
      return;
    }
    if (
      S.settings.maxUnfollowsPerSession > 0 &&
      S.unfollowIndex >= S.settings.maxUnfollowsPerSession
    ) {
      toast(
        "Session unfollow limit reached (" +
          S.settings.maxUnfollowsPerSession +
          "). You can raise it in Settings.",
        "warning",
      );
      finishUnfollow();
      return;
    }
    if (S.unfollowIndex > 0) {
      sleepInterruptible(unfollowPause(S.unfollowIndex)).then(function () {
        if (S.status !== "unfollowing") return;
        if (S.cancel || S.throttle) {
          finishUnfollow();
          return;
        }
        doOne();
      });
      return;
    }
    doOne();

    function doOne() {
      var user = S.unfollowQueue[S.unfollowIndex];
      unfollowOne(user).then(function (res) {
        if (S.status !== "unfollowing") return;
        if (S.cancel) {
          finishUnfollow();
          return;
        }
        if (res.throttle) {
          S.throttle = res.throttle;
          S.status = "throttled";
          renderPill();
          renderProgress("throttled");
          var waitTxt = res.throttle.retryAfter
            ? " X says to wait ~" + res.throttle.retryAfter + "s."
            : "";
          var resumable = res.throttle.resumable !== false;
          banner(
            "error",
            "X is rate-limiting unfollowing",
            esc(res.throttle.reason) +
              waitTxt +
              (resumable
                ? " Wait a few minutes, then click Resume. Unfollows continue where they stopped."
                : " This pause cannot be resumed — re-run the bookmarklet."),
            resumable ? "resume" : "",
          );
          toast("Unfollowing paused by X", "error");
          return;
        }
        S.unfollowIndex++;
        S.unfollowLog.push({
          username: user.username,
          ok: res.ok,
          error: res.error || "",
        });
        if (res.ok) {
          onUnfollowed(user);
        } else {
          toast(
            "Could not unfollow @" +
              user.username +
              (res.error ? " — " + res.error : ""),
            "error",
          );
        }
        updateUnfollowProgress();
        unfollowStep();
      });
    }
  }

  function finishUnfollow() {
    if (S.status === "throttled") return; // resume will continue
    var okCount = 0,
      failCount = 0;
    for (var i = 0; i < S.unfollowLog.length; i++) {
      if (S.unfollowLog[i].ok) okCount++;
      else failCount++;
    }
    var skipped = S.cancel
      ? Math.max(0, S.unfollowQueue.length - S.unfollowIndex)
      : 0;
    S.status = "ready";
    S.mode = "scan";
    S.unfollowQueue = [];
    S.unfollowIndex = 0;
    S.cancel = false;
    renderPill();
    renderProgress("ready");
    renderStats();
    renderSafety();
    renderTabs();
    renderResults();
    renderSelbar();
    renderBanner();
    var msg = okCount + " unfollowed";
    if (failCount) msg += ", " + failCount + " failed";
    if (skipped) msg += ", " + skipped + " skipped";
    recordHistory(
      "unfollow",
      Date.now() - S.unfollowStarted,
      msg,
      okCount,
      failCount,
    );
    toast("Done — " + msg, failCount ? "warning" : "success");
  }

  function showUnfollowConfirm(users, skippedNotFollowing) {
    S.pendingUnfollow = users;
    var non = 0,
      mut = 0,
      unk = 0;
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      if (u.unknown) unk++;
      else if (u.isMutual) mut++;
      else non++;
    }
    var body =
      '<div class="ig-confirm">' +
      "<p>Unfollow <strong>" +
      users.length +
      "</strong> account" +
      (users.length > 1 ? "s" : "") +
      "? This cannot be undone automatically.</p>" +
      "<ul>" +
      "<li><b>" +
      non +
      "</b> non-follower" +
      (non === 1 ? "" : "s") +
      "</li>" +
      (mut
        ? "<li><b>" +
          mut +
          "</b> mutual" +
          (mut === 1 ? "" : "s") +
          " (they follow you back — you would stop following them)</li>"
        : "") +
      (unk ? "<li><b>" + unk + "</b> status unknown</li>" : "") +
      (skippedNotFollowing
        ? "<li><b>" +
          skippedNotFollowing +
          "</b> account" +
          (skippedNotFollowing === 1 ? "" : "s") +
          " you don't follow were excluded</li>"
        : "") +
      "</ul>" +
      '<p class="ig-confirm-warn">Unfollows run one at a time with randomized human pacing and stop at the daily safety cap (' +
      S.settings.maxUnfollowsPerDay +
      ").</p>" +
      "</div>";
    openModal(
      "Confirm unfollow",
      body,
      '<button class="ig-btn ig-btn-danger" data-act="confirm-unfollow">Unfollow ' +
        users.length +
        "</button>" +
        '<button class="ig-btn ig-btn-ghost" data-act="modal-close">Cancel</button>',
    );
  }

  /* ============================================================
   * 8. Analysis pipeline: filter / sort / select
   * ============================================================ */
  /* You follow them, they don't follow you back. */
  function isNonFollower(u) {
    return u.inFollowing !== false && !u.isMutual && !u.unknown;
  }

  /* They follow you, you don't follow them back. */
  function isNotFollowedBack(u) {
    return u.inFollowers === true && !u.isMutual && !u.unknown;
  }

  function getFiltered() {
    var q = S.search.trim().toLowerCase();
    var list = S.users;
    if (S.tab === "nonfollowers") list = list.filter(isNonFollower);
    else if (S.tab === "dontfollowback")
      list = list.filter(isNotFollowedBack);
    else if (S.tab === "mutuals")
      list = list.filter(function (u) {
        return u.isMutual;
      });
    if (q)
      list = list.filter(function (u) {
        return (
          u.username.toLowerCase().indexOf(q) !== -1 ||
          u.fullName.toLowerCase().indexOf(q) !== -1
        );
      });
    if (S.filter.verified)
      list = list.filter(function (u) {
        return u.isVerified;
      });
    if (S.filter.private)
      list = list.filter(function (u) {
        return u.isPrivate;
      });
    if (S.sort === "az")
      list = list.slice().sort(function (a, b) {
        return a.username < b.username ? -1 : a.username > b.username ? 1 : 0;
      });
    else if (S.sort === "za")
      list = list.slice().sort(function (a, b) {
        return a.username > b.username ? -1 : a.username < b.username ? 1 : 0;
      });
    return list;
  }

  function selectedUsers() {
    return S.users.filter(function (u) {
      return S.selected.has(u.username);
    });
  }

  /* ============================================================
   * 9. Clipboard / export
   * ============================================================ */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () {
          return true;
        },
        function () {
          return legacyCopy(text);
        },
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {
        ok = false;
      }
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  function csvField(v) {
    v = String(v == null ? "" : v);
    if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }

  function getCopyText(list, format) {
    if (format === "csv") {
      var rows = [
        ["username", "full_name", "private", "verified", "follows_back"].join(
          ",",
        ),
      ];
      for (var i = 0; i < list.length; i++) {
        var u = list[i];
        rows.push(
          [
            csvField(u.username),
            csvField(u.fullName),
            u.isPrivate ? "1" : "0",
            u.isVerified ? "1" : "0",
            u.unknown ? "?" : u.isMutual ? "1" : "0",
          ].join(","),
        );
      }
      return rows.join("\n");
    }
    if (format === "nameuser") {
      return list
        .map(function (u) {
          return (u.fullName || u.username) + " (@" + u.username + ")";
        })
        .join("\n");
    }
    return list
      .map(function (u) {
        return u.username;
      })
      .join("\n");
  }

  function download(filename, content, mime) {
    if (
      typeof Blob === "undefined" ||
      typeof URL === "undefined" ||
      !URL.createObjectURL
    ) {
      toast("Export is not supported in this browser", "error");
      return;
    }
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
    }, 500);
  }

  /* ============================================================
   * 10. UI — styles
   * ============================================================ */
  var CSS =
    ":root{--ig-bg:#0a0a0f;--ig-panel:#12121a;--ig-card:#171722;--ig-card2:#1d1d2b;--ig-line:#26263a;--ig-text:#e9e9f2;--ig-mut:#8b8ba5;--ig-dim:#5b5b75;" +
    "--ig-a1:#f09433;--ig-a2:#dc2743;--ig-a3:#bc1888;--ig-danger:#ff5c6c;--ig-ok:#4ade80;--ig-amber:#fbbf24;--ig-info:#38bdf8;--ig-radius:14px;--ig-shadow:0 12px 32px rgba(0,0,0,.45)}" +
    "*{box-sizing:border-box}html{background:var(--ig-bg)}body{margin:0;background:var(--ig-bg);color:var(--ig-text);font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.45;min-height:100vh}" +
    "::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-thumb{background:var(--ig-line);border-radius:8px}::-webkit-scrollbar-track{background:transparent}" +
    "button{font-family:inherit}button,a{outline-offset:2px}:focus-visible{outline:2px solid var(--ig-a2)}" +
    ".ig-app{max-width:1280px;margin:0 auto;padding:0 16px 90px}" +
    ".ig-header{position:sticky;top:0;z-index:30;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 4px;background:linear-gradient(180deg,rgba(10,10,15,.97),rgba(10,10,15,.85));backdrop-filter:blur(10px);border-bottom:1px solid var(--ig-line)}" +
    ".ig-brand{display:flex;align-items:center;gap:12px}" +
    ".ig-logo{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,var(--ig-a1),var(--ig-a2) 55%,var(--ig-a3));box-shadow:0 4px 16px rgba(220,39,67,.4);display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px}" +
    ".ig-title strong{display:block;font-size:15px;letter-spacing:.2px}.ig-title span{display:block;font-size:12px;color:var(--ig-mut)}" +
    ".ig-header-right{display:flex;align-items:center;gap:10px}" +
    ".ig-pill-header{padding:5px 12px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid var(--ig-line);background:var(--ig-card);color:var(--ig-mut);transition:all .2s}" +
    ".ig-pill-header-run{color:#fff;background:linear-gradient(135deg,var(--ig-a1),var(--ig-a2));border-color:transparent;animation:igpulse 1.4s ease-in-out infinite}" +
    ".ig-pill-header-ok{color:var(--ig-ok);border-color:rgba(74,222,128,.35)}" +
    ".ig-pill-header-warn{color:var(--ig-amber);border-color:rgba(251,191,36,.4)}" +
    "@keyframes igpulse{0%,100%{opacity:1}50%{opacity:.65}}" +
    ".ig-layout{display:grid;grid-template-columns:250px 1fr;gap:16px;margin-top:16px}" +
    ".ig-panel{background:linear-gradient(180deg,var(--ig-card),var(--ig-panel));border:1px solid var(--ig-line);border-radius:var(--ig-radius);padding:14px;margin-bottom:14px}" +
    ".ig-panel-title{font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:var(--ig-dim);margin-bottom:10px}" +
    ".ig-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px}" +
    ".ig-stat{border:1px solid var(--ig-line);border-radius:10px;padding:10px 12px;background:var(--ig-card2)}" +
    ".ig-stat b{display:block;font-size:20px;line-height:1.1}.ig-stat span{font-size:11px;color:var(--ig-mut)}" +
    ".ig-stat-red b{color:var(--ig-danger)}.ig-stat-green b{color:var(--ig-ok)}.ig-stat-amber b{color:var(--ig-amber)}.ig-stat-gray b{color:var(--ig-mut)}.ig-stat-blue b{color:var(--ig-info)}" +
    ".ig-safety-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}" +
    ".ig-safety-item{border:1px solid var(--ig-line);border-radius:10px;padding:8px 10px;background:var(--ig-card2)}" +
    ".ig-safety-item b{display:block;font-size:14px}.ig-safety-item span{font-size:11px;color:var(--ig-mut)}" +
    ".ig-safety-note{margin-top:10px;font-size:11.5px;color:var(--ig-mut);border-left:2px solid var(--ig-ok);padding-left:8px}" +
    ".ig-side-actions{display:flex;flex-direction:column;gap:8px}" +
    ".ig-btn{appearance:none;border:1px solid var(--ig-line);background:var(--ig-card);color:var(--ig-text);border-radius:10px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;transition:transform .12s,box-shadow .12s,background .12s,border-color .12s;white-space:nowrap}" +
    ".ig-btn:hover{transform:translateY(-1px);border-color:var(--ig-mut);box-shadow:0 4px 14px rgba(0,0,0,.35)}.ig-btn:active{transform:translateY(0)}" +
    ".ig-btn-primary{background:linear-gradient(135deg,var(--ig-a1),var(--ig-a2) 55%,var(--ig-a3));border-color:transparent;color:#fff}" +
    ".ig-btn-danger{color:var(--ig-danger);border-color:rgba(255,92,108,.4)}.ig-btn-danger:hover{border-color:var(--ig-danger)}" +
    ".ig-btn-ghost{background:transparent}" +
    ".ig-btn-block{width:100%}.ig-btn-big{padding:14px 26px;font-size:15px;border-radius:14px}" +
    ".ig-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}" +
    ".ig-main{min-width:0}" +
    ".ig-toolbar{background:var(--ig-panel);border:1px solid var(--ig-line);border-radius:var(--ig-radius);padding:10px;margin-bottom:12px}" +
    ".ig-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}" +
    ".ig-tab{border:1px solid var(--ig-line);background:var(--ig-card);color:var(--ig-mut);border-radius:999px;padding:6px 14px;font-size:13px;cursor:pointer;transition:all .15s}" +
    ".ig-tab:hover{color:var(--ig-text)}" +
    ".ig-tab-active{color:#fff;background:linear-gradient(135deg,var(--ig-a1),var(--ig-a2) 60%,var(--ig-a3));border-color:transparent}" +
    ".ig-tab-count{opacity:.75;font-size:11px;margin-left:4px}" +
    ".ig-toolbar-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
    ".ig-search{flex:1;min-width:180px;background:var(--ig-card);border:1px solid var(--ig-line);color:var(--ig-text);border-radius:10px;padding:8px 12px;font-size:13px}" +
    ".ig-search:focus{border-color:var(--ig-a2);outline:none}" +
    ".ig-chip{border:1px solid var(--ig-line);background:var(--ig-card);color:var(--ig-mut);border-radius:999px;padding:5px 11px;font-size:12px;cursor:pointer;transition:all .15s}" +
    ".ig-chip:hover{color:var(--ig-text)}.ig-chip-on{color:var(--ig-text);border-color:var(--ig-a2);background:rgba(220,39,67,.14)}" +
    ".ig-label{font-size:11px;color:var(--ig-dim);margin-right:2px}" +
    ".ig-sel{display:flex;gap:6px;margin-left:auto}" +
    ".ig-empty{padding:60px 20px;text-align:center;color:var(--ig-mut);display:none;border:1px dashed var(--ig-line);border-radius:var(--ig-radius)}" +
    ".ig-results{display:flex;flex-direction:column;gap:8px}" +
    ".ig-row{display:flex;align-items:center;gap:12px;background:var(--ig-card);border:1px solid var(--ig-line);border-radius:12px;padding:10px 12px;transition:border-color .15s,background .15s,transform .12s}" +
    ".ig-row:hover{border-color:var(--ig-mut);transform:translateX(2px)}" +
    ".ig-row-sel{border-color:var(--ig-a2);background:rgba(220,39,67,.08)}" +
    ".ig-check{display:flex;align-items:center;cursor:pointer}input[type=checkbox].ig-cb{width:16px;height:16px;accent-color:var(--ig-a2);cursor:pointer}" +
    ".ig-avatar{position:relative;width:44px;height:44px;border-radius:50%;overflow:hidden;flex:none;background:linear-gradient(135deg,var(--ig-a1),var(--ig-a3));display:flex;align-items:center;justify-content:center}" +
    ".ig-avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}" +
    ".ig-initial{color:#fff;font-size:18px;font-weight:700}" +
    ".ig-meta{min-width:0;flex:1}" +
    ".ig-name{font-weight:600;font-size:13.5px;display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".ig-username{font-size:12px;color:var(--ig-mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".ig-badge{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:#3897f0;color:#fff;font-size:10px;width:16px;height:16px;flex:none}" +
    ".ig-tags{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}" +
    ".ig-pill{font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;border:1px solid var(--ig-line)}" +
    ".ig-pill-mutual{color:var(--ig-ok);border-color:rgba(74,222,128,.35);background:rgba(74,222,128,.08)}" +
    ".ig-pill-non{color:var(--ig-danger);border-color:rgba(255,92,108,.4);background:rgba(255,92,108,.08)}" +
    ".ig-pill-unknown{color:var(--ig-mut)}.ig-pill-private{color:var(--ig-amber);border-color:rgba(251,191,36,.35)}" +
    ".ig-pill-dnb{color:var(--ig-info);border-color:rgba(56,189,248,.35);background:rgba(56,189,248,.08)}" +
    ".ig-actions{display:flex;gap:6px}" +
    ".ig-banner{margin-bottom:12px;border-radius:var(--ig-radius);padding:14px 16px;border:1px solid var(--ig-line);display:flex;align-items:center;gap:14px;flex-wrap:wrap;animation:igfade .3s ease}" +
    "@keyframes igfade{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}" +
    ".ig-banner-info{background:rgba(56,189,248,.08);border-color:rgba(56,189,248,.35)}" +
    ".ig-banner-error{background:rgba(255,92,108,.08);border-color:rgba(255,92,108,.4)}" +
    ".ig-banner-text{flex:1;font-size:13px}" +
    ".ig-banner-actions{display:flex;gap:8px}" +
    ".ig-banner-hero{background:radial-gradient(120% 140% at 10% 0%,rgba(220,39,67,.16),transparent 55%),linear-gradient(180deg,var(--ig-card),var(--ig-panel));border-color:var(--ig-line);display:flex;gap:20px;align-items:center}" +
    ".ig-hero-icon{font-size:44px;line-height:1;flex:none}" +
    ".ig-hero-text h2{margin:0 0 6px;font-size:20px}" +
    ".ig-hero-text p{margin:0 0 8px;color:var(--ig-mut);max-width:640px}" +
    ".ig-hero-hints kbd{background:var(--ig-card2);border:1px solid var(--ig-line);border-bottom-width:2px;border-radius:6px;padding:1px 6px;font-size:11px;color:var(--ig-text);font-family:inherit}" +
    ".ig-progress{background:var(--ig-panel);border:1px solid var(--ig-line);border-radius:var(--ig-radius);padding:14px;margin-bottom:12px}" +
    ".ig-progress-track{height:8px;border-radius:99px;background:var(--ig-card2);overflow:hidden}" +
    ".ig-progress-fill{height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,var(--ig-a1),var(--ig-a2),var(--ig-a3));transition:width .4s ease}" +
    ".ig-progress-meta{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px;font-size:13px;color:var(--ig-mut)}" +
    ".ig-progress-meta span{display:flex;gap:8px;align-items:center}" +
    ".ig-footer{margin-top:24px;padding-top:14px;border-top:1px solid var(--ig-line);display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:11.5px;color:var(--ig-dim)}" +
    ".ig-selbar{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:40;background:rgba(18,18,26,.92);backdrop-filter:blur(12px);border:1px solid var(--ig-line);border-radius:16px;padding:10px 16px;display:flex;align-items:center;gap:14px;box-shadow:var(--ig-shadow);animation:igfade .25s ease}" +
    ".ig-selbar-count{font-size:13px;color:var(--ig-mut)}.ig-selbar-count strong{color:var(--ig-text)}" +
    ".ig-selbar-actions{display:flex;gap:8px;flex-wrap:wrap}" +
    ".ig-modal-root{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:20px}" +
    ".ig-modal-backdrop{position:absolute;inset:0;background:rgba(4,4,8,.7);backdrop-filter:blur(4px)}" +
    ".ig-modal{position:relative;background:var(--ig-panel);border:1px solid var(--ig-line);border-radius:18px;width:min(640px,94vw);max-height:84vh;display:flex;flex-direction:column;box-shadow:var(--ig-shadow);animation:igfade .25s ease}" +
    ".ig-modal-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--ig-line)}" +
    ".ig-modal-head h3{margin:0;font-size:16px}" +
    ".ig-modal-body{padding:16px 18px;overflow:auto}" +
    ".ig-modal-foot{display:flex;gap:10px;justify-content:flex-end;padding:14px 18px;border-top:1px solid var(--ig-line)}" +
    ".ig-form{display:flex;flex-direction:column;gap:10px}" +
    ".ig-field{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:13px}" +
    ".ig-field input[type=number]{width:110px;background:var(--ig-card);border:1px solid var(--ig-line);color:var(--ig-text);border-radius:8px;padding:6px 8px}" +
    ".ig-field select{background:var(--ig-card);border:1px solid var(--ig-line);color:var(--ig-text);border-radius:8px;padding:6px 8px}" +
    ".ig-field-check{justify-content:flex-start;gap:8px}.ig-field-check input{accent-color:var(--ig-a2)}" +
    ".ig-empty-sm{color:var(--ig-mut);font-size:13px;padding:12px 4px}" +
    ".ig-h-head,.ig-h-row{display:grid;grid-template-columns:1.6fr .8fr .7fr .7fr .9fr;gap:8px;align-items:center;font-size:12.5px}" +
    ".ig-h-head{color:var(--ig-dim);text-transform:uppercase;font-size:10.5px;letter-spacing:.8px;padding:6px 2px;border-bottom:1px solid var(--ig-line)}" +
    ".ig-h-row{padding:8px 2px;border-bottom:1px solid var(--ig-line)}" +
    ".ig-h-kind{font-weight:600}.ig-h-done{color:var(--ig-ok)}.ig-h-cancelled{color:var(--ig-amber)}.ig-h-capped{color:var(--ig-amber)}.ig-h-throttled{color:var(--ig-danger)}.ig-h-error{color:var(--ig-danger)}.ig-h-unfollow{color:var(--ig-accent)}.ig-h-sum{color:var(--ig-muted)}" +
    ".ig-toasts{position:fixed;right:16px;bottom:16px;z-index:60;display:flex;flex-direction:column;gap:8px;max-width:360px}" +
    ".ig-toast{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;background:var(--ig-card2);border:1px solid var(--ig-line);border-left:3px solid var(--ig-info);color:var(--ig-text);border-radius:10px;padding:10px 12px;font-size:13px;box-shadow:var(--ig-shadow);animation:igfade .25s ease}" +
    ".ig-toast-success{border-left-color:var(--ig-ok)}.ig-toast-error{border-left-color:var(--ig-danger)}.ig-toast-warning{border-left-color:var(--ig-amber)}" +
    ".ig-toast-x{background:none;border:none;color:var(--ig-mut);cursor:pointer;font-size:16px;line-height:1;padding:0 2px}" +
    ".ig-profile-link{display:block;min-width:0;color:inherit;text-decoration:none}" +
    ".ig-profile-link:hover .ig-name{text-decoration:underline}" +
    ".ig-form-section{font-size:11px;text-transform:uppercase;letter-spacing:1.2px;color:var(--ig-dim);margin:14px 0 4px;padding-top:12px;border-top:1px solid var(--ig-line)}" +
    ".ig-confirm p{margin:0 0 8px}.ig-confirm ul{margin:0 0 10px;padding-left:18px;color:var(--ig-mut);font-size:13px}.ig-confirm ul li{margin-bottom:4px}.ig-confirm-warn{font-size:12px;color:var(--ig-amber);border-left:2px solid var(--ig-amber);padding-left:8px}" +
    "@media (max-width:900px){.ig-layout{grid-template-columns:1fr}.ig-sel{display:none}.ig-selbar{left:12px;right:12px;transform:none;justify-content:space-between}}";

  function styleEl() {
    var st = document.createElement("style");
    st.textContent = CSS;
    return st;
  }

  function applyAccent() {
    var a = ACCENTS[S.settings.accent] || ACCENTS.twitter;
    var st = document.documentElement.style;
    st.setProperty("--ig-a1", a[0]);
    st.setProperty("--ig-a2", a[1]);
    st.setProperty("--ig-a3", a[2]);
  }

  /* ============================================================
   * 11. UI — shell + render
   * ============================================================ */
  var SHELL =
    '<div id="um-app" class="ig-app">' +
    '<header class="ig-header">' +
    '<div class="ig-brand"><div class="ig-logo">✦</div>' +
    '<div class="ig-title"><strong>UnMutual</strong><span>X (Twitter) Follower Insights</span></div></div>' +
    '<div class="ig-header-right">' +
    '<span class="ig-pill-header" id="um-pill">Ready</span>' +
    '<button class="ig-btn ig-btn-ghost" data-act="settings-open" title="Settings">⚙ Settings</button>' +
    "</div>" +
    "</header>" +
    '<div class="ig-layout">' +
    '<aside class="ig-side">' +
    '<div class="ig-panel"><div class="ig-panel-title">Stats</div><div class="ig-stats" id="um-stats"></div></div>' +
    '<div class="ig-panel"><div class="ig-panel-title">Safety · strict pacing</div><div id="um-safety"></div></div>' +
    '<div class="ig-side-actions">' +
    '<button class="ig-btn ig-btn-primary ig-btn-block" data-act="scan">▶ Scan lists</button>' +
    '<button class="ig-btn ig-btn-ghost ig-btn-block" data-act="history-open">🕘 Scan history</button>' +
    '<button class="ig-btn ig-btn-ghost ig-btn-block" data-act="export-view">⬇ Export data (JSON)</button>' +
    '<button class="ig-btn ig-btn-ghost ig-btn-block" data-act="export-csv">⬇ Export CSV (view)</button>' +
    '<button class="ig-btn ig-btn-ghost ig-btn-block" data-act="import-scan">⬆ Import data</button>' +
    "</div>" +
    "</aside>" +
    '<main class="ig-main">' +
    '<div id="um-banner"></div>' +
    '<div class="ig-progress" id="um-progress" style="display:none">' +
    '<div class="ig-progress-track"><div class="ig-progress-fill" id="um-progressbar"></div></div>' +
    '<div class="ig-progress-meta">' +
    '<span id="um-progress-text"></span>' +
    "<span>" +
    '<button class="ig-btn ig-btn-ghost" data-act="cancel" id="um-cancel-btn">Cancel</button>' +
    '<button class="ig-btn ig-btn-primary" data-act="resume" id="um-resume-btn" style="display:none">Resume</button>' +
    "</span>" +
    "</div>" +
    "</div>" +
    '<div class="ig-toolbar">' +
    '<div class="ig-tabs" id="um-tabs"></div>' +
    '<div class="ig-toolbar-row">' +
    '<input id="um-search" class="ig-search" type="search" placeholder="Search name or @username…  (press / to focus)">' +
    '<span class="ig-chips" id="um-chips"></span>' +
    '<span class="ig-sort" id="um-sort"></span>' +
    '<span class="ig-sel" id="um-sel"></span>' +
    "</div>" +
    "</div>" +
    '<div id="um-empty" class="ig-empty"></div>' +
    '<div id="um-results" class="ig-results"></div>' +
    "</main>" +
    "</div>" +
    '<footer class="ig-footer">' +
    "<span>Runs 100% locally in your browser — no data is sent anywhere except your own read-only requests to x.com.</span>" +
    '<span>v<span id="um-ver"></span> · scans read-only · unfollow only what you confirm</span>' +
    "</footer>" +
    '<div class="ig-selbar" id="um-selbar"></div>' +
    '<div id="um-modal" class="ig-modal-root" style="display:none"></div>' +
    '<div id="um-toasts" class="ig-toasts"></div>' +
    '<input type="file" id="ig-scan-file" accept=".json,application/json" style="display:none" data-act="scan-file">' +
    "</div>";

  function shellEl() {
    var d = document.createElement("div");
    d.innerHTML = SHELL;
    return d;
  }

  function statCard(title, value, cls) {
    return (
      '<div class="ig-stat ' +
      cls +
      '"><b>' +
      esc(value) +
      "</b><span>" +
      esc(title) +
      "</span></div>"
    );
  }

  function renderPill() {
    var el = document.getElementById("um-pill");
    if (!el) return;
    var map = {
      initial: ["Ready", ""],
      scanning: ["Scanning…", "ig-pill-header-run"],
      unfollowing: ["Unfollowing…", "ig-pill-header-run"],
      throttled: ["Paused", "ig-pill-header-warn"],
      ready: ["Scan complete", "ig-pill-header-ok"],
    };
    var m = map[S.status] || map.initial;
    el.textContent = m[0];
    el.className = "ig-pill-header " + m[1];
  }

  function renderStats() {
    var el = document.getElementById("um-stats");
    if (!el) return;
    var non = 0,
      mut = 0,
      dnb = 0,
      unk = 0;
    for (var i = 0; i < S.users.length; i++) {
      var u = S.users[i];
      if (u.unknown) unk++;
      else if (isNonFollower(u)) non++;
      else if (isNotFollowedBack(u)) dnb++;
      else if (u.isMutual) mut++;
    }
    el.innerHTML =
      statCard(
        "Following",
        S.countTotal != null
          ? fmtNum(S.countTotal)
          : S.users.length
            ? fmtNum(S.users.length)
            : "—",
        "ig-stat-blue",
      ) +
      statCard(
        "Followers",
        S.followersCount != null ? fmtNum(S.followersCount) : "—",
        "ig-stat-blue",
      ) +
      statCard("Non-followers", fmtNum(non), "ig-stat-red") +
      statCard("Don't follow back", fmtNum(dnb), "ig-stat-amber") +
      statCard("Mutuals", fmtNum(mut), "ig-stat-green") +
      (unk ? statCard("Unknown", fmtNum(unk), "ig-stat-gray") : "");
  }

  function renderSafety() {
    var el = document.getElementById("um-safety");
    if (!el) return;
    var today = new Date().toISOString().slice(0, 10);
    var todayCount = 0;
    for (var i = 0; i < S.history.length; i++) {
      if (
        isScanKind(S.history[i].kind) &&
        new Date(S.history[i].t).toISOString().slice(0, 10) === today
      )
        todayCount++;
    }
    var last = S.history[0];
    var ufToday =
      S.unfollowsToday && typeof S.unfollowsToday.count === "number"
        ? S.unfollowsToday.count
        : 0;
    el.innerHTML =
      '<div class="ig-safety-grid">' +
      '<div class="ig-safety-item"><b>' +
      todayCount +
      " / " +
      S.settings.maxScansPerDay +
      "</b><span>scans today</span></div>" +
      '<div class="ig-safety-item"><b>' +
      (last ? fmtAgo(last.t) : "never") +
      "</b><span>last scan</span></div>" +
      '<div class="ig-safety-item"><b>~' +
      Math.round(S.settings.pageDelayMean / 1000) +
      "s ±" +
      Math.round(S.settings.pageDelaySpread / 1000) +
      "s</b><span>delay per page</span></div>" +
      '<div class="ig-safety-item"><b>always</b><span>auto-pause on rate-limit</span></div>' +
      '<div class="ig-safety-item"><b>' +
      fmtNum(ufToday) +
      " / " +
      S.settings.maxUnfollowsPerDay +
      "</b><span>unfollows today</span></div>" +
      '<div class="ig-safety-item"><b>~' +
      Math.round(S.settings.unfollowDelayMean / 1000) +
      "s ±" +
      Math.round(S.settings.unfollowDelaySpread / 1000) +
      "s</b><span>delay per unfollow</span></div>" +
      "</div>" +
      '<div class="ig-safety-note">Randomized human-like pacing with bursts, rests and cooldowns. Scans and unfollows stop automatically if X rate-limits them.</div>';
  }

  function renderTabs() {
    var el = document.getElementById("um-tabs");
    if (!el) return;
    var non = 0,
      mut = 0,
      dnb = 0;
    for (var i = 0; i < S.users.length; i++) {
      var u = S.users[i];
      if (isNonFollower(u)) non++;
      if (u.isMutual) mut++;
      if (isNotFollowedBack(u)) dnb++;
    }
    var tabs = [
      ["all", "All", S.users.length],
      ["nonfollowers", "Non-followers", non],
      ["dontfollowback", "Don't follow back", dnb],
      ["mutuals", "Mutuals", mut],
    ];
    var html = "";
    for (var t = 0; t < tabs.length; t++) {
      html +=
        '<button class="ig-tab' +
        (S.tab === tabs[t][0] ? " ig-tab-active" : "") +
        '" data-act="tab" data-arg="' +
        tabs[t][0] +
        '">' +
        tabs[t][1] +
        ' <span class="ig-tab-count">' +
        fmtNum(tabs[t][2]) +
        "</span></button>";
    }
    el.innerHTML = html;
  }

  function renderChips() {
    var el = document.getElementById("um-chips");
    if (!el) return;
    var chips = [
      ["verified", "✓ Verified"],
      ["private", "🔒 Private"],
    ];
    var html = "";
    for (var i = 0; i < chips.length; i++) {
      html +=
        '<button class="ig-chip' +
        (S.filter[chips[i][0]] ? " ig-chip-on" : "") +
        '" data-act="filter" data-arg="' +
        chips[i][0] +
        '">' +
        chips[i][1] +
        "</button>";
    }
    el.innerHTML = html;
  }

  function renderSort() {
    var el = document.getElementById("um-sort");
    if (!el) return;
    var opts = [
      ["default", "Default"],
      ["az", "A–Z"],
      ["za", "Z–A"],
    ];
    var html = '<span class="ig-label">Sort</span>';
    for (var i = 0; i < opts.length; i++) {
      html +=
        '<button class="ig-chip' +
        (S.sort === opts[i][0] ? " ig-chip-on" : "") +
        '" data-act="sort" data-arg="' +
        opts[i][0] +
        '">' +
        opts[i][1] +
        "</button>";
    }
    el.innerHTML = html;
  }

  function renderSel() {
    var el = document.getElementById("um-sel");
    if (!el) return;
    el.innerHTML =
      '<button class="ig-btn ig-btn-ghost" data-act="select-all" title="Select all in view (A)">All</button>' +
      '<button class="ig-btn ig-btn-ghost" data-act="select-none" title="Clear (N)">None</button>' +
      '<button class="ig-btn ig-btn-ghost" data-act="select-invert" title="Invert (I)">Invert</button>';
  }

  function renderSelbar() {
    var el = document.getElementById("um-selbar");
    if (!el) return;
    var n = S.selected.size;
    el.style.display = n ? "flex" : "none";
    if (!n) return;
    el.innerHTML =
      '<span class="ig-selbar-count"><strong>' +
      fmtNum(n) +
      "</strong> selected</span>" +
      '<span class="ig-selbar-actions">' +
      '<button class="ig-btn ig-btn-danger" data-act="unfollow-selected">Unfollow (' +
      fmtNum(n) +
      ")</button>" +
      '<button class="ig-btn ig-btn-ghost" data-act="copy-selected">Copy</button>' +
      '<button class="ig-btn ig-btn-ghost" data-act="export-selected">Export</button>' +
      '<button class="ig-btn ig-btn-ghost" data-act="select-none">Clear</button>' +
      "</span>";
  }

  function rowHtml(u) {
    var sel = S.selected.has(u.username);
    var statusPill = u.unknown
      ? '<span class="ig-pill ig-pill-unknown">status unknown</span>'
      : u.isMutual
        ? '<span class="ig-pill ig-pill-mutual">mutual</span>'
        : isNonFollower(u)
          ? '<span class="ig-pill ig-pill-non">non-follower</span>'
          : '<span class="ig-pill ig-pill-dnb">don\'t follow back</span>';
    return (
      '<div class="ig-row' +
      (sel ? " ig-row-sel" : "") +
      '">' +
      '<label class="ig-check"><input type="checkbox" class="ig-cb" data-act="toggle-user" data-arg="' +
      esc(u.username) +
      '"' +
      (sel ? " checked" : "") +
      "></label>" +
      '<a class="ig-avatar" href="https://x.com/' +
      encodeURIComponent(u.username) +
      '/" target="_blank" rel="noopener noreferrer" title="Open @' +
      esc(u.username) +
      '">' +
      '<img src="' +
      esc(u.avatar) +
      '" alt="' +
      esc(u.username) +
      '" loading="lazy" onerror="this.style.display=\'none\'">' +
      '<span class="ig-initial">' +
      esc((u.fullName || u.username || "?").charAt(0).toUpperCase()) +
      "</span>" +
      "</a>" +
      '<div class="ig-meta">' +
      '<a class="ig-profile-link" href="https://x.com/' +
      encodeURIComponent(u.username) +
      '/" target="_blank" rel="noopener noreferrer" title="Open @' +
      esc(u.username) +
      ' in a new tab">' +
      '<div class="ig-name">' +
      esc(u.fullName || u.username) +
      (u.isVerified
        ? ' <span class="ig-badge" title="Verified">✓</span>'
        : "") +
      "</div>" +
      '<div class="ig-username">@' +
      esc(u.username) +
      "</div>" +
      "</a>" +
      "</div>" +
      '<div class="ig-tags">' +
      statusPill +
      (u.isPrivate
        ? ' <span class="ig-pill ig-pill-private">private</span>'
        : "") +
      "</div>" +
      '<div class="ig-actions">' +
      (u.inFollowing !== false
        ? '<button class="ig-btn ig-btn-danger" data-act="unfollow-user" data-arg="' +
          esc(u.username) +
          '">Unfollow</button>'
        : "") +
      '<button class="ig-btn ig-btn-ghost" data-act="copy-user" data-arg="' +
      esc(u.username) +
      '">Copy</button>' +
      "</div>" +
      "</div>"
    );
  }

  function appendRow(u) {
    var r = document.getElementById("um-results");
    if (r) r.insertAdjacentHTML("beforeend", rowHtml(u));
    var e = document.getElementById("um-empty");
    if (e) e.innerHTML = "";
  }

  function renderResults() {
    var root = document.getElementById("um-results");
    var empty = document.getElementById("um-empty");
    if (!root || !empty) return;
    if (!S.users.length) {
      root.innerHTML = "";
      empty.style.display = "block";
      empty.innerHTML = "No data yet. Run a scan, or import data.";
      return;
    }
    var list = getFiltered();
    if (!list.length) {
      root.innerHTML = "";
      empty.style.display = "block";
      empty.innerHTML = "Nothing matches the current filters.";
      return;
    }
    empty.style.display = "none";
    var html = "";
    for (var i = 0; i < list.length; i++) html += rowHtml(list[i]);
    root.innerHTML = html;
  }

  function renderBanner() {
    var el = document.getElementById("um-banner");
    if (!el) return;
    if (S.status === "throttled") return; // keep the rate-limit banner (it holds the Resume button)
    if (S.forcedBanner) {
      el.innerHTML = S.forcedBanner;
      return;
    }
    if (
      S.users.length ||
      S.status === "scanning" ||
      S.status === "unfollowing"
    ) {
      el.innerHTML = "";
      return;
    }
    if (S.snapshot && S.snapshot.users && S.snapshot.users.length) {
      el.innerHTML =
        '<div class="ig-banner ig-banner-info">' +
        '<div class="ig-banner-text"><strong>Previous scan found</strong> — ' +
        fmtNum(S.snapshot.users.length) +
        " accounts analyzed on " +
        esc(new Date(S.snapshot.takenAt).toLocaleString()) +
        ".</div>" +
        '<div class="ig-banner-actions">' +
        '<button class="ig-btn ig-btn-primary" data-act="restore-snapshot">Restore it</button>' +
        '<button class="ig-btn ig-btn-ghost" data-act="dismiss-restore">Dismiss</button>' +
        "</div></div>";
      return;
    }
    el.innerHTML =
      '<div class="ig-banner ig-banner-hero">' +
      '<div class="ig-hero-icon">✦</div>' +
      '<div class="ig-hero-text"><h2>See who doesn’t follow you back</h2>' +
      "<p>Scans your <strong>following list</strong> and your <strong>followers list</strong> read-only — then flags accounts that don’t follow you back, accounts you don’t follow back, and your mutuals. You can also unfollow accounts you pick — with human-like pacing and daily caps. Nothing leaves your browser except your own X requests.</p>" +
      '<p class="ig-hero-hints">Shortcuts: <kbd>s</kbd> or <kbd>/</kbd> search · <kbd>1</kbd>–<kbd>4</kbd> tabs · <kbd>a</kbd>/<kbd>n</kbd>/<kbd>i</kbd> select all / none / invert · <kbd>Esc</kbd> close</p></div>' +
      '<button class="ig-btn ig-btn-primary ig-btn-big" data-act="scan">Start scan</button>' +
      "</div>";
  }

  function banner(kind, title, bodyHtml, action) {
    var el = document.getElementById("um-banner");
    if (!el) return;
    var kindCls = kind === "error" ? "ig-banner-error" : "ig-banner-info";
    var actionBtn =
      action === "resume"
        ? '<div class="ig-banner-actions"><button class="ig-btn ig-btn-primary" data-act="resume">Resume</button></div>'
        : "";
    var html =
      '<div class="ig-banner ' +
      kindCls +
      '">' +
      '<div class="ig-banner-text"><strong>' +
      esc(title) +
      "</strong> — " +
      bodyHtml +
      "</div>" +
      actionBtn +
      "</div>";
    S.forcedBanner = html;
    el.innerHTML = html;
  }

  function toast(msg, type) {
    var root = document.getElementById("um-toasts");
    if (!root) return;
    var t = document.createElement("div");
    t.className = "ig-toast ig-toast-" + (type || "info");
    t.innerHTML =
      "<span>" +
      esc(msg) +
      '</span><button class="ig-toast-x" data-act="toast-close">×</button>';
    root.appendChild(t);
    setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, 4500);
  }

  function renderAll() {
    applyAccent();
    renderPill();
    renderStats();
    renderSafety();
    renderTabs();
    renderChips();
    renderSort();
    renderSel();
    renderSelbar();
    renderBanner();
    renderResults();
  }

  /* ============================================================
   * 12. Modals
   * ============================================================ */
  function openModal(title, bodyHtml, footerHtml) {
    var root = document.getElementById("um-modal");
    if (!root) return;
    root.style.display = "flex";
    root.innerHTML =
      '<div class="ig-modal-backdrop" data-act="modal-close"></div>' +
      '<div class="ig-modal">' +
      '<div class="ig-modal-head"><h3>' +
      esc(title) +
      '</h3><button class="ig-btn ig-btn-ghost" data-act="modal-close">×</button></div>' +
      '<div class="ig-modal-body">' +
      bodyHtml +
      "</div>" +
      (footerHtml
        ? '<div class="ig-modal-foot">' + footerHtml + "</div>"
        : "") +
      "</div>";
  }

  function closeModal() {
    var r = document.getElementById("um-modal");
    if (r) r.style.display = "none";
  }

  function settingsBody() {
    var html = '<div class="ig-form">';
    for (var i = 0; i < SETTING_FIELDS.length; i++) {
      var f = SETTING_FIELDS[i];
      if (f.key === "unfollowDelayMean") {
        html += '<div class="ig-form-section">Unfollowing — safety rails</div>';
      }
      html +=
        '<label class="ig-field"><span>' +
        esc(f.label) +
        "</span>" +
        '<input id="ig-set-' +
        f.key +
        '" type="number" min="' +
        f.min +
        '" max="' +
        f.max +
        '" step="' +
        f.step +
        '" value="' +
        S.settings[f.key] +
        '"></label>';
    }
    html +=
      '<label class="ig-field ig-field-check"><input id="ig-set-persistSnapshot" type="checkbox"' +
      (S.settings.persistSnapshot ? " checked" : "") +
      "><span>Remember the last scan locally so you can restore it</span></label>";
    html +=
      '<label class="ig-field"><span>Accent theme</span><select id="ig-set-accent">';
    var akeys = Object.keys(ACCENTS);
    for (var a = 0; a < akeys.length; a++) {
      html +=
        '<option value="' +
        akeys[a] +
        '"' +
        (S.settings.accent === akeys[a] ? " selected" : "") +
        ">" +
        akeys[a] +
        "</option>";
    }
    html += "</select></label>";
    html +=
      '<label class="ig-field"><span>Copy format</span><select id="ig-set-copyFormat">';
    var cfOpts = [
      ["username", "Usernames only"],
      ["nameuser", "Name (@username)"],
      ["csv", "CSV table"],
    ];
    for (var c = 0; c < cfOpts.length; c++) {
      html +=
        '<option value="' +
        cfOpts[c][0] +
        '"' +
        (S.settings.copyFormat === cfOpts[c][0] ? " selected" : "") +
        ">" +
        cfOpts[c][1] +
        "</option>";
    }
    html += "</select></label></div>";
    return html;
  }

  function historyBody() {
    if (!S.history.length)
      return '<div class="ig-empty-sm">No scans yet.</div>';
    var hasUnfollow = false;
    for (var i = 0; i < S.history.length; i++) {
      if (S.history[i].kind === "unfollow") hasUnfollow = true;
    }
    var head =
      '<div class="ig-h-head"><span>When</span><span>Result</span>' +
      (hasUnfollow
        ? "<span>Summary</span>"
        : "<span>Users</span><span>Pages</span>") +
      "<span>Duration</span></div>";
    var rows = "";
    for (var i = 0; i < S.history.length; i++) {
      var h = S.history[i];
      rows +=
        '<div class="ig-h-row"><span>' +
        esc(new Date(h.t).toLocaleString()) +
        "</span>" +
        '<span class="ig-h-kind ig-h-' +
        h.kind +
        '">' +
        h.kind +
        "</span>";
      if (h.kind === "unfollow") {
        rows += '<span class="ig-h-sum">' + esc(h.warn) + "</span>";
      } else if (hasUnfollow) {
        rows +=
          "<span>" +
          h.users +
          " users · " +
          h.pages +
          " pages</span>";
      } else {
        rows +=
          "<span>" +
          h.users +
          " users</span><span>" +
          h.pages +
          " pages</span>";
      }
      rows +=
        "<span>" +
        fmtDuration(h.ms) +
        (h.kind === "unfollow" || !h.warn
          ? ""
          : ' <span title="' + esc(h.warn) + '">⚠</span>') +
        "</span></div>";
    }
    return head + rows;
  }

  /* ============================================================
   * 13. Actions (routed from data-act attributes)
   * ============================================================ */
  function compactToUser(c) {
    return {
      id: String(c[0] || ""),
      username: String(c[1] || ""),
      fullName: String(c[2] || ""),
      isVerified: !!c[3],
      isPrivate: !!c[4],
      avatar: String(c[5] || ""),
      isMutual: !!c[6],
      unknown: !!c[7],
      inFollowing: c[8] === undefined ? true : !!c[8], // old snapshots were following-only
      inFollowers: c[9] === undefined ? !!c[6] : !!c[9],
    };
  }

  function restoreSnapshot() {
    var snap = S.snapshot;
    if (!snap || !Array.isArray(snap.users)) return;
    S.users = snap.users.map(compactToUser);
    S.countTotal =
      typeof snap.countTotal === "number" ? snap.countTotal : S.users.length;
    S.followersCount =
      typeof snap.followersCount === "number" ? snap.followersCount : null;
    S.status = "ready";
    S.snapshot = null;
    toast(
      "Restored previous scan (" + S.users.length + " accounts)",
      "success",
    );
    renderAll();
  }

  function importUser(u) {
    if (Array.isArray(u)) return compactToUser(u);
    var m =
      typeof u.isMutual === "boolean"
        ? u.isMutual
        : typeof u.follows_viewer === "boolean"
          ? u.follows_viewer
          : typeof u.followed_by_viewer === "boolean"
            ? u.followed_by_viewer
            : false;
    var unk =
      typeof u.isMutual !== "boolean" &&
      typeof u.follows_viewer !== "boolean" &&
      typeof u.followed_by_viewer !== "boolean";
    return {
      id: String(u.id || ""),
      username: String(u.username || ""),
      fullName: String(u.fullName != null ? u.fullName : u.full_name || ""),
      isVerified: !!u.isVerified,
      isPrivate: !!u.isPrivate,
      avatar: String(u.avatar || u.profile_pic_url || ""),
      isMutual: m,
      unknown: unk,
      inFollowing: u.inFollowing === undefined ? true : !!u.inFollowing,
      inFollowers: u.inFollowers === undefined ? false : !!u.inFollowers,
    };
  }

  function exportJSON(users) {
    if (!users.length) {
      toast("Nothing to export", "info");
      return;
    }
    var data = JSON.stringify(
      {
        app: "unmutual-x",
        version: VERSION,
        exportedAt: new Date().toISOString(),
        counts: {
          following: S.countTotal,
          followers: S.followersCount,
          exported: users.length,
        },
        users: users,
      },
      null,
      2,
    );
    download("um-following.json", data, "application/json");
  }

  function exportCSV(list) {
    if (!list.length) {
      toast("Nothing to export", "info");
      return;
    }
    download("um-following.csv", getCopyText(list, "csv"), "text/csv");
  }

  function handleFileInput(inputId, kind) {
    var f = document.getElementById(inputId);
    if (!f || !f.files || !f.files[0]) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        var users =
          data && data.users ? data.users : Array.isArray(data) ? data : null;
        if (!users) throw new Error("Unrecognized data format");
        S.users = users.map(importUser).filter(function (u) {
          return u.username;
        });
        var counts = data && data.counts ? data.counts : null;
        S.countTotal =
          counts && typeof counts.following === "number"
            ? counts.following
            : S.users.length;
        S.followersCount =
          counts && typeof counts.followers === "number"
            ? counts.followers
            : null;
        S.status = "ready";
        renderAll();
        toast("Imported " + S.users.length + " accounts", "success");
      } catch (e) {
        toast(
          "Import failed: " + (e && e.message ? e.message : "invalid file"),
          "error",
        );
      }
    };
    reader.readAsText(f.files[0]);
    f.value = "";
  }

  function saveSettingsFromForm() {
    for (var i = 0; i < SETTING_FIELDS.length; i++) {
      var f = SETTING_FIELDS[i];
      var el = document.getElementById("ig-set-" + f.key);
      if (!el) continue;
      var v = parseFloat(el.value);
      if (isNaN(v)) v = DEFAULTS[f.key];
      S.settings[f.key] = Math.max(f.min, Math.min(f.max, v));
    }
    S.settings.pageSize = Math.max(1, Math.min(200, Math.round(S.settings.pageSize)));
    var ps = document.getElementById("ig-set-persistSnapshot");
    if (ps) S.settings.persistSnapshot = ps.checked;
    var acc = document.getElementById("ig-set-accent");
    if (acc && ACCENTS[acc.value]) S.settings.accent = acc.value;
    var cf = document.getElementById("ig-set-copyFormat");
    if (cf) S.settings.copyFormat = cf.value;
    saveSettings();
    closeModal();
    renderAll();
    toast("Settings saved", "success");
  }

  var actions = {
    scan: function () {
      scan(false);
    },
    resume: function () {
      if (S.mode === "unfollow") resumeUnfollow();
      else scan(true);
    },
    cancel: function () {
      S.cancel = true;
    },
    "unfollow-selected": function () {
      var skipped = 0;
      var users = selectedUsers().filter(function (u) {
        if (u.inFollowing === false) {
          skipped++;
          return false;
        }
        return true;
      });
      if (!users.length) {
        toast(
          "Nothing to unfollow — you don't follow these accounts",
          "info",
        );
        return;
      }
      showUnfollowConfirm(users, skipped);
    },
    "unfollow-user": function (arg) {
      var u = null;
      for (var i = 0; i < S.users.length; i++) {
        if (S.users[i].username === arg) {
          u = S.users[i];
          break;
        }
      }
      if (!u || u.inFollowing === false) return;
      showUnfollowConfirm([u], 0);
    },
    "confirm-unfollow": function () {
      startUnfollow(S.pendingUnfollow || []);
    },
    tab: function (arg) {
      S.tab = arg;
      renderTabs();
      renderResults();
      renderSelbar();
    },
    filter: function (arg) {
      S.filter[arg] = !S.filter[arg];
      renderChips();
      renderResults();
      renderSelbar();
    },
    sort: function (arg) {
      S.sort = arg;
      renderSort();
      renderResults();
    },
    "select-all": function () {
      S.selected = new Set(
        getFiltered().map(function (u) {
          return u.username;
        }),
      );
      renderResults();
      renderSelbar();
    },
    "select-none": function () {
      S.selected.clear();
      renderResults();
      renderSelbar();
    },
    "select-invert": function () {
      var cur = new Set(
        getFiltered().map(function (u) {
          return u.username;
        }),
      );
      var next = new Set();
      var it = cur.values();
      var x = it.next();
      while (!x.done) {
        if (!S.selected.has(x.value)) next.add(x.value);
        x = it.next();
      }
      S.selected = next;
      renderResults();
      renderSelbar();
    },
    "toggle-user": function (arg, btn) {
      if (S.selected.has(arg)) S.selected.delete(arg);
      else S.selected.add(arg);
      var row = btn ? btn.closest(".ig-row") : null;
      if (row && row.classList)
        row.classList.toggle("ig-row-sel", S.selected.has(arg));
      renderSelbar();
    },
    "copy-user": function (arg) {
      copyText(arg).then(function (ok) {
        toast(ok ? "Copied @" + arg : "Copy failed", ok ? "success" : "error");
      });
    },
    "copy-view": function () {
      var list = getFiltered();
      if (!list.length) {
        toast("Nothing to copy", "info");
        return;
      }
      copyText(getCopyText(list, S.settings.copyFormat)).then(function (ok) {
        toast(
          ok ? "Copied " + list.length + " usernames" : "Copy failed",
          ok ? "success" : "error",
        );
      });
    },
    "copy-selected": function () {
      var list = selectedUsers();
      if (!list.length) {
        toast("Nothing selected", "info");
        return;
      }
      copyText(getCopyText(list, S.settings.copyFormat)).then(function (ok) {
        toast(
          ok ? "Copied " + list.length + " usernames" : "Copy failed",
          ok ? "success" : "error",
        );
      });
    },
    "history-open": function () {
      openModal("Scan history", historyBody());
    },
    "export-view": function () {
      exportJSON(S.users);
    },
    "export-selected": function () {
      exportJSON(selectedUsers());
    },
    "export-csv": function () {
      exportCSV(getFiltered());
    },
    "import-scan": function () {
      var f = document.getElementById("ig-scan-file");
      if (f) f.click();
    },
    "scan-file": function () {
      handleFileInput("ig-scan-file", "scan");
    },
    "restore-snapshot": function () {
      restoreSnapshot();
    },
    "dismiss-restore": function () {
      S.snapshot = null;
      renderBanner();
    },
    "settings-open": function () {
      openModal(
        "Settings — pacing & safety",
        settingsBody(),
        '<button class="ig-btn ig-btn-primary" data-act="settings-save">Save</button>' +
          '<button class="ig-btn ig-btn-ghost" data-act="settings-reset">Reset defaults</button>' +
          '<button class="ig-btn ig-btn-ghost" data-act="modal-close">Cancel</button>',
      );
    },
    "settings-save": function () {
      saveSettingsFromForm();
    },
    "settings-reset": function () {
      if (!confirm("Reset all settings to defaults?")) return;
      S.settings = defaultSettings();
      closeModal();
      renderAll();
      toast("Settings reset", "info");
    },
    "modal-close": function () {
      closeModal();
    },
    "toast-close": function (arg, btn) {
      var t = btn ? btn.closest(".ig-toast") : null;
      if (t && t.parentNode) t.parentNode.removeChild(t);
    },
  };

  /* ============================================================
   * 14. Global event wiring (registered once per page session)
   * ============================================================ */
  function routeAction(btn) {
    var app = window.__UNM_APP__;
    if (!app || !btn || !btn.dataset) return;
    var act = btn.dataset.act;
    if (app.actions[act]) app.actions[act](btn.dataset.arg, btn);
  }

  function bindOnce() {
    if (window.__UNM_BOUND__) return;
    window.__UNM_BOUND__ = true;

    document.addEventListener("click", function (e) {
      var t = e.target;
      var btn = t && t.closest ? t.closest("[data-act]") : null;
      if (btn) routeAction(btn);
    });

    document.addEventListener("change", function (e) {
      var t = e.target;
      var btn = t && t.closest ? t.closest("[data-act]") : null;
      if (btn) routeAction(btn);
    });

    document.addEventListener("input", function (e) {
      var t = e.target;
      var app = window.__UNM_APP__;
      if (!app || !t || t.id !== "um-search") return;
      app.state.search = t.value;
      clearTimeout(app._searchTimer);
      app._searchTimer = setTimeout(function () {
        app.render();
      }, 120);
    });

    document.addEventListener("keydown", function (e) {
      var app = window.__UNM_APP__;
      if (!app) return;
      var t = e.target;
      if (e.key === "Escape") {
        app.actions["modal-close"]();
        return;
      }
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT")
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var k = String(e.key || "").toLowerCase();
      if (k === "s" || k === "/") {
        e.preventDefault();
        var si = document.getElementById("um-search");
        if (si) si.focus();
      } else if (k === "1") app.actions.tab("all");
      else if (k === "2") app.actions.tab("nonfollowers");
      else if (k === "3") app.actions.tab("dontfollowback");
      else if (k === "4") app.actions.tab("mutuals");
      else if (k === "a") app.actions["select-all"]();
      else if (k === "n") app.actions["select-none"]();
      else if (k === "i") app.actions["select-invert"]();
    });

    window.addEventListener("beforeunload", function (e) {
      var app = window.__UNM_APP__;
      if (
        app &&
        (app.state.status === "scanning" || app.state.status === "unfollowing")
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  /* ============================================================
   * 15. Boot
   * ============================================================ */
  function boot() {
    if (X_HOSTNAMES.indexOf(location.hostname) === -1) {
      alert(
        "UnMutual only runs on x.com / twitter.com. Open X (Twitter), log in, then run the bookmarklet there.",
      );
      return;
    }

    var prevApp = window.__UNM_APP__;
    if (prevApp && prevApp.state) prevApp.state.cancel = true; // stop any orphaned scan from an earlier run

    window.__UNM_APP__ = {
      version: VERSION,
      state: S,
      actions: actions,
      scan: scan,
      render: renderAll,
      utils: {
        getCookie: getCookie,
        randHuman: randHuman,
        esc: esc,
        getCopyText: getCopyText,
        buildFollowingUrl: buildFollowingUrl,
        buildFollowersUrl: buildFollowersUrl,
        detectThrottle: detectThrottle,
        normalizeUser: normalizeUser,
        getFiltered: getFiltered,
        canScan: canScan,
        getUserId: getUserId,
        fmtDuration: fmtDuration,
      },
    };

    bindOnce();

    document.title = "UnMutual — X (Twitter) Follower Insights";
    document.body.innerHTML = "";
    document.head.appendChild(styleEl());
    document.body.appendChild(shellEl());

    var ver = document.getElementById("um-ver");
    if (ver) ver.textContent = VERSION;

    renderAll();
  }

  boot();
})();
