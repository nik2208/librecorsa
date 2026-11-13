/**
 * The kiosk's brand pictures, made when the server starts (kiosk/server.mjs) or by hand (`npm run kiosk:brand`).
 *
 * From the three brands' source logos (HUAWEI's wordmark, the event's logo, WINDTRE's mark) it draws the pictures the
 * game looks for in /kiosk/brand/ (src/lib/kiosk/event-brand.ts BRAND_FILES): each brand's logo for the kiosk's
 * screens and its trackside banner. Each picture comes from, in order:
 *   1. a finished picture with its name in kiosk/brand/ (used as it is, no source needed);
 *   2. drawn from kiosk/brand/sponsor-logo / event-logo / windtre (.svg or .png): the official brand kits' files;
 *   3. drawn from a copy downloaded from KIOSK_SPONSOR_LOGO_URL / KIOSK_EVENT_LOGO_URL / KIOSK_WINDTRE_LOGO_URL
 *      (defaults: the HUAWEI wordmark and the WINDTRE logo on Wikimedia Commons, the Milan Games Week 2026 logo on
 *      milangamesweek.it), kept in kiosk/data/brand-src/ per URL for later starts without internet. A failed download is
 *      tried again after a few hours, not on every start.
 * A picture with none of these is removed, and the game draws its text in its place. Nothing here stops the server.
 *
 * Whether a picture is up to date is decided by a fingerprint kept beside the pictures (.brand-key.json): the hash of
 * its finished picture or of its sources, the event's texts and this file. Dates on files play no part.
 *
 * The logos the staff upload from the admin page are drawn here too (drawUploadedLogo, for kiosk/logos.mjs).
 *
 * Pictures are drawn with sharp (a dependency of the build); the layout follows the game's own text banners.
 * KIOSK_BRAND=0 turns it off. The default texts mirror src/lib/kiosk/event-brand.ts.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");

const RED = "#C7000B";
const WHITE = "#F5F5F5";
const BLACK = "#0B0B0F";
const PAPER = "#F4F4F2";
const ACCENT = "#FF3B30";
/** WINDTRE's orange, from its logo */
const WINDTRE_ORANGE = "#FF6B00";
const FONT = "'Liberation Sans', Arial, Helvetica, sans-serif";
const W = 1024;
const H = 128;

/** Read when the pictures are made, so a change of these shows on the next start */
const texts = () => ({
  dates: process.env.KIOSK_EVENT_DATES || "27–29 NOVEMBRE 2026",
  venue: process.env.KIOSK_EVENT_VENUE || "FIERA MILANO RHO",
  name: process.env.KIOSK_EVENT_NAME || "MILAN GAMES WEEK 2026",
});

const SOURCES = {
  sponsor: {
    local: "sponsor-logo",
    env: "KIOSK_SPONSOR_LOGO_URL",
    url: "https://upload.wikimedia.org/wikipedia/commons/0/07/Huawei_wordmark.svg",
  },
  event: {
    local: "event-logo",
    env: "KIOSK_EVENT_LOGO_URL",
    url: "https://www.milangamesweek.it/content/dam/mgw/loghi/2026/Logo%20bianco%20scritta%20bianca%20no%20sfondo.svg",
  },
  // The 2020 logo (a text logo, public domain on Commons; the trademark is Wind Tre S.p.A.'s)
  windtre: {
    local: "windtre",
    env: "KIOSK_WINDTRE_LOGO_URL",
    url: "https://upload.wikimedia.org/wikipedia/commons/5/5e/Wind_Tre_logo_2020.svg",
  },
};
const sourceUrl = (key) => {
  const v = process.env[SOURCES[key].env];
  return v === undefined ? SOURCES[key].url : v.trim();
};

/** Each picture's source logo */
const OUTPUTS = {
  "huawei-logo.png": { source: "sponsor" },
  "banner-huawei.png": { source: "sponsor" },
  "mgw-logo.png": { source: "event" },
  "banner-mgw.png": { source: "event" },
  "windtre-logo.png": { source: "windtre" },
  "banner-windtre.png": { source: "windtre" },
};
/** Pictures earlier versions made that nothing shows any more (each brand has its own banner now) */
const RETIRED = ["banner-combo.png"];
const KEY_FILE = ".brand-key.json";

