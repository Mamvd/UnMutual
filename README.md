# UnMutual — Follower Insights

[![verify](https://github.com/Mamvd/UnMutual/actions/workflows/verify.yml/badge.svg)](https://github.com/Mamvd/UnMutual/actions/workflows/verify.yml)

**Zero-dependency, single-file bookmarklets** that run inside a social platform's web app while you are logged in. UnMutual scans **your** following list and **your** followers list using the same read-only internal API requests the platform's own web app makes, then tells you who doesn't follow you back — and lets you **unfollow only the accounts you explicitly select and confirm**, with human-like pacing and hard safety caps.

Everything runs **100% locally in your browser**: no servers, no accounts, no third parties. The only network traffic is your own read-only requests to the platform, plus the unfollow requests you personally confirm.

> ⚠️ **Terms of Service.** Any automation on a social platform — even read-only scans — can violate the platform's ToS and trigger temporary action blocks. UnMutual is deliberately conservative: capped, self-pausing, and it never unfollows without your explicit confirmation. **Use at your own risk.**

---

## Platforms

| Platform | Source script | Bookmarklet output |
| --- | --- | --- |
| **Instagram** | `script-ig.js` | `bookmarklet-ig.txt` |
| **X (Twitter)** | `script-x.js` | `bookmarklet-x.txt` |

Both platform scripts share the same architecture, features and safety model — only the platform API layer, auth and branding differ. `npm run build` produces both bookmarklets plus a single merged installer (`index.html`) with a platform switcher.

> **Note on the X (Twitter) build:** it targets the stable internal REST 1.1 endpoints (`i/api/1.1/…`) rather than X's GraphQL query IDs, which rotate frequently. If X ever changes these endpoints, only the API section (section 6) of `script-x.js` needs updating.

---

## Table of contents

- [Features](#features)
- [How it works](#how-it-works)
- [Install](#install)
- [Usage](#usage)
- [Safety & anti-detection](#safety--anti-detection)
- [Security & privacy](#security--privacy)
- [Project structure](#project-structure)
- [Development](#development)
- [Version history](#version-history)
- [License](#license)
- [Disclaimer](#disclaimer)

---

## Features

- **Two-list scan** — paginates **both** your following and followers lists (read-only GraphQL), with a progress bar, phase indicator, page counter and ETA.
- **Stats** — following / followers / non-followers / don't-follow-back / mutuals / unknown, straight from the API counts.
- **Tabs** — All · Non-followers · Don't follow back · Mutuals.
- **Search & filters** — name/username search, verified / private chips, sort A–Z / Z–A.
- **Selection** — select all / none / invert in the current view; copy or export the selection.
- **Unfollow** — pick accounts (selected or per-row) → a confirm dialog shows the non-follower / mutual / unknown breakdown → unfollows run **one at a time** with randomized human pacing, bursts, rests and cooldowns, a live progress bar and a per-account success/fail log. Accounts you don't follow can't be unfollowed.
- **Copy** — usernames, `Name (@username)`, or CSV; clipboard API with legacy fallback.
- **Export / import** — full data as JSON, current view as CSV; re-import later or into other tools.
- **Safety** — randomized pacing, daily scan cap, cooldown between scans, always-on auto-pause when Instagram rate-limits (no toggle), scan history, and a `beforeunload` guard while scanning.
- **Persistence** — settings, history and the last-scan snapshot live in `localStorage` (keys `unmutual.instagram.v2.*`); restore a previous scan after reload.
- **Keyboard** — `s` / `/` focus search · `1`–`4` tabs · `a` / `n` / `i` select all/none/invert · `Esc` close.
- **Profile links** — every username and avatar links to the profile and opens in a new tab (`target="_blank"`, `rel="noopener noreferrer"`).

## How it works

The scan runs in **two phases** — following first, then followers — so each list is walked and users appearing in both lists are merged by user id into a single dataset (those are your **mutuals**). The app then classifies every account:

| Category | Definition |
| --- | --- |
| **Non-followers** | You follow them, they don't follow you back |
| **Don't follow back** | They follow you, you don't follow them back |
| **Mutuals** | You follow each other |
| **Unknown** | The API didn't report the follow flag — never guessed, excluded from counts |

> On Instagram, list totals come straight from the API; on X the REST lists don't report totals, so the Following/Followers stats reflect everything the scan has seen so far.

On a **following-list** node, `follows_viewer` means *"this user follows you back"*; on a **followers-list** node, `followed_by_viewer` means *"you follow this user back"*. If a flag isn't a boolean, the account is marked **unknown** — the app never guesses.

## Install

No dependencies, no build tools to install. You need **Node.js ≥ 14** only to (re)build.

```bash
npm run build        # generates bookmarklet-ig.txt + bookmarklet-x.txt + index.html
```

Then:

1. Open **`index.html`** in a browser and pick your platform (Instagram or X/Twitter).
2. **Drag the button** for that platform to your bookmarks bar — or copy the code from its textarea and paste it as the **URL** of a new bookmark.
   > Chrome strips `javascript:` URLs pasted into the address bar, so use the bookmark manager or the drag button.
3. Open the platform (instagram.com or x.com), log in, then click the bookmark.

The whole app ships inside the bookmark itself — no external files, no CDNs.

## Usage

1. Click the bookmarklet on an open `instagram.com` or `x.com` tab (you must be logged in).
2. Click **Scan** — the app walks your following and followers lists with randomized human-like pacing.
3. Browse the tabs, search, filter and select accounts.
4. To unfollow: select accounts (or use the per-row button) → review the breakdown in the confirm dialog → confirm. Unfollows run one at a time, paced, and stop at the daily cap. **Only what you confirm is ever unfollowed.**

If Instagram responds with a rate-limit / challenge / login-wall signal, the scan **stops automatically** and shows a **Resume** button — nothing is lost, and it continues exactly where it stopped. Non-resumable pauses (login walls, `feedback_required`) never offer Resume; they tell you to reload and re-run.

## Safety & anti-detection

The engine never sends requests in a fixed rhythm. Between page fetches it uses a **bell-shaped random delay** (clamped to a plausible human range), inserts **longer rests after bursts**, and **long cooldowns** periodically. It enforces a **daily scan cap** and a **minimum gap between scans**. When Instagram responds with a rate-limit / challenge / login-wall signal (429/401/403, `rate_limit_error`, `feedback_required`, `checkpoint_challenge_required`, HTML login wall, …), work stops and waits for you to click **Resume** — it never retries aggressively or hides from the response.

Unfollowing gets the same treatment on top of explicit confirmation: randomized delay between actions, a rest after every burst, a longer cooldown every N unfollows, a hard **session cap**, and a **daily cap** that persists across reloads and can't be reset by the user.

Defaults are deliberately conservative; all pacing values are tunable in **Settings** — but the safety rails (caps, auto-pause) stay on. Unattended automation (unfollow-all, follow-backs) and evasion techniques (proxy rotation, fingerprint spoofing, CAPTCHA solving) are intentionally out of scope.

## Security & privacy

- Only ever contacts the platform it runs on — `instagram.com` or `x.com` — for read-only list requests and the single unfollow endpoint you trigger by confirming an unfollow. **No third parties.**
- No `eval`, `new Function`, or external scripts in the bookmarklet.
- All user data is rendered through an HTML-escaper; nothing is interpolated unsafely.
- Cookies are only **read** (`ds_user_id` for scans, `csrftoken` for confirmed unfollows), never written or stored beyond the request.
- Everything is local — you can audit the entire source in `script-ig.js` / `script-x.js`.

## Project structure

| File | Purpose |
| --- | --- |
| `script-ig.js` | **Instagram bookmarklet source** — a single IIFE, vanilla JS, zero dependencies. |
| `script-x.js` | **X (Twitter) bookmarklet source** — the X sibling of `script-ig.js` (same engine, platform-specific API layer). |
| `build.js` | Minifies each platform script (comments/whitespace only) → URL-encodes it → writes `bookmarklet-ig.txt` + `bookmarklet-x.txt` + one merged `index.html` installer. |
| `test-ig.js` | Headless smoke tests for `script-ig.js` (stubbed DOM/fetch/localStorage). Also runs the minified build end-to-end. |
| `test-x.js` | Headless smoke tests for `script-x.js` — same coverage with X-specific API fixtures. |
| `index.html` | Generated installer page (platform switcher, drag-to-bookmarks). Committed so users can install without building. |
| `bookmarklet-ig.txt` / `bookmarklet-x.txt` | Generated, git-ignored, regenerable — the paste-ready `javascript:` URLs. Never hand-edit. |
| `agent.md` | Working guidance for AI agents and contributors (architecture map, hard constraints, conventions). |
| `package.json` | Dev scripts only (`build` / `test` / `check` / `verify`). No runtime dependencies. |
| `LICENSE` | MIT license (© 2026 Mamvd). |
| `.gitignore` | Ignore list: build output, OS/editor junk. |

## Development

```bash
npm run check    # syntax-check script-ig.js + script-x.js
npm test         # headless smoke suites for both platforms (must print "N passed, 0 failed")
npm run build    # rebuild bookmarklet-ig.txt + bookmarklet-x.txt + index.html; check the byte counts
npm run verify   # all three in sequence — run before committing
```

Notes for contributors:

- **CI:** GitHub Actions runs `npm run verify` on every push and pull request (`.github/workflows/verify.yml`), and fails if the committed `index.html` has drifted from the source scripts.
- The `bookmarklet-*.txt` and `index.html` files are **generated** — edit the platform script, then run `npm run build`.
- `npm test` executes the minified build output in a fresh sandbox and runs a scan **and** an unfollow, so any semantic break in the minifier is caught automatically.
- If you add a regex containing an unescaped `//` or `/*` to a platform script, check the minifier in `build.js`.
- Full architecture map, naming conventions and hard constraints live in [`agent.md`](agent.md) — read it before editing anything.

## Version history

Full release notes in [CHANGELOG.md](CHANGELOG.md).

| Area | Old (v1) | New (v2) |
| --- | --- | --- |
| Codebase | Minified webpack + Preact bundle | Clean, readable vanilla JS — fully auditable |
| Unfollow | Automated mass-unfollow via POST | Manual, confirm-first unfollow with pacing & caps |
| Pacing | Fixed delays (4s / 5 actions) | Random human-like delays, bursts, rests, cooldowns |
| Limits | None | Daily scan cap + min-time-between-scans + daily/session unfollow caps (all configurable) |
| Throttle | N/A | Auto-pauses on 429 / rate_limit / challenge / login-wall responses, resume button |
| UI | Basic dark theme | Modern glassy UI, stats dashboard, safety panel, toasts, shortcuts, 4 accent themes |
| Persistence | Whitelist only | Settings + scan history + last-scan snapshot + daily unfollow counter (all `unmutual.instagram.v2.*`) |
| Exports | Copy list only | Copy (3 formats) + JSON/CSV export + import |

## License

Released under the [MIT License](LICENSE) — © 2026 Mamvd. You are free to use, copy, modify, and distribute it, provided the copyright and permission notice are preserved.

## Disclaimer

UnMutual is provided as-is, without warranty. Automated activity on Instagram can result in temporary action blocks or permanent account restrictions. You are responsible for how you use this tool — keep it conservative, and use it at your own risk.
