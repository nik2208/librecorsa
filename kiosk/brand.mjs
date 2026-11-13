/**
 * The kiosk's brand pictures, made when the server starts (kiosk/server.mjs) or by hand (`npm run kiosk:brand`).
 *
 * From two source logos, the sponsor's wordmark and the event's logo, it draws the pictures the game looks for in
 * /kiosk/brand/ (src/lib/kiosk/event-brand.ts BRAND_FILES): the header logos and the three trackside banners. Each
 * picture comes from, in order:
 *   1. a finished picture with its name in kiosk/brand/ (used as it is, no source needed);
 *   2. drawn from kiosk/brand/sponsor-logo.(svg|png) / event-logo.(svg|png): the official brand kits' files;
 *   3. drawn from a copy downloaded from KIOSK_SPONSOR_LOGO_URL / KIOSK_EVENT_LOGO_URL (defaults: the HUAWEI wordmark on
 *      Wikimedia Commons and the Milan Games Week 2026 logo on milangamesweek.it), kept in kiosk/data/brand-src/ per
 *      URL for later starts without internet. A failed download is tried again after a few hours, not on every start.
 * A picture with none of these is removed, and the game draws its text in its place. Nothing here stops the server.
 *
 * Whether a picture is up to date is decided by a fingerprint kept beside the pictures (.brand-key.json): the hash of
 * its finished picture or of its sources, the event's texts and this file. Dates on files play no part.
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
};
const sourceUrl = (key) => {
  const v = process.env[SOURCES[key].env];
  return v === undefined ? SOURCES[key].url : v.trim();
};

/** What each picture is drawn from: its main source logo and, for the combined banner, the event's when there is one */
const OUTPUTS = {
  "huawei-logo.png": { source: "sponsor" },
  "banner-huawei.png": { source: "sponsor" },
  "banner-combo.png": { source: "sponsor", extra: "event" },
  "mgw-logo.png": { source: "event" },
  "banner-mgw.png": { source: "event" },
};
const KEY_FILE = ".brand-key.json";

const DOWNLOAD_TIMEOUT_MS = () => Number(process.env.KIOSK_BRAND_TIMEOUT_MS) || 10_000;
const RETRY_AFTER_FAIL_MS = 6 * 60 * 60 * 1000;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const exists = (p) => fs.existsSync(p);
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
/** This file's own hash: a change to the drawing redraws everything once */
const CODE_HASH = sha(fs.readFileSync(fileURLToPath(import.meta.url)));

const isPng = (buf) => buf.length > 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
/** An SVG, wherever its root starts (after an XML declaration, comments, a DOCTYPE with entity declarations …) */
const isSvg = (buf) => !isPng(buf) && /<svg[\s>]/i.test(buf.subarray(0, 64 * 1024).toString("utf8"));

/**
 * Only what never draws anything is taken out (scripts, event handlers). DOCTYPEs, entities and links stay: brand-kit
 * files from illustration programs rely on them, and librsvg loads nothing external from a buffer
 */
const cleanSvg = (text) => text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "");

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
    const input = isSvg(buf) ? Buffer.from(cleanSvg(buf.toString("utf8"))) : buf;
    const meta = await sharp(input, { density: 72 }).metadata();
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

/**
 * A logo drawn in one colour at a given size: its shape (alpha) filled with `colour`, cropped to what it draws.
 * Returns the PNG and its size.
 */