const DOWNLOAD_TIMEOUT_MS = () => Number(process.env.KIOSK_BRAND_TIMEOUT_MS) || 10_000;
const RETRY_AFTER_FAIL_MS = 6 * 60 * 60 * 1000;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const exists = (p) => fs.existsSync(p);
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
/** This file's own hash: a change to the drawing redraws everything once (uploaded logos too) */
export const BRAND_CODE_HASH = sha(fs.readFileSync(fileURLToPath(import.meta.url)));
const CODE_HASH = BRAND_CODE_HASH;

const isPng = (buf) => buf.length > 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
/** An SVG, wherever its root starts (after an XML declaration, comments, a DOCTYPE with entity declarations …) */
const isSvg = (buf) => !isPng(buf) && /<svg[\s>]/i.test(buf.subarray(0, 64 * 1024).toString("utf8"));

/** What kind of picture a file is, from its first bytes (never from its name or the type a browser claims) */
export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (isPng(buf)) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.subarray(0, 6).toString("latin1") === "GIF87a" || buf.subarray(0, 6).toString("latin1") === "GIF89a") return "gif";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (isSvg(buf)) return "svg";
  return null;
}

/**
 * Only what never draws anything is taken out (scripts, event handlers). DOCTYPEs, entities and links stay: brand-kit
 * files from illustration programs rely on them, and librsvg loads nothing external from a buffer.
 *
 * Scripts are found by searching forward only (a lazy regex scanned the rest of the file again for every unclosed
 * `<script`: an upload of them held the server for hours). Comments are passed over whole (one may mention `<script`);
 * a self-closing `<script …/>` goes alone; a script that never closes is left as it is, with the rest of the file (none
 * of it runs: librsvg runs no script, and an uploaded file is never served).
 */
export function cleanSvg(text) {
  const next = /<!--|<script\b/gi;
  const close = /<\/script\s*>/gi;
  let out = "";
  let at = 0;
  for (;;) {
    next.lastIndex = at;
    const found = next.exec(text);
    if (!found) {
      out += text.slice(at);
      break;
    }
    if (found[0] === "<!--") {
      const end = text.indexOf("-->", found.index + 4);
      if (end < 0) {
        out += text.slice(at);
        break;
      }
      out += text.slice(at, end + 3);
      at = end + 3;
      continue;
    }
    out += text.slice(at, found.index);
    const gt = text.indexOf(">", found.index);
    if (gt < 0) {
      out += text.slice(found.index);
      break;
    }
    if (text[gt - 1] === "/") {
      at = gt + 1;
      continue;
    }
    close.lastIndex = gt;
    const end = close.exec(text);
    if (!end) {
      out += text.slice(found.index);
      break;
    }
    at = end.index + end[0].length;
  }
  return out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "");
}

/** The most pixels a picture may have when it is drawn, and all the pictures inside an SVG together */
export const MAX_PICTURE_PIXELS = 64e6;

/** The most data: addresses an SVG (with the SVGs inside it) may carry: each one costs a look, a file of thousands
 * would hold the server for minutes */
export const MAX_EMBEDDED_PICTURES = 256;

/** XML character references (`&#105;`, `&#x69;`) as the characters they stand for, as librsvg reads them */
const decodeCharRefs = (s) =>
  s.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {
    const code = n[0] === "x" || n[0] === "X" ? parseInt(n.slice(1), 16) : parseInt(n, 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });

/**
 * Whether an entity declaration carries a data: address (its picture could then be drawn as many times as the entity
 * is used). Each declaration is read once, forward, to its closing `>` outside quotes (a regex rescanned the rest of
 * the file for every unclosed `<!ENTITY`)
 */
function entityWithData(text) {
  const open = /<!ENTITY/gi;
  let from = 0;
  for (;;) {
    open.lastIndex = from;
    const m = open.exec(text);
    if (!m) return false;
    let i = m.index + m[0].length;
    let quote = "";
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    if (/data:/i.test(text.slice(m.index, i))) return true;
    if (i >= text.length) return false;
    from = i + 1;
  }
}

/**
 * The pixels of the pictures an SVG carries inside it (data: addresses, base64 or not), those of SVGs inside it
 * included: librsvg decodes each at its full size whatever size the SVG itself is drawn at. Infinity when they can't
 * be counted: more addresses than MAX_EMBEDDED_PICTURES, or pictures behind entities (one could be drawn many times)
 */
