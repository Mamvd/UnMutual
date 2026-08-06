# Changelog

All notable changes to UnMutual. Each platform script is versioned independently
(Instagram / X) — see the [README](README.md) for the full feature list.

Dates are `YYYY-MM-DD`. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Repo — tooling & packaging

- Merged the Instagram and X installers into a single `index.html` with a platform
  switcher (drag button + copy button per platform).
- Renamed `script.js` → `script-ig.js` and `test.js` → `test-ig.js` for consistent
  per-platform naming.
- Added a GitHub Actions `verify` workflow (`.github/workflows/verify.yml`) that runs
  `npm run verify` on every push and pull request and fails if `index.html` has drifted
  from the source scripts.
- The installer now names each bookmark per platform ("UnMutual — Instagram" /
  "UnMutual — X") when dragged to the bookmarks bar.

## [1.0.0] — 2026-08-07 — X (Twitter)

### Added

- New platform script `script-x.js` — the X (Twitter) incarnation of UnMutual:
  - **Two-list scan** (following + followers) via X's internal REST 1.1 endpoints
    (`i/api/1.1/friendships/list.json` and `followers/list.json`) — stable compared to
    X's rotating GraphQL query IDs.
  - **Auth** from readable browser cookies only: `twid` (logged-in user id — X's
    `auth_token` is HttpOnly and invisible to JS), and `ct0` (CSRF for confirmed unfollows).
  - **Same engine as Instagram**: stats dashboard, tabs, search & filters, selection,
    copy/export/import, and confirm-first unfollow with randomized pacing, burst/rest
    patterns, cooldowns, and hard session/daily caps.
  - **Throttle handling**: detects HTTP 429 and X error codes 88 (rate limit), 130
    (over capacity), 326 (account locked) and 64 (auth required) — pauses with a Resume
    button; auth/lock pauses are non-resumable.
  - X branding ("X (Twitter) Follower Insights"), profile links to `x.com`, and a
    `twitter` accent theme (default).
- Full headless test suite `test-x.js` (96 tests, including the minified build
  end-to-end with a scan and an unfollow).

## [2.2.0] — 2026-08-07 — Instagram

### Changed (v2 rewrite)

- **Codebase**: rewrote from a minified webpack/Preact bundle to clean, fully auditable
  vanilla JS in a single IIFE — zero dependencies, no `eval`.
- **Unfollow**: replaced automated mass-unfollow with manual, **confirm-first**
  unfollowing (per batch), with the same strict pacing model.
- **Pacing**: randomized human-like delays with bursts, rests and long cooldowns
  (previously fixed 4s / 5-action rhythm).
- **Limits**: added a daily scan cap, a minimum gap between scans, and session/daily
  unfollow caps — all configurable, with safety rails that can't be loosened.
- **Throttle**: added auto-pause with a Resume button on 429 / `rate_limit_error` /
  challenge / login-wall responses; non-resumable pauses never offer Resume.
- **UI**: modern glassy dark theme — stats dashboard, safety panel, toasts, keyboard
  shortcuts, and 4 accent themes.
- **Persistence**: settings, scan history, last-scan snapshot and the daily unfollow
  counter now live in `localStorage` under `unmutual.instagram.v2.*`, with automatic
  migration from the old `iguf.v2.*` keys.
- **Exports**: copy in 3 formats, JSON/CSV export, and re-import.
- Two-phase scan (following, then followers) so both lists are always covered, with
  id-based merging of mutuals.
