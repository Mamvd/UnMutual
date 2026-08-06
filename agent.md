# Agent.md — working in this repo

Guidance for AI agents and contributors working on this codebase. Read this before
editing anything.

## What this project is**UnMutual — Follower Insights** — a family of single-file browser
**bookmarklets** (a `javascript:` URL), one per platform:

| Platform | Script | Runs on | Storage namespace |
|---|---|---|---|
| Instagram | `script-ig.js` (v2.2) | `instagram.com` | `unmutual.instagram.v2.*` |
| X (Twitter) | `script-x.js` (v1.0) | `x.com` / `twitter.com` | `unmutual.x.v2.*` |

Each scans the user's own **following list and followers list** via the platform's
read-only internal API, flags accounts that do not follow back ("non-followers")
and accounts the user doesn't follow back ("Don't follow back"), provides stats, search,
filters, and exports — and can **unfollow accounts the user explicitly selects and
confirms**, with strict safety rails. Everything below applies to both scripts
unless a section says otherwise.

- **User-confirmed writes only** — unfollowing was added on explicit user request, and
  it is the *only* write action. It requires a confirm dialog per batch, only ever
  touches accounts the user actually follows (the unfollow POST needs a real
  friendship), and runs under pacing + daily/session caps. Do **not** add unattended
  automation (unfollow-all, follow-backs, comments, DMs) or remove the confirmation /
  caps.
- **Anti-detection approach** — also an explicit user decision: *strict pacing*.
  Randomized human-like delays, burst/rest patterns, cooldowns, daily scan caps, and
  auto-pause when Instagram rate-limits. Do **not** add proxy rotation, fingerprint
  spoofing, or CAPTCHA solving.
- Everything runs locally in the page. No data leaves the browser except the
  Instagram requests themselves: read-only GETs for scans, and the confirmed unfollow
  POSTs.

## Naming (the "UnMutual" brand)

**UnMutual is the brand** — the general umbrella. Each platform has its own script
(the *Instagram* and *X/Twitter* incarnations), so keep identifiers platform-neutral:

- **Visible branding** says `UnMutual` with a platform qualifier only where it helps
  (e.g. the hero subtitle "Instagram Follower Insights"). Never use
  "Instagram Unfollowers" anywhere.
- **Element ids** use the short prefix `um-*` (e.g. `um-stats`, `um-results`).
- **Window hook** is `window.__UNM_APP__` (bound once via `window.__UNM_BOUND__`).
- **localStorage** is namespaced by platform: `unmutual.instagram.v2.*` for the
  Instagram script and `unmutual.x.v2.*` for the X (Twitter) script (the
  `unmutual.<platform>.v2.*` convention). Old `iguf.v2.*` keys are migrated
  automatically by `migrateStorage()` in `script-ig.js` (called once at script eval);
  `script-x.js` has no legacy keys and no migration.
- **CSS classes** keep the short `ig-*` prefix (e.g. `ig-btn`) — treated as a generic
  UI class namespace shared across platform scripts, not as brand.

## Files

| File | Role |
|---|---|
| `script-ig.js` | **Instagram platform script** — a single IIFE, vanilla JS, zero dependencies. |
| `script-x.js` | **X (Twitter) platform script** — sibling of `script-ig.js`: same engine, platform-specific API layer (section 6), auth cookies and boot guard (section 15). |
| `build.js` | Minifies each platform script (comments/whitespace only) → URL-encodes it → writes `bookmarklet-ig.txt` + `bookmarklet-x.txt` + one merged `index.html` installer (platform tabs). |
| `test-ig.js` | Headless smoke tests for `script-ig.js` (stubbed DOM/fetch/localStorage). |
| `test-x.js` | Headless smoke tests for `script-x.js` — same coverage, X-specific REST fixtures. |
| `bookmarklet-ig.txt` / `bookmarklet-x.txt` | Generated — the paste-ready `javascript:` URLs. Never hand-edit. Git-ignored (regenerate with `npm run build`); `index.html` is the committed artifact. |
| `index.html` | Generated merged installer. Never hand-edit. |
| `README.md` | User-facing docs (features, install, safety notes). |
| `CHANGELOG.md` | Release notes per platform version. |
| `package.json` | Dev scripts only (`build` / `test` / `check` / `verify`). No runtime dependencies. |
| `LICENSE` | MIT license (© 2026 Mamvd). |
| `.gitignore` | Ignore list: build output, OS/editor junk. |

## Commands

```bash
npm run check    # node --check script-ig.js && node --check script-x.js (syntax check)
npm test         # node test-ig.js && node test-x.js — smoke tests (must print "N passed, 0 failed") — each ALSO runs its minified build end-to-end
npm run build    # node build.js — rebuild bookmarklet-ig.txt + bookmarklet-x.txt + index.html; check the byte counts
npm run verify   # check + test + build, in sequence
```