export async function embeddedPixels(sharp, text, depth = 0, budget = { looks: 0 }) {
  if (entityWithData(text)) return Infinity;
  let total = 0;
  for (const m of text.matchAll(/data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?(?:;[a-z0-9=._-]+)*?(;base64)?,([^"')<>]*)/gi)) {
    if (++budget.looks > MAX_EMBEDDED_PICTURES) return Infinity;
    let buf;
    try {
      // Line breaks and character references may wrap a long base64 payload
      const body = decodeCharRefs(m[3]);
      buf = m[2] ? Buffer.from(body.replace(/\s+/g, ""), "base64") : Buffer.from(decodeURIComponent(body), "utf8");
    } catch {
      continue;
    }
    // Too short to be any picture
    if (buf.length < 12) continue;
    if (isSvg(buf)) {
      if (depth >= 3) return Infinity;
      total += await embeddedPixels(sharp, buf.toString("utf8"), depth + 1, budget);
      if (total === Infinity) return Infinity;
      continue;
    }
    try {
      const meta = await sharp(buf, { limitInputPixels: false }).metadata();
      total += (meta.width || 0) * (meta.height || 0) * (meta.pages || 1);
    } catch {
      // Not a picture librsvg can draw either (a font, say)
    }
  }
  return total;
}

/**
 * One file over HTTP(S), with its own timer for the whole transfer (fetch's abort signal could be lost to the garbage
 * collector on Node 18), a size cap enforced while it streams, and up to 3 redirects
 */
function download(url, timeoutMs, redirects = 3) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err, buf) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(buf);
    };
    let req;
    const timer = setTimeout(() => {
      req?.destroy();
      done(new Error(`no answer within ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    try {
      const lib = url.startsWith("https:") ? https : url.startsWith("http:") ? http : null;
      if (!lib) throw new Error("not an http(s) address");
      req = lib.get(url, { headers: { "User-Agent": "librecorsa-kiosk/1.0", Accept: "image/svg+xml,image/png,*/*" } }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects <= 0) return done(new Error("too many redirects"));
          download(new URL(res.headers.location, url).href, timeoutMs, redirects - 1).then((b) => done(null, b), done);
          return;
        }
        if (status !== 200) {
          res.resume();
          return done(new Error(`HTTP ${status}`));
        }
        if (Number(res.headers["content-length"]) > MAX_SOURCE_BYTES) {
          req.destroy();
          return done(new Error("too large"));
        }
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_SOURCE_BYTES) {
            req.destroy();
            done(new Error("too large"));
          } else chunks.push(chunk);
        });
        res.on("end", () => done(null, Buffer.concat(chunks)));
        res.on("error", done);
      });
      req.on("error", done);
    } catch (err) {
      done(err);
    }
  });
}

/** A source logo that sharp can draw: an SVG or PNG with a size (else why not) */
async function validSource(sharp, buf) {
  if (!isSvg(buf) && !isPng(buf)) {
    return /<html/i.test(buf.subarray(0, 4096).toString("utf8"))
      ? "the site sent a web page instead (it refuses automatic downloads)"
      : "not an SVG or PNG";
  }
  try {
    // An SVG's own size says nothing of the drawing (it is drawn at the size wanted): only its header is read
    const input = isSvg(buf) ? Buffer.from(cleanSvg(buf.toString("utf8"))) : buf;
    const meta = await sharp(input, { density: 72, limitInputPixels: false }).metadata();
    return meta.width && meta.height ? null : "no size";
  } catch (err) {
    return `cannot be drawn (${err.message.split("\n")[0]})`;
  }
}

/**
 * Where a source logo comes from: the brand kit's file, else the copy downloaded from its current address (fetched
 * once, again only after a failed try has aged). Resolves with { file, key } or null; never rejects.
 */
async function resolveSource(key, { sharp, brandDir, cacheDir, log, force }) {
  const s = SOURCES[key];
  for (const ext of ["svg", "png"]) {
    const local = path.join(brandDir, `${s.local}.${ext}`);
    if (exists(local)) return { file: local, key: `local:${sha(await fsp.readFile(local))}` };
  }
  const url = sourceUrl(key);
  if (!url) return null;
  const tag = `${s.local}-${sha(url).slice(0, 12)}`;
  const failMark = path.join(cacheDir, `${tag}.failed.json`);
  for (const ext of ["svg", "png"]) {
    const cached = path.join(cacheDir, `${tag}.${ext}`);
    if (!exists(cached)) continue;
    const buf = await fsp.readFile(cached);
    const problem = await validSource(sharp, buf);
    if (!problem) return { file: cached, key: `cache:${sha(buf)}` };
    log.warn(`[brand] cached ${path.basename(cached)} unusable (${problem}): downloading it again`);
    await fsp.rm(cached, { force: true });
  }
  if (!force && exists(failMark)) {
    try {
      const { at } = JSON.parse(await fsp.readFile(failMark, "utf8"));
      if (Date.now() - at < RETRY_AFTER_FAIL_MS) return null;
    } catch {
      // A broken mark: try again
    }
  }
  const hint = `save it from a browser as ${path.relative(ROOT, path.join(brandDir, `${s.local}.svg`))}`;
  try {
    const buf = await download(url, DOWNLOAD_TIMEOUT_MS());
    const problem = await validSource(sharp, buf);
    if (problem) throw new Error(problem);
    await fsp.mkdir(cacheDir, { recursive: true });
    const dest = path.join(cacheDir, `${tag}.${isPng(buf) ? "png" : "svg"}`);
    await fsp.writeFile(`${dest}.tmp`, buf);
    await fsp.rename(`${dest}.tmp`, dest);
    await fsp.rm(failMark, { force: true });
    return { file: dest, key: `cache:${sha(buf)}` };
  } catch (err) {
    log.warn(`[brand] ${key} logo not downloaded from ${url}: ${err.message}; ${hint}`);
    try {
      await fsp.mkdir(cacheDir, { recursive: true });
      await fsp.writeFile(failMark, JSON.stringify({ url, at: Date.now(), error: err.message }));
    } catch {
      // Nowhere to note it: the next start simply tries again
    }
    return null;
  }
}

// ---- Drawing a logo

/**
 * A logo as raw RGBA pixels: an SVG drawn at about twice the size it is wanted at (its own size can be anything), a
 * photo or bitmap turned upright and brought down to a size worth working on
 */
async function rasterise(sharp, raw, wantW, wantH) {
  let img;
  if (isSvg(raw)) {
    const input = Buffer.from(cleanSvg(raw.toString("utf8")));
    // Its own size is only its header (an artboard of any size): the limit is on the drawing, at the size wanted. Twice
    // that size, but no side over 8000 px (a long thin strip would otherwise pass libvips' 32767-px cap)
    const meta = await sharp(input, { density: 72, limitInputPixels: false }).metadata();
    const w = meta.width || wantW;
    const h = meta.height || wantH;
    const scale = Math.min(Math.max((2 * wantW) / w, (2 * wantH) / h), 8000 / w, 8000 / h);
    img = sharp(input, { density: Math.min(600, Math.max(1, 72 * scale)), limitInputPixels: MAX_PICTURE_PIXELS });
  } else {
    img = sharp(raw, { limitInputPixels: MAX_PICTURE_PIXELS }).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true });
  }
  return img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

/** How far apart two colours are (the largest difference of their channels, 0-255) */
const colourGap = (data, i, rgb) => Math.max(Math.abs(data[i] - rgb[0]), Math.abs(data[i + 1] - rgb[1]), Math.abs(data[i + 2] - rgb[2]));

/**
 * The rectangle a logo draws in: its visible pixels, or (`background` given, a picture with no transparency) the visible
 * pixels that differ from its background. Null when it draws nothing.
 */
function inkBox(data, info, background = null) {
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      const ink = background ? data[i + 3] >= 128 && colourGap(data, i, background) > 40 : data[i + 3] > 8;
      if (!ink) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexOf = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
/** Relative brightness 0-1 of an sRGB colour (close enough for picking a ground) */
const lumaOf = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * `tint` paints every pixel one colour (a one-colour logo in the brand's colour); `greys` paints only its greys (a
 * two-colour logo's grey or black text turned white for a dark ground). Neither: its own colours.
 */
function recolour(data, { tint = null, greys = null } = {}) {
  if (tint) {
    const [r, g, b] = rgbOf(tint);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  } else if (greys) {
    const [r, g, b] = rgbOf(greys);
    for (let i = 0; i < data.length; i += 4) {
      const hi = Math.max(data[i], data[i + 1], data[i + 2]);
      const lo = Math.min(data[i], data[i + 1], data[i + 2]);
      if (hi === 0 || (hi - lo) / hi < 0.2) {
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
      }
    }
  }
}

/** The pixels inside `box`, scaled to fit maxW × maxH, as a PNG with its size */
async function fitPng(sharp, data, info, box, maxW, maxH) {
  const scale = Math.min(maxW / box.width, maxH / box.height);
  const width = Math.max(1, Math.round(box.width * scale));
  const height = Math.max(1, Math.round(box.height * scale));
  const png = await sharp(data, { raw: info }).extract(box).resize({ width, height, fit: "fill", kernel: "lanczos3" }).png().toBuffer();
  return { png, width, height };
}

/** A logo cropped to what it draws and scaled to fit maxW × maxH (recoloured as `recolour` says), as a PNG with its size */
async function drawLogo(sharp, file, maxW, maxH, colours = {}) {
  const { data, info } = await rasterise(sharp, await fsp.readFile(file), maxW, maxH);
  const box = inkBox(data, info);
  if (!box) throw new Error(`${path.basename(file)} draws nothing`);
  recolour(data, colours);
  return fitPng(sharp, data, info, box, maxW, maxH);
}

/** Width a line of bold text takes at a size (drawn and measured, so centring matches what is drawn) */
async function textWidth(sharp, line, size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(size * line.length)}" height="${Math.ceil(size * 1.6)}"><text x="0" y="${size}" font-family="${FONT}" font-weight="700" font-size="${size}">${esc(line)}</text></svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let maxX = 0;
  for (let y = 0; y < info.height; y++) for (let x = info.width - 1; x > maxX; x--) if (data[(y * info.width + x) * 4 + 3] > 8) maxX = x;
  return maxX + 1;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const image = (logo, x, y) =>
  `<image x="${Math.round(x)}" y="${Math.round(y)}" width="${logo.width}" height="${logo.height}" xlink:href="data:image/png;base64,${logo.png.toString("base64")}"/>`;
const text = (s, x, y, size, fill) =>
  `<text x="${Math.round(x)}" y="${Math.round(y)}" font-family="${FONT}" font-weight="700" font-size="${size}" fill="${fill}">${esc(s)}</text>`;
const svgDoc = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}">${body}</svg>`;

/**
 * A logo across a banner's inner width: a wide one once, in the middle; a squarish one (a mark, a badge: tiny on an 8:1
 * board) repeated, as trackside boards do, up to `most` times
 */
function logoRow(logo, x0, innerW, y, most = 4, minGap = 48) {
  const count = logo.width * 3 > innerW ? 1 : Math.max(1, Math.min(most, Math.floor((innerW + minGap) / (logo.width + minGap))));
  const gap = (innerW - count * logo.width) / (count + 1);
  return Array.from({ length: count }, (_, i) => image(logo, x0 + gap + i * (logo.width + gap), y)).join("");
}

/** Each picture's drawing, from its source logo */
const DRAW = {
  "huawei-logo.png": async (sharp, main) => {
    const logo = await drawLogo(sharp, main, 1200, 120, { tint: RED });
    return svgDoc(logo.width + 24, logo.height + 24, image(logo, 12, 12));
  },
  "banner-huawei.png": async (sharp, main) => {
    const word = await drawLogo(sharp, main, W - 220, 76, { tint: RED });
    return svgDoc(
      W,
      H,
      `<rect width="${W}" height="${H}" fill="${PAPER}"/>` +
        `<rect x="0" width="40" height="${H}" fill="${RED}"/><rect x="${W - 40}" width="40" height="${H}" fill="${RED}"/>` +
        `<rect x="40" width="10" height="${H}" fill="${BLACK}"/><rect x="${W - 50}" width="10" height="${H}" fill="${BLACK}"/>` +
        image(word, (W - word.width) / 2, (H - word.height) / 2)
    );
  },
  "mgw-logo.png": async (sharp, main) => {
    const logo = await drawLogo(sharp, main, 1200, 200, { tint: WHITE });
    return svgDoc(logo.width + 24, logo.height + 24, image(logo, 12, 12));
  },
  "banner-mgw.png": async (sharp, main) => {
    const { dates, venue } = texts();
    const logo = await drawLogo(sharp, main, 260, 104, { tint: WHITE });
    const [datesW, venueW] = await Promise.all([textWidth(sharp, dates, 38), textWidth(sharp, venue, 30)]);
    const gap = 40;
    const x0 = (W - (logo.width + gap + Math.max(datesW, venueW))) / 2;
    const tx = x0 + logo.width + gap;
    return svgDoc(
      W,
      H,
      `<rect width="${W}" height="${H}" fill="${BLACK}"/>` +
        `<rect x="0" width="36" height="${H}" fill="${RED}"/><rect x="${W - 36}" width="36" height="${H}" fill="${RED}"/>` +
        `<rect x="36" width="6" height="${H}" fill="${WHITE}"/><rect x="${W - 42}" width="6" height="${H}" fill="${WHITE}"/>` +
        image(logo, x0, (H - logo.height) / 2) +
        text(dates, tx, 58, 38, WHITE) +
        text(venue, tx, 98, 30, ACCENT)
    );
  },
  // WINDTRE: its own colours, the grey text turned white on the kiosk's dark screens
  "windtre-logo.png": async (sharp, main) => {
    const logo = await drawLogo(sharp, main, 1200, 200, { greys: "#FFFFFF" });
    return svgDoc(logo.width + 24, logo.height + 24, image(logo, 12, 12));
  },
  // On white, as the brand shows it, between orange bands; the stacked logo is repeated along the board
  "banner-windtre.png": async (sharp, main) => {
    const logo = await drawLogo(sharp, main, 400, 104);
    return svgDoc(
      W,
      H,
      `<rect width="${W}" height="${H}" fill="#FFFFFF"/>` +
        `<rect x="0" width="36" height="${H}" fill="${WINDTRE_ORANGE}"/><rect x="${W - 36}" width="36" height="${H}" fill="${WINDTRE_ORANGE}"/>` +
        logoRow(logo, 56, W - 112, (H - logo.height) / 2)
    );
  },
};

// ---- The staff's own logos (uploaded from the admin page: kiosk/logos.mjs)

/**
 * The ground of a picture with no transparency: the colour most of its edge has (its opaque pixels in a 2-pixel ring).
 * Null when no colour has most of it (ink running off the edges): such a picture has no ground to take apart from it
 */
function edgeGround(data, info) {
  const ring = [];
  const add = (x, y) => {
    const i = (y * info.width + x) * 4;
    if (data[i + 3] >= 250) ring.push(i);
  };
  const ys = [...new Set([0, 1, info.height - 2, info.height - 1].filter((y) => y >= 0 && y < info.height))];
  const xs = [...new Set([0, 1, info.width - 2, info.width - 1].filter((x) => x >= 0 && x < info.width))];
  for (let x = 0; x < info.width; x++) for (const y of ys) add(x, y);
  for (let y = 2; y < info.height - 2; y++) for (const x of xs) add(x, y);
  if (ring.length === 0) return null;
  // The commonest colour (to 16 levels a channel), then the mean of every edge pixel close to it
  const counts = new Map();
  let best = 0;
  let bestKey = 0;
  for (const i of ring) {
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    if (n > best) {
      best = n;
      bestKey = key;
    }
  }
  const centre = [((bestKey >> 8) & 15) * 16 + 8, ((bestKey >> 4) & 15) * 16 + 8, (bestKey & 15) * 16 + 8];
  const sum = [0, 0, 0];
  let near = 0;
  for (const i of ring) {
    if (colourGap(data, i, centre) > 40) continue;
    sum[0] += data[i];
    sum[1] += data[i + 1];
    sum[2] += data[i + 2];
    near++;
  }
  return near / ring.length >= 0.5 ? sum.map((v) => v / near) : null;
}

/**
 * Whether a logo with a transparent background is light (white, yellow… : it needs a dark ground) or dark. Its whitest
 * and darkest parts decide first, as they vanish on a ground like them (a white name beside a coloured mark); else the
 * brightness of everything it draws, weighed by how much of each
 */
function logoTone(data) {
  let weight = 0;
  let luma = 0;
  let white = 0;
  let black = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a <= 0.03) continue;
    const l = lumaOf([data[i], data[i + 1], data[i + 2]]);
    weight += a;
    luma += a * l;
    if (l > 0.85) white += a;
    else if (l < 0.15) black += a;
  }
  if (weight === 0) return null;
  if (white / weight >= 0.15 || black / weight >= 0.15) return white >= black ? "light" : "dark";
  return luma / weight > 0.62 ? "light" : "dark";
}

/** The board's look around an uploaded logo, by the ground its colours need */
const UPLOAD_GROUNDS = {
  light: { fill: "#F7F7F5", band: "#1C1C22" },
  dark: { fill: BLACK, band: "#34343C" },
};

/**
 * An uploaded logo made ready for the kiosk, from its file (SVG, PNG, JPEG, WebP or GIF):
 *  - `logo`: the logo cropped to what it draws (≤ 1200 × 240) for the kiosk's screens;
 *  - `banner`: its 1024 × 128 trackside board.
 * A logo with a transparent background is drawn on white when its colours are dark, on black when they are light
 * (`ground` "light" or "dark" chooses instead). A picture with no transparency (a JPEG, a badge) is shown as it is
 * (`boxed`): cropped to its logo when its edges share one colour, its ground, which then fills the board around it;
 * else whole.
 */
export async function drawUploadedLogo(sharp, raw, { ground = "auto" } = {}) {
  const { data, info } = await rasterise(sharp, raw, 1200, 240);
  const pixels = info.width * info.height;
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) clear++;
  const boxed = clear / pixels < 0.005;
  const background = boxed ? edgeGround(data, info) : null;
  let tone;
  if (background) tone = lumaOf(background) > 0.5 ? "dark" : "light";
  else {
    tone = logoTone(data);
    if (tone === null) throw Object.assign(new Error("L'immagine è vuota (tutta trasparente)"), { status: 422 });
  }
  // A boxed picture with no ground of its own is kept whole (all of it is the logo)
  const box = boxed && !background ? { left: 0, top: 0, width: info.width, height: info.height } : inkBox(data, info, background);
  if (!box) throw Object.assign(new Error("L'immagine non contiene un logo (è di un solo colore)"), { status: 422 });

  // The logo for the screens; one cropped out of its ground keeps a margin of that ground
  let logo = await fitPng(sharp, data, info, box, 1200, 240);
  if (background) {
    const pad = Math.max(4, Math.round(logo.height * 0.12));
    const [r, g, b] = background;
    const png = await sharp(logo.png).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r, g, b, alpha: 1 } }).png().toBuffer();
    logo = { png, width: logo.width + 2 * pad, height: logo.height + 2 * pad };
  }

  // The board: its ground, dark bands at the ends, the logo (repeated when squarish) in between
  const chosen = ground === "light" || ground === "dark" ? ground : null;
  const look = chosen
    ? UPLOAD_GROUNDS[chosen]
    : background
      ? { fill: hexOf(background), band: lumaOf(background) > 0.5 ? UPLOAD_GROUNDS.light.band : UPLOAD_GROUNDS.dark.band }
      : UPLOAD_GROUNDS[tone === "light" ? "dark" : "light"];
  const onBoard = await fitPng(sharp, data, info, box, 900, 100);
  const banner = await sharp(
    Buffer.from(
      svgDoc(
        W,
        H,
        `<rect width="${W}" height="${H}" fill="${look.fill}"/>` +
          `<rect x="0" width="28" height="${H}" fill="${look.band}"/><rect x="${W - 28}" width="28" height="${H}" fill="${look.band}"/>` +
          logoRow(onBoard, 52, W - 104, (H - onBoard.height) / 2)
      )
    )
  )
    .png({ compressionLevel: 9 })
    .toBuffer();

  // The ground it shows on in the kiosk's screens: on a white card when its colours are dark (never a boxed picture)
  const shownOn = boxed ? "light" : chosen ?? (tone === "light" ? "dark" : "light");
  return { logo: logo.png, banner, boxed, tone, ground: shownOn, background: background ? hexOf(background) : null };
}

