/**
 * The kiosk's brand pictures, made when the server starts (kiosk/server.mjs) or by hand (`npm run kiosk:brand`).
 *
 * From two source logos, the sponsor's wordmark and the event's logo, it draws the pictures the game looks for in
 * /kiosk/brand/ (src/lib/kiosk/event-brand.ts BRAND_FILES): the header logos and the three trackside banners. The
 * sources are, in order:
 *   1. kiosk/brand/sponsor-logo.(svg|png) and kiosk/brand/event-logo.(svg|png): the official brand kits' files;
 *   2. a copy downloaded once into kiosk/data/brand-src/ from KIOSK_SPONSOR_LOGO_URL / KIOSK_EVENT_LOGO_URL (defaults:
 *      the HUAWEI wordmark on Wikimedia Commons and the Milan Games Week 2026 logo on milangamesweek.it), kept for
 *      later starts without internet.
 * A finished picture in kiosk/brand/ with an output's name (banner-huawei.png, …) is used as it is instead.
 * Without a source the picture is skipped and the game draws its text in its place. Nothing here can stop the server.
 *
 * Pictures are drawn with sharp (a dependency of the build); the layout follows the game's own text banners.
 * KIOSK_BRAND=0 turns it off. The texts below mirror src/lib/kiosk/event-brand.ts.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");

const RED = "#C7000B";
const WHITE = "#F5F5F5";
const BLACK = "#0B0B0F";
const PAPER = "#F4F4F2";
const ACCENT = "#FF3B30";
const FONT = "'Liberation Sans', Arial, Helvetica, sans-serif";
const EVENT_DATES = process.env.KIOSK_EVENT_DATES || "27–29 NOVEMBRE 2026";
const EVENT_VENUE = process.env.KIOSK_EVENT_VENUE || "FIERA MILANO RHO";
const EVENT_NAME = process.env.KIOSK_EVENT_NAME || "MILAN GAMES WEEK 2026";

const SOURCES = {
  sponsor: {
    local: "sponsor-logo",
    cache: "sponsor-logo.svg",
    url: process.env.KIOSK_SPONSOR_LOGO_URL || "https://upload.wikimedia.org/wikipedia/commons/0/07/Huawei_wordmark.svg",
  },
  event: {
    local: "event-logo",
    cache: "event-logo.svg",
    url:
      process.env.KIOSK_EVENT_LOGO_URL ||
      "https://www.milangamesweek.it/content/dam/mgw/loghi/2026/Logo%20bianco%20scritta%20bianca%20no%20sfondo.svg",
  },
};

const OUTPUTS = ["huawei-logo.png", "banner-huawei.png", "banner-combo.png", "mgw-logo.png", "banner-mgw.png"];
const DOWNLOAD_TIMEOUT_MS = 10_000;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

const exists = (p) => fs.existsSync(p);
const mtime = (p) => (exists(p) ? fs.statSync(p).mtimeMs : 0);

/** An SVG made safe to draw: no scripts, event handlers, external references or DTD */
function cleanSvg(text) {
  return text
    .replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!#|data:)[^"]*"|'(?!#|data:)[^']*')/gi, "");
}

