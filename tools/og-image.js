#!/usr/bin/env node
/* tools/og-image.js — generate assets/og-image.png (1200×630) with zero deps.
 *
 *   node tools/og-image.js
 *
 * Produces the Open Graph / Twitter Card image for the installer page:
 * a dark diagonal gradient (Instagram pink → X purple) with the white
 * four-point star logo mark. Pure Node — only the built-in zlib is used
 * to encode the PNG, so this stays dependency-free like the rest of the repo.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const W = 1200;
const H = 630;

/* ---------------- PNG encoding ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // bytes 10-12 stay 0 (compression / filter / interlace)

  const stride = W * 4 + 1;
  const raw = Buffer.alloc(stride * H);
  for (let y = 0; y < H; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * W * 4, (y + 1) * W * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------- drawing ---------------- */

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Vertices of the four-point star (✦), alternating outer/inner.
function starPoints(cx, cy, outer, inner) {
  return [
    [cx, cy - outer],
    [cx + inner, cy - inner],
    [cx + outer, cy],
    [cx + inner, cy + inner],
    [cx, cy + outer],
    [cx - inner, cy + inner],
    [cx - outer, cy],
    [cx - inner, cy - inner],
  ];
}

// Even-odd point-in-polygon test.
function inPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/* ---------------- palette ---------------- */

const IG_PINK = [220, 39, 67]; // #dc2743
const X_PURPLE = [120, 86, 255]; // #7856ff
const BG = [10, 10, 15]; // #0a0a0f

const CX = W / 2;
const CY = H / 2;

const MAIN_STAR = starPoints(CX, CY, 150, 55);
const SPARKLES = [
  starPoints(190, 150, 26, 9),
  starPoints(1010, 480, 20, 7),
  starPoints(960, 140, 12, 4),
  starPoints(240, 490, 14, 5),
];

/* ---------------- render (2×2 supersampling for antialiasing) ---------------- */

const rgba = Buffer.alloc(W * H * 4);

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let r = 0;
    let g = 0;
    let b = 0;

    for (let sy = 0; sy < 2; sy++) {
      for (let sx = 0; sx < 2; sx++) {
        const px = x + sx * 0.5;
        const py = y + sy * 0.5;

        // Diagonal platform gradient.
        const t = (px / W + py / H) / 2;
        let cr = lerp(IG_PINK[0], X_PURPLE[0], t);
        let cg = lerp(IG_PINK[1], X_PURPLE[1], t);
        let cb = lerp(IG_PINK[2], X_PURPLE[2], t);

        // Vignette toward the page background at the edges.
        const dx = (px - CX) / (W * 0.62);
        const dy = (py - CY) / (H * 0.62);
        const v = clamp01(dx * dx + dy * dy);
        cr = lerp(cr, BG[0], v * 0.55);
        cg = lerp(cg, BG[1], v * 0.55);
        cb = lerp(cb, BG[2], v * 0.55);

        // Soft radial glow behind the main star.
        const gx = (px - CX) / 300;
        const gy = (py - CY) / 300;
        const glow = Math.exp(-(gx * gx + gy * gy) * 2.2);
        cr = lerp(cr, 255, glow * 0.28);
        cg = lerp(cg, 255, glow * 0.28);
        cb = lerp(cb, 255, glow * 0.28);

        // White star mark (+ smaller sparkles).
        let starA = 0;
        if (inPolygon(px, py, MAIN_STAR)) {
          starA = 1;
        } else {
          for (const s of SPARKLES) {
            if (inPolygon(px, py, s)) {
              starA = 0.85;
              break;
            }
          }
        }
        if (starA > 0) {
          cr = lerp(cr, 255, starA);
          cg = lerp(cg, 255, starA);
          cb = lerp(cb, 255, starA);
        }

        r += cr;
        g += cg;
        b += cb;
      }
    }

    const i = (y * W + x) * 4;
    rgba[i] = Math.round(r / 4);
    rgba[i + 1] = Math.round(g / 4);
    rgba[i + 2] = Math.round(b / 4);
    rgba[i + 3] = 255;
  }
}

const out = path.join(__dirname, "..", "assets", "og-image.png");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePng(rgba));
console.log(`✔ ${path.relative(process.cwd(), out)} (${W}×${H})`);
