#!/usr/bin/env node
/**
 * LibreCorsa kiosk server (event branch event/gaming-week-2026).
 *
 * One process, no dependencies (Node 18+): it serves the static build in ../out and the kiosk's API under
 * /api/kiosk (the admin's config, the players' results and the leaderboard), keeping its data in JSON files. It runs
 * on the kiosk machine itself, so the stand keeps working without internet.
 *
 *   npm run build && npm start                       # then open http://localhost:8787 (the kiosk is the home page)
 *
 * Environment:
 *   PORT / KIOSK_PORT      port (8787)
 *   KIOSK_HOST             address to listen on (0.0.0.0: other screens on the LAN can open the leaderboard)
 *   KIOSK_ADMIN_PIN        the admin PIN (2026: change it for the event)
 *   KIOSK_DATA_DIR         where config.json and results.json live (kiosk/data)
 *   KIOSK_STATIC_DIR       the static build (out)
 *   KIOSK_HOME             a page "/" redirects to (empty, the default: "/" is the kiosk itself)
 *   KIOSK_PUBLIC_URL       the address other devices reach this server at, shown on the admin page with the leaderboard's
 *                          (e.g. http://192.168.1.50:8787 behind Docker or a proxy; by default the LAN addresses found)
 *   KIOSK_BRAND=0          don't make the brand pictures at start (kiosk/brand.mjs: logos and banners from HUAWEI's,
 *                          the event's and WINDTRE's logos, downloaded once or taken from kiosk/brand/)
 *
 * The logos shown (which, in what order, and the staff's own uploads) are kept by kiosk/logos.mjs and change live.
 *
 * The scoring rules mirror src/lib/kiosk/kiosk-score.ts and the config rules src/lib/kiosk/kiosk-types.ts.
 */

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { describeBrandResult, ensureBrandAssets } from "./brand.mjs";
import { MAX_UPLOAD_BYTES, createLogoRegistry } from "./logos.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const PORT = Number(process.env.PORT || process.env.KIOSK_PORT || 8787);
const HOST = process.env.KIOSK_HOST || "0.0.0.0";
const STATIC_DIR = path.resolve(process.env.KIOSK_STATIC_DIR || path.join(ROOT, "out"));
const DATA_DIR = path.resolve(process.env.KIOSK_DATA_DIR || path.join(here, "data"));
const ADMIN_PIN = String(process.env.KIOSK_ADMIN_PIN || "2026");
const HOME = process.env.KIOSK_HOME ?? "";
const PUBLIC_URL = (process.env.KIOSK_PUBLIC_URL || "").trim().replace(/\/+$/, "");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const RESULTS_FILE = path.join(DATA_DIR, "results.json");
const MAX_BODY_BYTES = 256 * 1024;

// ---------------------------------------------------------------------------------------------------------------
// Config (src/lib/kiosk/kiosk-types.ts)

// Monza is the event's circuit (a build can leave it out: NEXT_PUBLIC_EXTRA_CONTENT); the 2026 Prototype its one car
// (the Ferrari SF-26 it ran before is gone: a config naming it takes the default)
const TRACK_IDS = ["monza", "rwanda_official_short", "rwanda_official"];
const CAR_IDS = ["lc26"];
// The 2026 Prototype was "vf26" until upstream renamed it (8cffd303): configs and results saved before keep working
const LEGACY_CAR_IDS = { vf26: "lc26" };
/** A car id as the kiosk knows it now (an old "vf26" is the "lc26"), or undefined for no string */
const carIdOf = (v) => (typeof v === "string" ? (Object.prototype.hasOwnProperty.call(LEGACY_CAR_IDS, v) ? LEGACY_CAR_IDS[v] : v) : undefined);
const DIFFICULTIES = ["assisted", "semi_pro", "pro"];
const DEVICES = ["controller", "wheel", "keyboard"];
const GRAPHICS = ["low", "medium", "high"];
const DEFAULT_CONFIG = {
  limitMode: "time",
  laps: 3,
  minutes: 5,
  maxMinutes: 10,
  trackId: "monza",
  carId: "lc26",
  difficulty: "assisted",
  simpleDrive: true,
  device: "controller",
  gyroSteer: false,
  gyroLockDeg: 45,
  gyroSensitivity: 0.85,
  graphics: "medium",
  invalidLaps: "penalty",
  penaltyS: 5,
  racingLine: true,
  countdownS: 3,
  resultsHoldS: 30,
  motto: "Sfida il cronometro! Sei tu il più veloce?",
};