Run **all three** (`npm run verify`) after any change to a platform script. Run
`node --check test-ig.js` / `node --check test-x.js` / `node --check build.js` after editing those.

## Hard constraints — the "why"

1. **Single-file IIFE.** No imports, no `<script src>`, no CDNs, no `eval`/`new
   Function` in the bookmarklet. Any new code must fit inside the existing IIFE.
2. **User-confirmed writes only.** The single write action is unfollowing accounts the
   user explicitly selected and confirmed (`startUnfollow`, section 7.5). Never add
   automated writes, never unfollow without the confirm dialog, never bypass caps.
3. **Pacing policy (agreed).** Keep the strict-pacing model. Defaults are deliberately
   conservative; users can tune them in Settings, but never loosen the *safety rails*
   (caps, auto-pause) without flagging it.
4. **Network policy.** Per platform script, the only external calls allowed are
   read-only GETs to the platform's list endpoints (Instagram: `instagram.com/graphql/…`
   via `buildFollowingUrl`; X/Twitter: `x.com/i/api/1.1/friendships/list.json` and
   `followers/list.json`) and the single unfollow POST (Instagram:
   `instagram.com/web/friendships/<id>/unfollow/`; X:
   `x.com/i/api/1.1/friendships/destroy.json?user_id=<id>`) — see `unfollowOne`.
   Nothing else, ever. X's GraphQL query IDs rotate, so `script-x.js` deliberately
   uses the stable REST 1.1 endpoints; if X shuts them down, only its section 6 changes.
5. **Security invariants:**
   - Escape **all** user-controlled data in HTML: use `esc()`; never interpolate raw.
   - Cookies are only read (Instagram: `ds_user_id` / `csrftoken`; X/Twitter:
     `auth_token` / `twid` / `ct0`), never written or stored beyond the request.
   - localStorage keys are namespaced per platform: `unmutual.instagram.v2.*`
     (`script.js`) and `unmutual.x.v2.*` (`script-x.js`). New platform scripts must
     use their own `unmutual.<platform>.v2.*` namespace so they never collide with
     each other.
   - All persistence wrapped in try/catch (bookmarklets run on pages you don't control).
6. **Minifier constraint.** `build.js` strips comments/whitespace and understands
   string/regex literals (regex detection is char- and keyword-based: after
   `([=,:;!&|?{` or after words like `return`/`typeof`/`case`). A regex literal
   containing an unescaped `//` or `/*` will corrupt the build (or fail its parse
   check). If you need such a pattern, escape it or update the minifier. `test-ig.js`
   and `test-x.js` execute the minified outputs, so semantic breakage is caught automatically.
7. **Event routing.** UI clicks/changes go through `data-act` attributes handled by the
   `actions` object (section 13). Document-level listeners bind **once per page
   session** (`window.__UNM_BOUND__`) and must read state via
   `window.__UNM_APP__` — the bookmarklet can be re-run, and old listeners must keep
   working with fresh state. Add new features as `actions.*` keys + `data-act` markup.
8. **Testability.** Expose anything tests need through `window.__UNM_APP__`
   (`state`, `actions`, `scan`, `utils`). Don't call `window.__UNM_APP__` from
   production logic for real behavior — it's the public surface for tests/debugging.

## Architecture map (sections inside `script-ig.js`)

`script-x.js` mirrors the same section layout. Only these sections differ between
platforms: **1** (constants: hostnames, storage keys, throttle keys, accents),
**3** (no migration in `script-x.js`), **6** (API: URLs, headers, `getUserId` from
the `twid` cookie, `normalizeUser`), **7** (login check uses `auth_token` + `twid`,
REST response parsing), **7.5** (unfollow uses `ct0` + `friendships/destroy.json`),
and **15** (boot guard + branding). Everything else — pacing, UI, analysis,
exports, actions, event wiring — is shared verbatim.

| Section | Contents |
|---|---|
| 1 | `DEFAULTS` (strict pacing profile), `SETTING_FIELDS`, `ACCENTS`, `THROTTLE_KEYS` |
| 2 | Utils: `getCookie`, `esc`, `fmtNum`, `fmtDuration`, `fmtAgo`, `randHuman` (bell-shaped, clamped), `sleepInterruptible` |
| 3 | Persistence: `loadJSON`, `loadSettings`/`defaultSettings`, `saveSettings`, `saveHistory`, `saveSnapshot` |
| 4 | State object `S` (status, users, selection, tabs, filters, settings, history, snapshot) |
| 5 | Pacing engine: `scanPause` (bursts/cooldowns), `canScan` (daily cap + min gap) |
| 6 | API: `buildFollowingUrl`, `buildFollowersUrl` (query-hash fallback), `detectThrottle`, `normalizeUser` (list-aware: sets `inFollowing` / `inFollowers`) |
| 7 | `scan(resume)` — two-phase paginated loop (following phase → followers phase), per-phase page cap so one list can't starve the other, id-merge dedupe, throttle → `status="throttled"` + Resume (only when resumable), cancel, history kinds: done / capped / cancelled / throttled / error, snapshot |
| 7.5 | Unfollow engine: `canUnfollow` (daily cap), `unfollowOne` (POST + csrf), `unfollowStep` (paced loop, throttle → resume, session cap), `onUnfollowed` (removes user, persists daily counter), `showUnfollowConfirm` |
| 8 | Analysis: `isNonFollower`, `isNotFollowedBack`, `getFiltered` (tab → search → chips → sort), `selectedUsers` |
| 9 | Clipboard + export: `copyText`/`legacyCopy`, `csvField`, `getCopyText`, `download` |
| 10–11 | CSS (single `CSS` string), shell (`SHELL`), render functions (each writes a `#um-*` element) |
| 12 | Modals: settings, unfollow confirm, scan history |
| 13 | `actions` object — the `data-act` → handler map |
| 14 | `bindOnce()` — document-level click/change/input/keydown/beforeunload, routed through `window.__UNM_APP__` |
| 15 | `boot()` — hostname guard, wipe `document.body`, inject styles, render |

### Data semantics (don't get these wrong)

- The following-list GraphQL response is `data.user.edge_follow` →
  `{ count, page_info: { has_next_page, end_cursor }, edges: [{ node }] }`; the
  followers list is `data.user.edge_followed_by` with the same shape.
- The scan runs **two phases** — following first, then followers — so each list's
  `count` is captured (`S.countTotal` / `S.followersCount`) and users from both lists
  are merged by user id. A user who appears in both lists is mutual.
- On a **following-list** node, `follows_viewer` means *"this user follows you back"* —
  that's the mutual flag. On a **followers-list** node, `follows_viewer` means *"you
  follow this user back"*.
- `normalizeUser(node, isFollowingList)` records which list the user came from
  (`inFollowing` / `inFollowers`); `isNotFollowedBack` = in the followers list but not
  mutual and not unknown. If a flag isn't a boolean, mark the user **`unknown`**
  (never guess — unknown users are excluded from the non-followers count).
- Pagination uses `first` (24 or 50, configurable) + `after` cursor.

## Testing conventions- `test-ig.js` (Instagram) and `test-x.js` (X/Twitter) each seed instant pacing + high caps into the storage stub **before** their script runs, so scans complete
  immediately. `test-x.js` stubs the REST endpoints (`friendships/list.json`,
  `followers/list.json`, `friendships/destroy.json`) and the `auth_token` / `twid` /
  `ct0` cookies.
- The fake fetch serves pages keyed off the `after` cursor; 8 users / 3 per page.
- Assertions read rendered output via `registry.get("um-<id>")._html`.
- The last test executes the **minified output** (`minify(script-ig.js)`) in a fresh VM and
  runs a scan **and an unfollow** — this is what guarantees `build.js` never changes
  semantics on any code path.
- Unfollow tests cover: full flow, throttle + resume, non-resumable pause (login wall
  → Resume hidden/rejected), daily cap (partial + hard), missing csrftoken, per-row
  action, exclusion of don't-follow-back accounts (they can't be unfollowed), history
  recording, and the guard that blocks unfollowing while a scan is paused.