async function download(url, dest, log) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "librecorsa-kiosk/1.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_SOURCE_BYTES) throw new Error(`unexpected size ${buf.length}`);
    const head = buf.subarray(0, 512).toString("utf8");
    if (!/<svg[\s>]/i.test(head) && !buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      // A site behind bot protection answers automatic downloads with a page instead (milangamesweek.it does)
      throw new Error(/<html/i.test(head) ? "the site sent a web page instead (it refuses automatic downloads)" : "not an SVG or PNG");
    }
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, buf);
    return true;
  } catch (err) {
    log.warn(`[brand] could not download ${url}: ${err.message}. Save it from a browser as ${path.relative(ROOT, path.join(here, "brand", path.basename(dest)))}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Where a source logo comes from: the brand kit's file, else the downloaded copy (fetched once) */
async function sourceFor(key, brandDir, cacheDir, log) {
  const s = SOURCES[key];
  for (const ext of ["svg", "png"]) {
    const local = path.join(brandDir, `${s.local}.${ext}`);
    if (exists(local)) return local;
  }
  const cached = path.join(cacheDir, s.cache);
  if (exists(cached)) return cached;
  if (!s.url) return null;
  return (await download(s.url, cached, log)) ? cached : null;
}

/**
 * A logo drawn in one colour at a given size: its shape (alpha) filled with `colour`, cropped to what it draws.
 * Returns the PNG and its size.
 */
async function tintedLogo(sharp, file, maxW, maxH, colour) {
  const raw = await fsp.readFile(file);
  const isSvg = /<svg[\s>]/i.test(raw.subarray(0, 512).toString("utf8"));
  const input = isSvg ? Buffer.from(cleanSvg(raw.toString("utf8"))) : raw;
  // Drawn at about twice the size it is wanted at (an SVG's own size can be anything), cropped to its ink, then scaled
  // down for clean edges
  let density = 72;
  if (isSvg) {
    const meta = await sharp(input).metadata();
    const want = Math.max((2 * maxW) / (meta.width || maxW), (2 * maxH) / (meta.height || maxH));
    density = Math.min(600, Math.max(4, 72 * want));
  }
  const big = await sharp(input, { density, limitInputPixels: 64e6 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = big;
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error(`${path.basename(file)} draws nothing`);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const scale = Math.min(maxW / w, maxH / h);
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  const png = await sharp(data, { raw: info })
    .extract({ left: minX, top: minY, width: w, height: h })
    .resize({ width, height, fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  return { png, width, height };
}

/** Width a line of bold text takes at a size (drawn and measured, so centring matches what is drawn) */
async function textWidth(sharp, text, size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(size * text.length)}" height="${Math.ceil(size * 1.6)}"><text x="0" y="${size}" font-family="${FONT}" font-weight="700" font-size="${size}">${esc(text)}</text></svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let maxX = 0;
  for (let y = 0; y < info.height; y++) for (let x = info.width - 1; x > maxX; x--) if (data[(y * info.width + x) * 4 + 3] > 8) maxX = x;
  return maxX + 1;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const image = (logo, x, y) =>
  `<image x="${Math.round(x)}" y="${Math.round(y)}" width="${logo.width}" height="${logo.height}" xlink:href="data:image/png;base64,${logo.png.toString("base64")}"/>`;
const text = (s, x, y, size, fill) => `<text x="${Math.round(x)}" y="${Math.round(y)}" font-family="${FONT}" font-weight="700" font-size="${size}" fill="${fill}">${esc(s)}</text>`;
const svgDoc = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}">${body}</svg>`;

async function writePng(sharp, svg, dest) {
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(`${dest}.tmp`);
  await fsp.rename(`${dest}.tmp`, dest);
}

/** The pictures, from the sources found (each picture needs only its own sources) */
async function draw(sharp, sponsorFile, eventFile, outDir, brandDir, log) {
  const W = 1024;
  const H = 128;
  const made = [];
  const failed = [];
  const finished = (name) => path.join(brandDir, name);
  const out = (name) => path.join(outDir, name);
  const useFinished = async (name) => {
    if (!exists(finished(name))) return false;
    await fsp.copyFile(finished(name), out(name));
    made.push(`${name} (kiosk/brand)`);
    return true;
  };
  /** One picture: a failure is logged and leaves that picture to the game's text, the others still get made */
  const attempt = async (name, makeIt) => {
    try {
      if (await useFinished(name)) return;
      await makeIt();
      made.push(name);
    } catch (err) {
      failed.push(name);
      log.warn(`[brand] ${name} not made: ${err.message}`);
    }
  };

  if (sponsorFile) {
    await attempt("huawei-logo.png", async () => {
      const logo = await tintedLogo(sharp, sponsorFile, 1200, 120, RED);
      await writePng(sharp, svgDoc(logo.width + 24, logo.height + 24, image(logo, 12, 12)), out("huawei-logo.png"));
    });
    await attempt("banner-huawei.png", async () => {
      const word = await tintedLogo(sharp, sponsorFile, W - 220, 76, RED);
      const body =
        `<rect width="${W}" height="${H}" fill="${PAPER}"/>` +
        `<rect x="0" width="40" height="${H}" fill="${RED}"/><rect x="${W - 40}" width="40" height="${H}" fill="${RED}"/>` +
        `<rect x="40" width="10" height="${H}" fill="${BLACK}"/><rect x="${W - 50}" width="10" height="${H}" fill="${BLACK}"/>` +
        image(word, (W - word.width) / 2, (H - word.height) / 2);
      await writePng(sharp, svgDoc(W, H, body), out("banner-huawei.png"));
    });
    await attempt("banner-combo.png", async () => {
      const word = await tintedLogo(sharp, sponsorFile, 290, 48, WHITE);
      const gap = 28;
      let body = `<rect width="${W}" height="${H}" fill="${RED}"/><rect y="10" width="${W}" height="4" fill="${WHITE}"/><rect y="${H - 14}" width="${W}" height="4" fill="${WHITE}"/>`;
      let logo = null;
      if (eventFile) {
        try {
          logo = await tintedLogo(sharp, eventFile, 300, 96, WHITE);
        } catch (err) {
          log.warn(`[brand] event logo unusable on the combined banner: ${err.message}`);
        }
      }
      if (logo) {
        const timesW = await textWidth(sharp, "×", 44);
        const x0 = (W - (word.width + gap + timesW + gap + logo.width)) / 2;
        body += image(word, x0, (H - word.height) / 2) + text("×", x0 + word.width + gap, H / 2 + 15, 44, WHITE) + image(logo, x0 + word.width + gap + timesW + gap, (H - logo.height) / 2);
      } else {
        const label = `×  ${EVENT_NAME}`;
        const labelW = await textWidth(sharp, label, 40);
        const x0 = (W - (word.width + gap + labelW)) / 2;
        body += image(word, x0, (H - word.height) / 2) + text(label, x0 + word.width + gap, H / 2 + 14, 40, WHITE);
      }
      await writePng(sharp, svgDoc(W, H, body), out("banner-combo.png"));
    });
  }

  if (eventFile) {
    await attempt("mgw-logo.png", async () => {
      const logo = await tintedLogo(sharp, eventFile, 1200, 200, WHITE);
      await writePng(sharp, svgDoc(logo.width + 24, logo.height + 24, image(logo, 12, 12)), out("mgw-logo.png"));
    });
    await attempt("banner-mgw.png", async () => {
      const logo = await tintedLogo(sharp, eventFile, 260, 104, WHITE);
      const [datesW, venueW] = await Promise.all([textWidth(sharp, EVENT_DATES, 38), textWidth(sharp, EVENT_VENUE, 30)]);
      const gap = 40;
      const x0 = (W - (logo.width + gap + Math.max(datesW, venueW))) / 2;
      const tx = x0 + logo.width + gap;
      const body =
        `<rect width="${W}" height="${H}" fill="${BLACK}"/>` +
        `<rect x="0" width="36" height="${H}" fill="${RED}"/><rect x="${W - 36}" width="36" height="${H}" fill="${RED}"/>` +
        `<rect x="36" width="6" height="${H}" fill="${WHITE}"/><rect x="${W - 42}" width="6" height="${H}" fill="${WHITE}"/>` +
        image(logo, x0, (H - logo.height) / 2) +
        text(EVENT_DATES, tx, 58, 38, WHITE) +
        text(EVENT_VENUE, tx, 98, 30, ACCENT);
      await writePng(sharp, svgDoc(W, H, body), out("banner-mgw.png"));
    });
  }
  return { made, failed };
}

/**
 * Makes the brand pictures in `outDir` (the served /kiosk/brand/), unless they are already newer than their sources.
 * Resolves with what it did; never rejects.
 */
export async function ensureBrandAssets({
  outDir = path.join(ROOT, "out", "kiosk", "brand"),
  brandDir = path.join(here, "brand"),
  cacheDir = path.join(process.env.KIOSK_DATA_DIR ? path.resolve(process.env.KIOSK_DATA_DIR) : path.join(here, "data"), "brand-src"),
  log = console,
  force = false,
} = {}) {
  if (process.env.KIOSK_BRAND === "0") return { made: [], skipped: "KIOSK_BRAND=0" };
  try {
    if (!exists(path.dirname(outDir))) return { made: [], skipped: `no ${path.dirname(outDir)} (build first)` };
    const [sponsorFile, eventFile] = await Promise.all([sourceFor("sponsor", brandDir, cacheDir, log), sourceFor("event", brandDir, cacheDir, log)]);
    if (!sponsorFile && !eventFile) return { made: [], skipped: "no source logos (offline, nothing cached)" };
    // Up to date: every picture newer than its sources, this file and any finished artwork
    const newest = Math.max(mtime(sponsorFile ?? ""), mtime(eventFile ?? ""), mtime(fileURLToPath(import.meta.url)), ...OUTPUTS.map((n) => mtime(path.join(brandDir, n))));
    const needs = {
      "huawei-logo.png": sponsorFile,
      "banner-huawei.png": sponsorFile,
      "banner-combo.png": sponsorFile,
      "mgw-logo.png": eventFile,
      "banner-mgw.png": eventFile,
    };
    const wanted = OUTPUTS.filter((n) => needs[n]);
    if (!force && wanted.every((n) => mtime(path.join(outDir, n)) > newest)) return { made: [], skipped: "up to date" };
    let sharp;
    try {
      sharp = (await import("sharp")).default;
    } catch (err) {
      return { made: [], skipped: `sharp unavailable (${err.message.split("\n")[0]}); run npm ci` };
    }
    await fsp.mkdir(outDir, { recursive: true });
    const { made, failed } = await draw(sharp, sponsorFile, eventFile, outDir, brandDir, log);
    return { made, failed, skipped: made.length ? undefined : `nothing made (${failed.join(", ")} failed)`, sources: { sponsor: sponsorFile && path.relative(ROOT, sponsorFile), event: eventFile && path.relative(ROOT, eventFile) } };
  } catch (err) {
    log.warn(`[brand] pictures not made: ${err.message}`);
    return { made: [], skipped: err.message };
  }
}

// `node kiosk/brand.mjs [--public] [--force]`: make them by hand, into out/ (default) or public/ (for `next dev`)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const intoPublic = process.argv.includes("--public");
  const res = await ensureBrandAssets({
    outDir: path.join(ROOT, intoPublic ? "public" : "out", "kiosk", "brand"),
    force: process.argv.includes("--force"),
  });
  console.log(res.made.length ? `[brand] made ${res.made.join(", ")}` : `[brand] nothing made: ${res.skipped}`);
}