// ---- The brand pictures in the served build

async function readKeys(outDir) {
  try {
    const keys = JSON.parse(await fsp.readFile(path.join(outDir, KEY_FILE), "utf8"));
    return keys && typeof keys === "object" ? keys : {};
  } catch {
    return {};
  }
}

async function writeAtomically(dest, data) {
  await fsp.writeFile(`${dest}.tmp-${process.pid}`, data);
  await fsp.rename(`${dest}.tmp-${process.pid}`, dest);
}

/** sharp, when it is installed (a dependency of the build); null with the reason otherwise */
export async function loadSharp() {
  try {
    return { sharp: (await import("sharp")).default, problem: null };
  } catch (err) {
    return { sharp: null, problem: `sharp unavailable (${err.message.split("\n")[0]}); run npm ci` };
  }
}

/**
 * Makes the brand pictures in `outDir` (the served /kiosk/brand/): each one whose fingerprint changed is copied or
 * drawn again, each one with neither a finished picture nor a source is removed. Resolves with what it did; never
 * rejects.
 */
export async function ensureBrandAssets({
  outDir = path.join(ROOT, "out", "kiosk", "brand"),
  brandDir = path.join(here, "brand"),
  cacheDir = path.join(process.env.KIOSK_DATA_DIR ? path.resolve(process.env.KIOSK_DATA_DIR) : path.join(here, "data"), "brand-src"),
  log = console,
  force = false,
} = {}) {
  const result = { made: [], removed: [], failed: [], upToDate: [], skipped: undefined };
  if (process.env.KIOSK_BRAND === "0") return { ...result, skipped: "KIOSK_BRAND=0" };
  try {
    if (!exists(path.dirname(outDir))) return { ...result, skipped: `no ${path.dirname(outDir)} (build first)` };
    await fsp.mkdir(outDir, { recursive: true });
    const stored = await readKeys(outDir);
    const keys = {};
    const t = texts();
    const textKey = sha(`${t.dates}|${t.venue}|${t.name}`);

    // Pictures of earlier versions go (nothing asks for them)
    for (const name of RETIRED) {
      if (exists(path.join(outDir, name))) {
        await fsp.rm(path.join(outDir, name), { force: true });
        result.removed.push(name);
      }
    }

    // Finished pictures need nothing else; the others need their sources, and sharp to draw them
    const finished = {};
    for (const name of Object.keys(OUTPUTS)) {
      const file = path.join(brandDir, name);
      if (exists(file)) finished[name] = { file, key: `finished:${sha(await fsp.readFile(file))}` };
    }
    const toDraw = Object.keys(OUTPUTS).filter((n) => !finished[n]);
    let sharp = null;
    let sharpProblem = null;
    if (toDraw.length > 0) ({ sharp, problem: sharpProblem } = await loadSharp());
    // Each source on its own: one slow download doesn't hold the other logos' pictures
    const wanted = new Set(toDraw.map((n) => OUTPUTS[n].source));
    const sources = {};
    if (sharp) {
      await Promise.all(
        [...wanted].map(async (key) => {
          sources[key] = await resolveSource(key, { sharp, brandDir, cacheDir, log, force });
        })
      );
    }

    for (const name of Object.keys(OUTPUTS)) {
      const dest = path.join(outDir, name);
      try {
        if (finished[name]) {
          keys[name] = finished[name].key;
          if (!force && stored[name] === keys[name] && exists(dest)) {
            result.upToDate.push(name);
            continue;
          }
          await fsp.copyFile(finished[name].file, `${dest}.tmp-${process.pid}`);
          await fsp.rename(`${dest}.tmp-${process.pid}`, dest);
          result.made.push(`${name} (kiosk/brand)`);
          continue;
        }
        const main = sources[OUTPUTS[name].source];
        if (!main) {
          // Nothing to make it from (or no sharp): a picture this script made earlier goes, the game's text shows
          if (stored[name] && exists(dest)) {
            await fsp.rm(dest, { force: true });
            result.removed.push(name);
          }
          continue;
        }
        keys[name] = `drawn:${CODE_HASH}:${main.key}:${textKey}`;
        if (!force && stored[name] === keys[name] && exists(dest)) {
          result.upToDate.push(name);
          continue;
        }
        const svg = await DRAW[name](sharp, main.file, log);
        await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(`${dest}.tmp-${process.pid}`);
        await fsp.rename(`${dest}.tmp-${process.pid}`, dest);
        result.made.push(name);
      } catch (err) {
        delete keys[name];
        result.failed.push(name);
        log.warn(`[brand] ${name} not made: ${err.message}`);
      }
    }
    await writeAtomically(path.join(outDir, KEY_FILE), JSON.stringify(keys, null, 1));
    if (!result.made.length && !result.upToDate.length && !result.removed.length) {
      result.skipped = sharpProblem ?? (result.failed.length ? `failed: ${result.failed.join(", ")}` : "no source logos (offline, nothing cached)");
    }
    return result;
  } catch (err) {
    log.warn(`[brand] pictures not made: ${err.message}`);
    return { ...result, skipped: err.message };
  }
}

/** One line for the server's log */
export function describeBrandResult(res) {
  const parts = [];
  if (res.made.length) parts.push(`made ${res.made.join(", ")}`);
  if (res.upToDate.length) parts.push(`${res.upToDate.length} up to date`);
  if (res.removed.length) parts.push(`removed ${res.removed.join(", ")}`);
  if (res.failed.length) parts.push(`failed ${res.failed.join(", ")}`);
  if (res.skipped && !parts.length) parts.push(res.skipped);
  return parts.join(" · ") || "nothing to do";
}

// `node kiosk/brand.mjs [--public] [--force]`: make them by hand, into out/ (default) or public/ (for `next dev`)
const invokedPath = (() => {
  try {
    return process.argv[1] ? fs.realpathSync(process.argv[1]) : "";
  } catch {
    return "";
  }
})();
if (invokedPath === fileURLToPath(import.meta.url)) {
  const intoPublic = process.argv.includes("--public");
  const res = await ensureBrandAssets({
    outDir: path.join(ROOT, intoPublic ? "public" : "out", "kiosk", "brand"),
    force: process.argv.includes("--force"),
  });
  console.log(`[brand] ${describeBrandResult(res)}`);
}