- The fake fetch serves **two lists** — following (`edge_follow`, keyed by the `after`
  cursor) and followers (`edge_followed_by`) — so tests cover both scan phases, the
  merged mutuals, and the "Don't follow back" tab.
- The DOM stub is minimal — it only implements APIs the source actually uses
  (`getElementById`, `innerHTML`, `insertAdjacentHTML`, `appendChild`, `style`,
  `classList`, …). If you add new DOM APIs to `script-ig.js` / `script-x.js`, extend the stub.
- Don't rename the `um-*` element ids used by render functions and tests without
  updating both.

## Judgment calls to preserve

- Keep messages honest: scans are described as "read-only" and unfollowing is always
  framed as "only what you confirm" — keep them truthful.
- The safety panel and Settings expose pacing for **both** scans and unfollows; any new
  pacing-affecting setting must also be reflected there. The daily unfollow counter
  persists in `unmutual.instagram.v2.unfollows` and must never be resettable by the user (it's a
  safety rail).
- Non-resumable pauses (login walls, `feedback_required`) must never offer Resume —
  only a clear "re-run the bookmarklet" message. Unfollows must never start while a
  scan is paused (`status === "throttled"` with `mode === "scan"` blocks
  `startUnfollow`).
- The scan is deliberately **two-phase** (following then followers): the page cap is
  enforced per phase so a huge following list can't starve the followers list (which
  would break the "Don't follow back" category). Keep it that way.
- Instagram automation violates their ToS — keep the tool conservative. If a user
  request would automate writes (unattended unfollow-all, follow-backs) or evade
  detection (proxies, fingerprint spoofing, CAPTCHA solving), decline and explain, and
  offer the responsible alternative.