async function tintedLogo(sharp, file, maxW, maxH, colour) {
  const raw = await fsp.readFile(file);
  const svg = isSvg(raw);
  const input = svg ? Buffer.from(cleanSvg(raw.toString("utf8"))) : raw;
  // Drawn at about twice the size it is wanted at (an SVG's own size can be anything), cropped to its ink, then scaled
  // down for clean edges
  let density = 72;
  if (svg) {
    const meta = await sharp(input, { density: 72 }).metadata();
    const want = Math.max((2 * maxW) / (meta.width || maxW), (2 * maxH) / (meta.height || maxH));
    density = Math.min(600, Math.max(4, 72 * want));
  }
  const { data, info } = await sharp(input, { density, limitInputPixels: 64e6 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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

/** Each picture's drawing, from its source logos (`extra`: the event's logo for the combined banner, or null) */
const DRAW = {
  "huawei-logo.png": async (sharp, main) => {
    const logo = await tintedLogo(sharp, main, 1200, 120, RED);
    return svgDoc(logo.width + 24, logo.height + 24, image(logo, 12, 12));
  },
  "banner-huawei.png": async (sharp, main) => {
    const word = await tintedLogo(sharp, main, W - 220, 76, RED);
    return svgDoc(
      W,
      H,
      `<rect width="${W}" height="${H}" fill="${PAPER}"/>` +
        `<rect x="0" width="40" height="${H}" fill="${RED}"/><rect x="${W - 40}" width="40" height="${H}" fill="${RED}"/>` +
        `<rect x="40" width="10" height="${H}" fill="${BLACK}"/><rect x="${W - 50}" width="10" height="${H}" fill="${BLACK}"/>` +
        image(word, (W - word.width) / 2, (H - word.height) / 2)
    );
  },
  "banner-combo.png": async (sharp, main, extra, log) => {
    const word = await tintedLogo(sharp, main, 290, 48, WHITE);
    const gap = 28;
    let body = `<rect width="${W}" height="${H}" fill="${RED}"/><rect y="10" width="${W}" height="4" fill="${WHITE}"/><rect y="${H - 14}" width="${W}" height="4" fill="${WHITE}"/>`;
    let logo = null;
    if (extra) {
      try {
        logo = await tintedLogo(sharp, extra, 300, 96, WHITE);
      } catch (err) {
        log.warn(`[brand] event logo unusable on the combined banner: ${err.message}`);
      }
    }
    if (logo) {
      const timesW = await textWidth(sharp, "×", 44);
      const x0 = (W - (word.width + gap + timesW + gap + logo.width)) / 2;
      body += image(word, x0, (H - word.height) / 2) + text("×", x0 + word.width + gap, H / 2 + 15, 44, WHITE) + image(logo, x0 + word.width + gap + timesW + gap, (H - logo.height) / 2);
    } else {
      const label = `×  ${texts().name}`;
      const labelW = await textWidth(sharp, label, 40);
      const x0 = (W - (word.width + gap + labelW)) / 2;
      body += image(word, x0, (H - word.height) / 2) + text(label, x0 + word.width + gap, H / 2 + 14, 40, WHITE);
    }
    return svgDoc(W, H, body);
  },
  "mgw-logo.png": async (sharp, main) => {
    const logo = await tintedLogo(sharp, main, 1200, 200, WHITE);
    return svgDoc(logo.width + 24, logo.height + 24, image(logo, 12, 12));
  },
  "banner-mgw.png": async (sharp, main) => {
    const { dates, venue } = texts();
    const logo = await tintedLogo(sharp, main, 260, 104, WHITE);
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
};

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

    // Finished pictures need nothing else; the others need their sources, and sharp to draw them
    const finished = {};
    for (const name of Object.keys(OUTPUTS)) {
      const file = path.join(brandDir, name);
      if (exists(file)) finished[name] = { file, key: `finished:${sha(await fsp.readFile(file))}` };
    }
    const toDraw = Object.keys(OUTPUTS).filter((n) => !finished[n]);
    let sharp = null;
    let sharpProblem = null;
    if (toDraw.length > 0) {
      try {
        sharp = (await import("sharp")).default;
      } catch (err) {
        sharpProblem = `sharp unavailable (${err.message.split("\n")[0]}); run npm ci`;
      }
    }
    // Each source on its own: one slow download doesn't hold the other logo's pictures
    const wanted = new Set(toDraw.flatMap((n) => [OUTPUTS[n].source, OUTPUTS[n].extra].filter(Boolean)));
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
        const extra = OUTPUTS[name].extra ? sources[OUTPUTS[name].extra] : null;
        keys[name] = `drawn:${CODE_HASH}:${main.key}:${extra?.key ?? "-"}:${textKey}`;
        if (!force && stored[name] === keys[name] && exists(dest)) {
          result.upToDate.push(name);
          continue;
        }
        const svg = await DRAW[name](sharp, main.file, extra?.file ?? null, log);
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
