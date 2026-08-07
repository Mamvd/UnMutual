#!/usr/bin/env node
/* build.js — compile each platform script into its bookmarklet.
 *
 *   node build.js
 *
 * Produces:
 *   bookmarklet-ig.txt + bookmarklet-x.txt   — the paste-ready javascript: URLs
 *   index.html                               — one installer page for both platforms
 *
 * The minifier only strips comments and collapses whitespace; it never
 * rewrites tokens, so semantics are preserved exactly. It understands string
 * literals and regular-expression literals so comment markers inside them are
 * kept intact.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;

const isSpace = (c) =>
  c === " " ||
  c === "\t" ||
  c === "\n" ||
  c === "\r" ||
  c === "\f" ||
  c === "\v";
// A "/" starts a regex literal when the previous emitted token is one of these,
// or when the previous word is one of these keywords (e.g. "return /re/...").
const REGEX_START = "([=,:;!&|?{}";
const REGEX_KEYWORDS = [
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "do",
  "else",
  "yield",
  "throw",
  "delete",
  "void",
  "instanceof",
  "new",
];

function minify(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let mode = "code"; // code | single | double | template | regex

  while (i < n) {
    const c = src[i];

    if (mode === "code") {
      if (c === "/" && src[i + 1] === "/") {
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        i += 2;
        while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
        i += 2;
        continue;
      }
      if (c === '"') {
        mode = "double";
        out += c;
        i++;
        continue;
      }
      if (c === "'") {
        mode = "single";
        out += c;
        i++;
        continue;
      }
      if (c === "`") {
        mode = "template";
        out += c;
        i++;
        continue;
      }
      if (c === "/") {
        const trimmed = out.replace(/\s+$/, "");
        const last = trimmed.slice(-1);
        let isRegex = REGEX_START.indexOf(last) !== -1;
        if (!isRegex) {
          const m = /([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(trimmed);
          if (m && REGEX_KEYWORDS.indexOf(m[1]) !== -1) isRegex = true;
        }
        if (isRegex) {
          mode = "regex";
          out += c;
          i++;
          continue;
        }
        out += c;
        i++;
        continue;
      }
      if (isSpace(c)) {
        if (out.length && !isSpace(out[out.length - 1])) out += " ";
        i++;
        continue;
      }
      out += c;
      i++;
    } else if (mode === "regex") {
      if (c === "\\") {
        out += c;
        i++;
        if (i < n) {
          out += src[i];
          i++;
        }
        continue;
      }
      if (c === "[") {
        while (i < n) {
          out += src[i];
          if (src[i] === "\\") {
            i++;
            if (i < n) {
              out += src[i];
              i++;
            }
            continue;
          }
          if (src[i] === "]") {
            i++;
            break;
          }
          i++;
        }
        continue;
      }
      out += c;
      i++;
      if (c === "/") mode = "code";
    } else {
      const end = mode === "single" ? "'" : mode === "double" ? '"' : "`";
      out += c;
      i++;
      if (c === "\\") {
        if (i < n) {
          out += src[i];
          i++;
        }
        continue;
      }
      if (c === end) mode = "code";
    }
  }
  return out.trim();
}

/* One installer page for every platform: tabs, drag buttons, copy buttons. */
function installerHtml(platforms) {
  const tabs = platforms
    .map(
      (p, i) =>
        `        <button class="tab${i === 0 ? " active" : ""}" data-tab="${p.id}" id="tab-btn-${p.id}" role="tab" aria-selected="${i === 0}" aria-controls="tab-${p.id}">${p.label}</button>`,
    )
    .join("");
  const panels = platforms
    .map(
      (p, i) => `
    <div class="panel${i === 0 ? " active" : ""}" id="tab-${p.id}" role="tabpanel" aria-labelledby="tab-btn-${p.id}">
      <div class="card">
        <h2>${p.title} <span class="ver">${p.version}</span></h2>
        <ol>
          <li>Open <strong>${p.host}</strong> in this browser and make sure you are <strong>logged in</strong>.</li>
          <li>Drag this button to your bookmarks bar:</li>
        </ol>
        <p class="drag"><a class="bookmarklet" href="${p.url}" title="${p.title}">✦ &nbsp;UnMutual — ${p.label}</a></p>
        <p style="color:var(--mut);font-size:13px">…or copy the code below and paste it as the <strong>URL</strong> of a new bookmark. If pasting into the address bar strips the <code>javascript:</code> prefix (Chrome does this), use the bookmark manager instead — or just use the drag button above.</p>
        <textarea id="code-${p.id}" readonly spellcheck="false" translate="no">${p.url}</textarea>
        <button class="copy" data-copy="${p.id}">Copy bookmarklet</button><span class="msg" id="msg-${p.id}" aria-live="polite"></span>
      </div>
    </div>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Install the UnMutual bookmarklets — follower insights for Instagram and X (Twitter). Read-only local scans, confirm-first unfollows, no third parties.">
<meta name="theme-color" content="#0a0a0f">
<meta property="og:type" content="website">
<meta property="og:title" content="UnMutual — Follower Insights (Instagram & X)">
<meta property="og:description" content="Zero-dependency bookmarklets that scan your following/followers lists and flag non-followers. 100% local, confirm-first unfollows.">
<meta property="og:url" content="https://github.com/Mamvd/UnMutual">
<link rel="canonical" href="https://github.com/Mamvd/UnMutual">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%E2%9C%A6%3C/text%3E%3C/svg%3E">
<title>UnMutual — Install</title>
<style>
  :root{--bg:#0a0a0f;--panel:#12121a;--card:#171722;--line:#26263a;--text:#e9e9f2;--mut:#8b8ba5;--grad-ig:linear-gradient(135deg,#f09433,#dc2743 55%,#bc1888);--grad-x:linear-gradient(135deg,#1d9bf0,#0f90e8 55%,#7856ff)}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.55;padding:40px 16px}
  body[data-accent="ig"]{--grad:var(--grad-ig)}
  body[data-accent="x"]{--grad:var(--grad-x)}
  .wrap{max-width:760px;margin:0 auto}
  h1{font-size:24px;margin:0 0 4px}
  .sub{color:var(--mut);margin:0 0 22px}
  .tabs{display:flex;gap:8px;margin-bottom:16px}
  .tab{border:1px solid var(--line);background:var(--card);color:var(--mut);border-radius:999px;padding:8px 18px;font-size:14px;cursor:pointer;transition:color .15s,border-color .15s,background-color .15s}
  .tab:hover{color:var(--text)}
  .tab:focus-visible{outline:2px solid var(--mut);outline-offset:2px}
  .tab.active{color:#fff;border-color:transparent;background:var(--grad)}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:16px}
  .panel{display:none}.panel.active{display:block}
  ol{margin:0 0 16px;padding-left:20px}
  li{margin-bottom:8px}
  .drag{text-align:center;margin:8px 0 4px}
  .bookmarklet{display:inline-block;padding:14px 26px;border-radius:12px;color:#fff;text-decoration:none;font-weight:700;font-size:15px;background:var(--grad);box-shadow:0 8px 24px rgba(0,0,0,.35)}
  .bookmarklet:focus-visible{outline:2px solid var(--mut);outline-offset:2px}
  textarea{width:100%;height:110px;background:var(--card);border:1px solid var(--line);color:var(--text);border-radius:10px;padding:10px;font-size:11px;font-family:ui-monospace,Menlo,Consolas,monospace;margin:10px 0}
  button.copy{background:var(--grad);border:none;color:#fff;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer}
  button.copy:focus-visible{outline:2px solid var(--mut);outline-offset:2px}
  .msg{color:var(--mut);font-size:13px;margin-left:10px}
  .ver{color:var(--mut);font-weight:400;font-size:13px}
  .note{font-size:12.5px;color:var(--mut);border-left:2px solid #4ade80;padding-left:10px}
  code{background:var(--card);border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-size:12px}
</style>
</head>
<body data-accent="ig">
<div class="wrap">
  <h1>UnMutual — Follower Insights</h1>
  <p class="sub">Pick a platform, install its bookmarklet, then run it on the platform while logged in.</p>

  <div class="tabs" role="tablist" aria-label="Platform">${tabs}</div>
  ${panels}

  <div class="card note">
    <strong>Good to know:</strong> these tools run 100% locally in your browser. They only ever talk to the
    platform they run on, perform <strong>read-only</strong> requests, never touch your password, and do not
    unfollow anyone without your explicit confirmation. No data is sent to any third party. Automated activity
    can still violate a platform's Terms of Service — use responsibly, at your own risk.
  </div>
</div>
<script>
  var tabs = document.querySelectorAll(".tab");
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener("click", function () {
      var id = this.getAttribute("data-tab");
      var all = document.querySelectorAll(".tab");
      for (var j = 0; j < all.length; j++) all[j].classList.remove("active");
      this.classList.add("active");
      for (var j2 = 0; j2 < all.length; j2++) {
        all[j2].setAttribute("aria-selected", all[j2] === this ? "true" : "false");
      }
      document.body.setAttribute("data-accent", id);
      var panels = document.querySelectorAll(".panel");
      for (var k = 0; k < panels.length; k++) {
        panels[k].classList.toggle("active", panels[k].id === "tab-" + id);
      }
    });
  }
  var copies = document.querySelectorAll("button.copy");
  for (var c = 0; c < copies.length; c++) {
    copies[c].addEventListener("click", function () {
      var id = this.getAttribute("data-copy");
      var ta = document.getElementById("code-" + id);
      var msg = document.getElementById("msg-" + id);
      ta.select();
      ta.setSelectionRange(0, 999999999);
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) {}
      if (!ok && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value).then(
          function () { msg.textContent = "Copied!"; },
          function () { msg.textContent = "Copy failed — select the code manually."; }
        );
        return;
      }
      msg.textContent = ok ? "Copied!" : "Copy failed — select the code manually.";
    });
  }
</script>
</body>
</html>
`;
}

/* Each platform: source script → bookmarklet file; installers are merged into
   one index.html at the end. */
const PLATFORMS = [
  {
    id: "ig",
    label: "Instagram",
    src: "script-ig.js",
    bookmarklet: "bookmarklet-ig.txt",
    title: "UnMutual — Instagram Follower Insights",
    version: "v2.2",
    host: "instagram.com",
  },
  {
    id: "x",
    label: "X (Twitter)",
    src: "script-x.js",
    bookmarklet: "bookmarklet-x.txt",
    title: "UnMutual — X (Twitter) Follower Insights",
    version: "v1.0",
    host: "x.com / twitter.com",
  },
];

function build() {
  const built = [];
  for (const platform of PLATFORMS) {
    const src = fs.readFileSync(path.join(ROOT, platform.src), "utf8");
    const min = minify(src);

    // The minifier must never break the program: verify it still parses.
    try {
      new Function(min);
    } catch (e) {
      console.error(`✖ Minified output (${platform.src}) does not parse:`, e.message);
      console.error(
        "  (If you added a regex/string containing '//' or '/*', check build.js minify().)",
      );
      process.exit(1);
    }

    const url = "javascript:" + encodeURIComponent(min);
    const bytes = Buffer.byteLength(url, "utf8");
    fs.writeFileSync(path.join(ROOT, platform.bookmarklet), url);
    built.push({
      id: platform.id,
      label: platform.label,
      title: platform.title,
      version: platform.version,
      host: platform.host,
      url: url,
    });

    console.log(
      `✔ ${platform.bookmarklet.padEnd(19)} ${bytes} bytes  (${min.length} chars minified)`,
    );
    if (bytes > 200000) {
      console.warn(`⚠ ${platform.id}: bookmarklet is large — very old browsers may truncate it.`);
    } else {
      console.log(`✔ ${platform.id}: within safe size limits for modern browsers.`);
    }
  }

  fs.writeFileSync(path.join(ROOT, "index.html"), installerHtml(built));
  console.log(
    `✔ index.html           ${fs.statSync(path.join(ROOT, "index.html")).size} bytes (merged installer)`,
  );
}

if (require.main === module) build();

module.exports = { minify };