/** The motto as the screens show it (src/lib/kiosk/kiosk-types.ts cleanMotto) */
const cleanMotto = (v) =>
  (typeof v === "string" ? v : "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

function num(v, min, max, fallback, step = 1) {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const snapped = Math.round(n / step) * step;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(3))));
}

function sanitizeConfig(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const d = DEFAULT_CONFIG;
  return {
    limitMode: r.limitMode === "laps" || r.limitMode === "time" ? r.limitMode : d.limitMode,
    laps: num(r.laps, 1, 20, d.laps),
    minutes: num(r.minutes, 0.5, 60, d.minutes, 0.5),
    maxMinutes: num(r.maxMinutes, 0, 120, d.maxMinutes, 0.5),
    trackId: TRACK_IDS.includes(r.trackId) ? r.trackId : d.trackId,
    carId: CAR_IDS.includes(carIdOf(r.carId)) ? carIdOf(r.carId) : d.carId,
    difficulty: DIFFICULTIES.includes(r.difficulty) ? r.difficulty : d.difficulty,
    // «Guida semplice» (src/lib/kiosk/kiosk-types.ts): a config.json from before the switch has none, and comes out on
    simpleDrive: typeof r.simpleDrive === "boolean" ? r.simpleDrive : d.simpleDrive,
    device: DEVICES.includes(r.device) ? r.device : d.device,
    // Tilt steering (src/lib/kiosk/kiosk-types.ts): the game's ranges
    gyroSteer: typeof r.gyroSteer === "boolean" ? r.gyroSteer : d.gyroSteer,
    gyroLockDeg: num(r.gyroLockDeg, 10, 90, d.gyroLockDeg),
    gyroSensitivity: num(r.gyroSensitivity, 0.5, 1.5, d.gyroSensitivity, 0.05),
    graphics: GRAPHICS.includes(r.graphics) ? r.graphics : d.graphics,
    invalidLaps: r.invalidLaps === "exclude" || r.invalidLaps === "penalty" ? r.invalidLaps : d.invalidLaps,
    penaltyS: num(r.penaltyS, 0, 60, d.penaltyS, 0.5),
    racingLine: typeof r.racingLine === "boolean" ? r.racingLine : d.racingLine,
    countdownS: num(r.countdownS, 0, 10, d.countdownS),
    resultsHoldS: num(r.resultsHoldS, 5, 300, d.resultsHoldS),
    motto: typeof r.motto === "string" ? cleanMotto(r.motto) : d.motto,
    ...(typeof r.updatedAt === "string" ? { updatedAt: r.updatedAt } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Scoring (src/lib/kiosk/kiosk-score.ts)

function lapScore(lap, rules) {
  if (lap.valid) return lap.lapMs;
  return rules.invalidLaps === "penalty" ? lap.lapMs + Math.round(rules.penaltyS * 1000) : null;
}

function scoreSession(laps, rules) {
  let bestLapMs = null;
  let bestLapPenalised = false;
  for (const lap of laps) {
    const s = lapScore(lap, rules);
    if (s === null) continue;
    if (bestLapMs === null || s < bestLapMs) {
      bestLapMs = s;
      bestLapPenalised = !lap.valid;
    }
  }
  let totalTimeMs = null;
  if (rules.limitMode === "laps" && laps.length >= rules.limitLaps) {
    let sum = 0;
    for (const lap of laps.slice(0, rules.limitLaps)) {
      const s = lapScore(lap, rules);
      if (s === null) {
        sum = NaN;
        break;
      }
      sum += s;
    }
    totalTimeMs = Number.isFinite(sum) ? sum : null;
  }
  return { bestLapMs, bestLapPenalised, totalTimeMs, validLaps: laps.filter((l) => l.valid).length };
}

/** The same name in any case or spacing is the same driver on the leaderboard */
const nameKey = (name) => name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

function sanitizeName(v) {
  if (typeof v !== "string") return "";
  // As the game's sanitizeDriverName: no control characters or angle brackets, 16 characters at most
  return v.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** A posted result, checked and made whole; a string says why it was refused */
function parseResult(raw) {
  if (!raw || typeof raw !== "object") return "Risultato non valido";
  const name = sanitizeName(raw.name);
  if (!name) return "Nome mancante";
  const clientId = typeof raw.clientId === "string" && ID_RE.test(raw.clientId) ? raw.clientId : crypto.randomUUID();
  const trackId = typeof raw.trackId === "string" && ID_RE.test(raw.trackId) ? raw.trackId : null;
  const carId = typeof raw.carId === "string" && ID_RE.test(raw.carId) ? carIdOf(raw.carId) : "lc26";
  if (!trackId) return "Circuito mancante";
  const limitMode = raw.limitMode === "laps" ? "laps" : raw.limitMode === "time" ? "time" : null;
  if (!limitMode) return "Modalità non valida";
  if (!Array.isArray(raw.laps) || raw.laps.length > 200) return "Giri non validi";
  const laps = [];
  for (const lap of raw.laps) {
    const lapMs = Math.round(Number(lap?.lapMs));
    // The game times laps of 20 s to 30 min only (lap-recorder.ts)
    if (!Number.isFinite(lapMs) || lapMs < 20_000 || lapMs > 1_800_000) return "Tempo sul giro non valido";
    laps.push({ lapMs, valid: lap?.valid === true });
  }
  const result = {
    clientId,
    name,
    trackId,
    carId,
    // The level the player picked on the start screen
    difficulty: DIFFICULTIES.includes(raw.difficulty) ? raw.difficulty : null,
    limitMode,
    limitLaps: num(raw.limitLaps, 1, 50, 3),
    limitMinutes: num(raw.limitMinutes, 0, 120, 0, 0.5),
    invalidLaps: raw.invalidLaps === "exclude" ? "exclude" : "penalty",
    penaltyS: num(raw.penaltyS, 0, 60, 5, 0.5),
    laps,
    finished: raw.finished === true,
    drivenMs: num(raw.drivenMs, 0, 86_400_000, 0),
  };
  const score = scoreSession(laps, result);
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...result,
    ...score,
    // Only a "laps" session that drove all its laps has a total
    totalTimeMs: result.finished ? score.totalTimeMs : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Ranking

/** Best result per driver, fastest first: best lap on a circuit in a car, or total time of "laps" sessions of one length */
function ranked(results, { mode, trackId, carId, laps, unique = true }) {
  const scoreOf = mode === "total" ? (r) => r.totalTimeMs : (r) => r.bestLapMs;
  // Results from before the car choice existed were all driven in the 2026 Prototype (then "vf26", now "lc26")
  const car = carIdOf(carId);
  let pool = results.filter((r) => r.trackId === trackId && (carIdOf(r.carId) ?? "lc26") === car);
  if (mode === "total") pool = pool.filter((r) => r.limitMode === "laps" && r.limitLaps === laps);
  pool = pool.filter((r) => scoreOf(r) !== null && scoreOf(r) !== undefined);
  pool.sort((a, b) => scoreOf(a) - scoreOf(b) || a.createdAt.localeCompare(b.createdAt));
  if (unique) {
    const seen = new Set();
    pool = pool.filter((r) => {
      const k = nameKey(r.name);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  // Equal times share a place
  let lastScore = null;
  let lastRank = 0;
  return pool.map((r, i) => {
    const s = scoreOf(r);
    const rank = s === lastScore ? lastRank : i + 1;
    lastScore = s;
    lastRank = rank;
    return { rank, result: r };
  });
}

function leaderboard(results, query) {
  const all = ranked(results, query);
  const limit = num(query.limit, 1, 500, 20);
  return {
    mode: query.mode,
    trackId: query.trackId,
    carId: query.carId,
    laps: query.mode === "total" ? query.laps : null,
    total: all.length,
    generatedAt: new Date().toISOString(),
    rows: all.slice(0, limit).map(({ rank, result: r }) => ({
      rank,
      id: r.id,
      name: r.name,
      difficulty: r.difficulty ?? null,
      bestLapMs: r.bestLapMs,
      bestLapPenalised: r.bestLapPenalised,
      totalTimeMs: r.totalTimeMs,
      lapsCompleted: r.laps.length,
      validLaps: r.validLaps,
      createdAt: r.createdAt,
    })),
  };
}

/** The place a result takes: one more than the drivers (other names) whose best is faster */
function placeOf(results, result, query) {
  const scoreOf = query.mode === "total" ? (r) => r.totalTimeMs : (r) => r.bestLapMs;
  const mine = scoreOf(result);
  if (mine === null || mine === undefined) return null;
  const me = nameKey(result.name);
  const faster = ranked(results, query).filter(({ result: r }) => nameKey(r.name) !== me && scoreOf(r) < mine);
  return faster.length + 1;
}

/** The ranking a config shows by default (src/lib/kiosk/kiosk-types.ts rankingModeFor) */
const queryFor = (config, params) => {
  const mode = params.get("mode") === "total" || params.get("mode") === "best" ? params.get("mode") : config.limitMode === "laps" ? "total" : "best";
  const trackId = params.get("track") && ID_RE.test(params.get("track")) ? params.get("track") : config.trackId;
  const carId = params.get("car") && ID_RE.test(params.get("car")) ? carIdOf(params.get("car")) : config.carId;
  const laps = num(params.get("laps") ?? config.laps, 1, 50, config.laps);
  return { mode, trackId, carId, laps, limit: params.get("limit") ?? 20, unique: params.get("unique") !== "0" };
};

// ---------------------------------------------------------------------------------------------------------------
// Storage: whole-file JSON, written to a temporary file and renamed over the old one, one write at a time

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") console.error(`[kiosk] ${path.basename(file)} unreadable, starting from defaults:`, err.message);
    return fallback;
  }
}

let config = (() => {
  const raw = readJsonFile(CONFIG_FILE, DEFAULT_CONFIG);
  // A config saved before the kiosk opened on Monza (it has no "device") takes up the event's circuit and car once
  if (raw && typeof raw === "object" && !("device" in raw) && fs.existsSync(CONFIG_FILE)) {
    console.log(`[kiosk] config from an earlier version: circuit and car set to ${DEFAULT_CONFIG.trackId} / ${DEFAULT_CONFIG.carId}`);
    return sanitizeConfig({ ...raw, trackId: DEFAULT_CONFIG.trackId, carId: DEFAULT_CONFIG.carId });
  }
  return sanitizeConfig(raw);
})();
let results = (() => {
  const raw = readJsonFile(RESULTS_FILE, []);
  return Array.isArray(raw) ? raw.filter((r) => r && typeof r.id === "string" && Array.isArray(r.laps)) : [];
})();

// The logos shown on the screens and the trackside boards (built-in and uploaded)
const logos = createLogoRegistry({ dataDir: DATA_DIR, servedBrandDir: path.join(STATIC_DIR, "kiosk", "brand"), log: console });

let writeChain = Promise.resolve();
function persist(file, value) {
  const data = JSON.stringify(value, null, 1);
  writeChain = writeChain
    .then(async () => {
      const tmp = `${file}.tmp-${process.pid}`;
      await fsp.writeFile(tmp, data);
      await fsp.rename(tmp, file);
    })
    .catch((err) => console.error(`[kiosk] could not write ${path.basename(file)}:`, err));
  return writeChain;
}

// ---------------------------------------------------------------------------------------------------------------
// HTTP helpers

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Kiosk-Pin",
  "Access-Control-Max-Age": "600",
};

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Richiesta troppo grande"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve(null);
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(Object.assign(new Error("JSON non valido"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

/**
 * A request's body as it came (an uploaded picture), up to `limit` bytes. A body announced as larger is refused before
 * it is read
 */
function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"]) > limit) {
      reject(Object.assign(new Error(`File troppo grande (massimo ${Math.round(limit / 1048576)} MB)`), { status: 413 }));
      return;
    }
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error(`File troppo grande (massimo ${Math.round(limit / 1048576)} MB)`), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * A refused upload is never kept: the answer goes out at once and the rest of the file is read and dropped (a browser
 * still sending it would otherwise see a broken connection instead of the answer)
 */
function refuseUpload(req, res, status, error) {
  sendJson(res, status, { ok: false, error });
  req.resume();
}

/** Constant-time PIN check */
function pinOk(req) {
  const given = Buffer.from(String(req.headers["x-kiosk-pin"] ?? ""));
  const want = Buffer.from(ADMIN_PIN);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

const csvCell = (v) => {
  let s = v === null || v === undefined ? "" : String(v);
  // A cell a spreadsheet would run as a formula is kept as text
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const fmtLap = (ms) => {
  if (ms === null || ms === undefined) return "";
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return `${m}:${s}`;
};

const DIFFICULTY_LABELS = { assisted: "facile", semi_pro: "medio", pro: "difficile" };

function resultsCsv() {
  const head = ["id", "data", "nome", "circuito", "auto", "difficolta", "modalita", "giri_limite", "minuti_limite", "giri_completati", "giri_validi", "miglior_giro_ms", "miglior_giro", "penalizzato", "tempo_totale_ms", "tempo_totale", "completato", "tempo_guida_ms", "giri"];
  const rows = results.map((r) => [
    r.id,
    r.createdAt,
    r.name,
    r.trackId,
    carIdOf(r.carId) ?? "lc26",
    DIFFICULTY_LABELS[r.difficulty] ?? "",
    r.limitMode,
    r.limitLaps,
    r.limitMinutes,
    r.laps.length,
    r.validLaps,
    r.bestLapMs,
    fmtLap(r.bestLapMs),
    r.bestLapPenalised ? "si" : "no",
    r.totalTimeMs,
    fmtLap(r.totalTimeMs),
    r.finished ? "si" : "no",
    r.drivenMs,
    r.laps.map((l) => `${fmtLap(l.lapMs)}${l.valid ? "" : "*"}`).join(" "),
  ]);
  return [head, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------------------------------------------
// Network: the addresses other screens on the LAN reach this server at (the admin page shows the leaderboard's)

/** This machine's IPv4 addresses, the LAN's first: private ranges before others, virtual bridges (Docker…) last */
function lanAddresses() {
  const out = [];
  for (const [iface, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.internal || !(a.family === "IPv4" || a.family === 4) || a.address.startsWith("169.254.")) continue;
      const virtual = /^(docker|br-|veth|virbr|vmnet|vboxnet|tun|tap|wg|zt|tailscale|utun)/i.test(iface);
      const lan = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      out.push({ iface, address: a.address, virtual, rank: virtual ? 2 : lan ? 0 : 1 });
    }
  }
  return out.sort((x, y) => x.rank - y.rank || x.iface.localeCompare(y.iface)).map(({ rank, ...a }) => a);
}

/** Where this server is reached: KIOSK_PUBLIC_URL, else one address per LAN interface (all of them when listening on any) */
function serverUrls() {
  const listenAny = HOST === "0.0.0.0" || HOST === "::";
  const urls = [];
  if (PUBLIC_URL) urls.push({ url: PUBLIC_URL, iface: "KIOSK_PUBLIC_URL", virtual: false });
  if (listenAny) for (const a of lanAddresses()) urls.push({ url: `http://${a.address}:${PORT}`, iface: a.iface, virtual: a.virtual });
  else if (HOST !== "127.0.0.1" && HOST !== "localhost") urls.push({ url: `http://${HOST}:${PORT}`, iface: "KIOSK_HOST", virtual: false });
  return urls;
}

// ---------------------------------------------------------------------------------------------------------------
// API

async function handleApi(req, res, url) {
  const route = url.pathname.replace(/\/+$/, "");
  const method = req.method;
  if (method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  // The game's own online side (src/lib/net/online-config.ts): all off on the kiosk
  if (route === "/api/config" && method === "GET") {
    return sendJson(res, 200, { rooms: false, relay: false, races: false, board: false, usage: false });
  }

  if (route === "/api/kiosk/health" && method === "GET") {
    return sendJson(res, 200, { ok: true, results: results.length, time: new Date().toISOString() });
  }

  // The addresses of the leaderboard page and API on the LAN (for the admin page; LAN addresses are no secret there)
  if (route === "/api/kiosk/network" && method === "GET") {
    return sendJson(res, 200, {
      port: PORT,
      urls: serverUrls(),
      paths: { leaderboardPage: "/kiosk/classifica", leaderboardApi: "/api/kiosk/leaderboard" },
    });
  }

  if (route === "/api/kiosk/auth" && method === "POST") {
    return pinOk(req) ? sendJson(res, 200, { ok: true }) : sendJson(res, 401, { ok: false, error: "PIN non valido" });
  }

  if (route === "/api/kiosk/config") {
    if (method === "GET") return sendJson(res, 200, config);
    if (method === "PUT") {
      if (!pinOk(req)) return sendJson(res, 401, { error: "PIN non valido" });
      const body = await readBody(req);
      // Fields left out keep their value: a client may send only what it changes
      config = sanitizeConfig({ ...config, ...(body && typeof body === "object" ? body : {}), updatedAt: new Date().toISOString() });
      await persist(CONFIG_FILE, config);
      console.log(`[kiosk] config saved: ${config.limitMode === "laps" ? `${config.laps} laps` : `${config.minutes} min`} on ${config.trackId}`);
      return sendJson(res, 200, config);
    }
  }

  if (route === "/api/kiosk/leaderboard" && method === "GET") {
    return sendJson(res, 200, leaderboard(results, queryFor(config, url.searchParams)));
  }

  if (route === "/api/kiosk/results") {
    if (method === "POST") {
      const parsed = parseResult(await readBody(req));
      if (typeof parsed === "string") return sendJson(res, 400, { ok: false, rank: null, error: parsed });
      // A retry of a result already stored answers with the stored one
      let result = results.find((r) => r.clientId === parsed.clientId);
      if (!result) {
        result = parsed;
        results.push(result);
        await persist(RESULTS_FILE, results);
        console.log(`[kiosk] result: ${result.name} · ${result.laps.length} laps · best ${fmtLap(result.bestLapMs) || "-"}`);
      }
      const query = {
        mode: result.limitMode === "laps" ? "total" : "best",
        trackId: result.trackId,
        carId: result.carId,
        laps: result.limitLaps,
        limit: 10,
        unique: true,
      };
      // A "laps" session that ran out of time has no total: it takes its place on the best-lap ranking instead
      if (query.mode === "total" && result.totalTimeMs === null) query.mode = "best";
      return sendJson(res, 200, { ok: true, result, rank: placeOf(results, result, query), leaderboard: leaderboard(results, query) });
    }
    if (method === "GET") {
      if (!pinOk(req)) return sendJson(res, 401, { error: "PIN non valido" });
      return sendJson(res, 200, { results: [...results].reverse() });
    }
    if (method === "DELETE") {
      if (!pinOk(req)) return sendJson(res, 401, { error: "PIN non valido" });
      // The old board is kept beside the new, empty one
      const backup = `results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      if (results.length > 0) await fsp.writeFile(path.join(DATA_DIR, backup), JSON.stringify(results, null, 1));
      results = [];
      await persist(RESULTS_FILE, results);
      console.log(`[kiosk] leaderboard cleared (backup ${backup})`);
      return sendJson(res, 200, { ok: true, backup });
    }
  }

  if (route === "/api/kiosk/results.csv" && method === "GET") {
    if (!pinOk(req)) return sendJson(res, 401, { error: "PIN non valido" });
    res.writeHead(200, {
      ...CORS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="classifica-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    });
    // A BOM so spreadsheet programs read the names as UTF-8
    return res.end(`﻿${resultsCsv()}`);
  }

  const one = route.match(/^\/api\/kiosk\/results\/([A-Za-z0-9_-]{1,64})$/);
  if (one && method === "DELETE") {
    if (!pinOk(req)) return sendJson(res, 401, { error: "PIN non valido" });
    const before = results.length;
    results = results.filter((r) => r.id !== one[1]);
    if (results.length === before) return sendJson(res, 404, { ok: false, error: "Risultato non trovato" });
    await persist(RESULTS_FILE, results);
    return sendJson(res, 200, { ok: true });
  }

  // ---- Logos: anyone reads the list (the game asks every few seconds), only the PIN changes it

  if (route === "/api/kiosk/logos") {
    if (method === "GET") return sendJson(res, 200, logos.publicList());
    if (method === "PUT") {
      if (!pinOk(req)) return sendJson(res, 401, { error: "PIN non valido" });
      const body = await readBody(req);
      return sendJson(res, 200, await logos.update(body && typeof body === "object" ? body : {}));
    }
    if (method === "POST") {
      // The PIN before the file: a stranger's upload is never read
      if (!pinOk(req)) return refuseUpload(req, res, 401, "PIN non valido");
      if (Number(req.headers["content-length"]) > MAX_UPLOAD_BYTES) {
        return refuseUpload(req, res, 413, `File troppo grande (massimo ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB)`);
      }
      const raw = await readRawBody(req, MAX_UPLOAD_BYTES);
      if (raw.length === 0) return sendJson(res, 400, { ok: false, error: "Nessun file ricevuto" });
      return sendJson(res, 201, { ok: true, ...(await logos.add(raw, url.searchParams.get("name") ?? "")) });
    }
  }

  // An uploaded logo's pictures (drawn PNGs only, never the uploaded file)
  const picture = route.match(/^\/api\/kiosk\/logos\/(u-[a-z0-9]{8})\/(logo|banner)\.png$/);
  if (picture && (method === "GET" || method === "HEAD")) {
    const file = logos.picturePath(picture[1], picture[2]);
    const stat = file ? await fileAt(file) : null;
    if (!stat) return sendJson(res, 404, { error: "Logo non trovato" });
    res.writeHead(200, {
      ...CORS,
      "Content-Type": "image/png",
      "Content-Length": stat.size,
      "X-Content-Type-Options": "nosniff",
      // Its address changes with its picture (?v=): a copy can be kept
      "Cache-Control": url.searchParams.has("v") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    if (method === "HEAD") return res.end();
    return fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  }

  const oneLogo = route.match(/^\/api\/kiosk\/logos\/([a-z0-9-]{1,40})$/);
  if (oneLogo && method === "DELETE") {
    if (!pinOk(req)) return sendJson(res, 401, { error: "PIN non valido" });
    return sendJson(res, 200, await logos.remove(oneLogo[1]));
  }

  // Anything else under /api (the usage counter, lap boards, rooms…) is not on the kiosk: a quick 404
  return sendJson(res, 404, { error: "Not found" });
}

// ---------------------------------------------------------------------------------------------------------------
// Static files

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".ktx2": "image/ktx2",
  ".wasm": "application/wasm",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

async function fileAt(candidate) {
  try {
    const stat = await fsp.stat(candidate);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

async function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end();
  }
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (rel === "/" && HOME) {
    res.writeHead(302, { Location: `${HOME}${url.search}` });
    return res.end();
  }
  const base = path.resolve(STATIC_DIR, `.${rel}`);
  if (base !== STATIC_DIR && !base.startsWith(STATIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  // Next's static export: /kiosk/admin is kiosk/admin.html (or a folder's index.html)
  const candidates = rel.endsWith("/") ? [path.join(base, "index.html"), `${base.replace(/[\\/]+$/, "")}.html`] : [base, `${base}.html`, path.join(base, "index.html")];
  for (const file of candidates) {
    const stat = await fileAt(file);
    if (!stat) continue;
    const ext = path.extname(file).toLowerCase();
    const headers = {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Length": stat.size,
      "Last-Modified": stat.mtime.toUTCString(),
      "Cache-Control": rel.startsWith("/_next/static/")
        ? "public, max-age=31536000, immutable"
        : ext === ".html" || rel === "/sw.js"
          ? "no-cache"
          : "public, max-age=0, must-revalidate",
    };
    if (req.headers["if-modified-since"] && new Date(req.headers["if-modified-since"]).getTime() >= Math.floor(stat.mtimeMs / 1000) * 1000) {
      res.writeHead(304, headers);
      return res.end();
    }
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  }
  const notFound = path.join(STATIC_DIR, "404.html");
  if (await fileAt(notFound)) {
    res.writeHead(404, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
    return req.method === "HEAD" ? res.end() : fs.createReadStream(notFound).pipe(res);
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

// ---------------------------------------------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  try {
    // Inside the try: a request target such as "//" is no URL, and an error out here would end the whole server
    const url = new URL(req.url ?? "/", "http://kiosk.local");
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (err) {
    const status = err && err.code === "ERR_INVALID_URL" ? 400 : err && typeof err.status === "number" ? err.status : 500;
    if (status === 500) console.error("[kiosk]", err);
    if (!res.headersSent) sendJson(res, status, { error: status === 500 ? "Errore del server" : status === 400 && err.code === "ERR_INVALID_URL" ? "Indirizzo non valido" : err.message });
    else res.destroy();
  }
});

// The brand pictures (header logos, trackside banners) into the served build, before the first page asks for them;
// a slow download doesn't hold the kiosk up for long, and a failure only leaves the game's text in their place
const BRAND_WAIT_MS = 20_000;
const brandWork = ensureBrandAssets({ outDir: path.join(STATIC_DIR, "kiosk", "brand"), log: console });
let brandTimer;
const brand = await Promise.race([brandWork, new Promise((resolve) => (brandTimer = setTimeout(() => resolve(null), BRAND_WAIT_MS)))]);
clearTimeout(brandTimer);
if (brand) console.log(`[kiosk] brand pictures: ${describeBrandResult(brand)}`);
else {
  console.log("[kiosk] brand pictures: still being made after 20 s, the kiosk starts meanwhile");
  void brandWork.then((late) => console.log(`[kiosk] brand pictures (late): ${describeBrandResult(late)}`));
}
// The staff's uploaded logos: pictures missing or drawn by another version are drawn again
try {
  const uploads = await logos.ensurePictures();
  if (uploads > 0) console.log(`[kiosk] uploaded logos: ${uploads}`);
} catch (err) {
  console.warn(`[kiosk] uploaded logos not checked: ${err.message}`);
}

server.listen(PORT, HOST, () => {
  const staticOk = fs.existsSync(path.join(STATIC_DIR, "index.html"));
  console.log(`[kiosk] kiosk on http://localhost:${PORT}${HOME || "/"}`);
  for (const u of serverUrls()) console.log(`[kiosk] leaderboard on the network: ${u.url}/kiosk/classifica (${u.iface}${u.virtual ? ", virtual" : ""})`);
  console.log(`[kiosk] data: ${DATA_DIR} (${results.length} results) · static: ${STATIC_DIR}${staticOk ? "" : " (no build found: run npm run build)"}`);
  if (!process.env.KIOSK_ADMIN_PIN) console.warn("[kiosk] KIOSK_ADMIN_PIN not set: the admin PIN is the default 2026. Set your own for the event.");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close();
    writeChain.finally(() => process.exit(0));
  });
}
