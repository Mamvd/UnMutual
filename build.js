#!/usr/bin/env node
/* build.js — compile script.js into a bookmarklet.
 *
 *   node build.js
 *
 * Produces:
 *   bookmarklet.txt  — the full "javascript:" URL, paste it as a bookmark
 *   index.html       — a small installer page with a drag-to-bookmarks button
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

function installerHtml(url) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>UnMutual — Install</title>
<style>
  :root{--bg:#0a0a0f;--panel:#12121a;--card:#171722;--line:#26263a;--text:#e9e9f2;--mut:#8b8ba5}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.55;padding:40px 16px}
  .wrap{max-width:760px;margin:0 auto}
  h1{font-size:24px;margin:0 0 4px}
  .ver{color:var(--mut);font-weight:400;font-size:14px}
  .sub{color:var(--mut);margin:0 0 26px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:16px}
  ol{margin:0 0 16px;padding-left:20px}
  li{margin-bottom:8px}
  .drag{text-align:center;margin:8px 0 4px}
  .bookmarklet{display:inline-block;padding:14px 26px;border-radius:12px;color:#fff;text-decoration:none;font-weight:700;font-size:15px;background:linear-gradient(135deg,#f09433,#dc2743 55%,#bc1888);box-shadow:0 8px 24px rgba(220,39,67,.35)}
  textarea{width:100%;height:110px;background:var(--card);border:1px solid var(--line);color:var(--text);border-radius:10px;padding:10px;font-size:11px;font-family:ui-monospace,Menlo,Consolas,monospace;margin:10px 0}
  button{background:linear-gradient(135deg,#f09433,#dc2743 55%,#bc1888);border:none;color:#fff;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer}
  #msg{color:var(--mut);font-size:13px;margin-left:10px}
  .note{font-size:12.5px;color:var(--mut);border-left:2px solid #4ade80;padding-left:10px}
  code{background:var(--card);border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-size:12px}
</style>
</head>
<body>
<div class="wrap">
  <h1>UnMutual — Instagram Follower Insights <span class="ver">v2.2</span></h1>
  <p class="sub">Install the bookmarklet, then run it on instagram.com while logged in.</p>

  <div class="card">
    <ol>
      <li>Open <strong>instagram.com</strong> in this browser and make sure you are <strong>logged in</strong>.</li>
      <li>Drag this button to your bookmarks bar:</li>
    </ol>
    <p class="drag"><a class="bookmarklet" href="${url}" title="UnMutual — Instagram Follower Insights">✦ &nbsp;UnMutual</a></p>
    <p style="color:var(--mut);font-size:13px">…or copy the code below and paste it as the <strong>URL</strong> of a new bookmark. If pasting into the address bar strips the <code>javascript:</code> prefix (Chrome does this), use the bookmark manager instead — or just use the drag button above.</p>
    <textarea id="code" readonly spellcheck="false">${url}</textarea>
    <button id="copy">Copy bookmarklet</button><span id="msg"></span>
  </div>

  <div class="card note">
    <strong>Good to know:</strong> this tool runs 100% locally in your browser. It only ever talks to <code>instagram.com</code>,
    performs <strong>read-only</strong> requests, never touches your password, and does not unfollow anyone. No data is sent to
    any third party. Automated activity on Instagram can still violate their Terms of Service — use responsibly, at your own risk.
  </div>
</div>
<script>
  var ta = document.getElementById("code");
  var btn = document.getElementById("copy");
  var msg = document.getElementById("msg");
  btn.addEventListener("click", function () {
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
</script>
</body>
</html>
`;
}

function build() {
  const src = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");
  const min = minify(src);

  // The minifier must never break the program: verify it still parses.
  try {
    new Function(min);
  } catch (e) {
    console.error("✖ Minified output does not parse:", e.message);
    console.error(
      "  (If you added a regex/string containing '//' or '/*', check build.js minify().)",
    );
    process.exit(1);
  }

  const url = "javascript:" + encodeURIComponent(min);
  const bytes = Buffer.byteLength(url, "utf8");

  fs.writeFileSync(path.join(ROOT, "bookmarklet.txt"), url);
  fs.writeFileSync(path.join(ROOT, "index.html"), installerHtml(url));

  console.log(
    "✔ bookmarklet.txt  " +
      bytes +
      " bytes  (" +
      min.length +
      " chars minified)",
  );
  console.log(
    "✔ index.html       " +
      fs.statSync(path.join(ROOT, "index.html")).size +
      " bytes",
  );
  if (bytes > 200000) {
    console.warn("⚠ Bookmarklet is large — very old browsers may truncate it.");
  } else {
    console.log("✔ Within safe size limits for modern browsers.");
  }
}

if (require.main === module) build();

module.exports = { minify };
