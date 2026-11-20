/**
 * Kiosk mode (event branch): the scoring rules, the config's ranges, and kiosk/server.mjs's API (config behind the
 * PIN, results, ranking, a retried post stored once, the CSV, the logos shown and uploaded) on a throwaway data folder,
 * and the brand pictures kiosk/brand.mjs draws.
 *
 * Run: npm run verify kiosk
 */

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatClock, formatLapTime, formatMinutes, scoreSession } from "../src/lib/kiosk/kiosk-score";
import { DEFAULT_KIOSK_CONFIG, sanitizeKioskConfig } from "../src/lib/kiosk/kiosk-types";
import { kioskSettingsFor } from "../src/lib/kiosk/kiosk-settings";
import { DEFAULT_PLAYER_SETTINGS } from "../src/lib/settings/player-settings";
import { LIVERIES } from "../src/lib/track-data";

let failures = 0;
const check = async (name: string, fn: () => void | Promise<void>) => {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${err instanceof Error ? err.message : String(err)}`);
  }
};

async function main() {
  console.log("Scoring");
  const laps = [
    { lapMs: 101_000, valid: true },
    { lapMs: 99_000, valid: false },
    { lapMs: 100_000, valid: true },
  ];
  await check("best lap: the fastest valid one; an invalid lap only with its penalty", () => {
    const s = scoreSession(laps, { limitMode: "time", limitLaps: 3, invalidLaps: "penalty", penaltyS: 5 });
    assert.equal(s.bestLapMs, 100_000);
    assert.equal(s.bestLapPenalised, false);
    assert.equal(s.validLaps, 2);
    assert.equal(s.totalTimeMs, null, "a time session has no total");
  });
  await check("a penalised lap can still be the best when the penalty is small", () => {
    const s = scoreSession(laps, { limitMode: "time", limitLaps: 3, invalidLaps: "penalty", penaltyS: 0.5 });
    assert.equal(s.bestLapMs, 99_500);
    assert.equal(s.bestLapPenalised, true);
  });
  await check("laps session: the total adds the penalties; 'exclude' leaves no total", () => {
    const rules = { limitMode: "laps" as const, limitLaps: 3, penaltyS: 5 };
    assert.equal(scoreSession(laps, { ...rules, invalidLaps: "penalty" }).totalTimeMs, 101_000 + 104_000 + 100_000);
    assert.equal(scoreSession(laps, { ...rules, invalidLaps: "exclude" }).totalTimeMs, null);
    assert.equal(scoreSession(laps.slice(0, 2), { ...rules, invalidLaps: "penalty" }).totalTimeMs, null, "not all laps driven");
  });
  await check("no laps: nothing to rank", () => {
    const s = scoreSession([], { limitMode: "time", limitLaps: 3, invalidLaps: "penalty", penaltyS: 5 });
    assert.equal(s.bestLapMs, null);
  });
  await check("formats", () => {
    assert.equal(formatLapTime(101_234), "1:41.234");
    assert.equal(formatLapTime(59_001), "59.001");
    assert.equal(formatLapTime(null), "--:--.---");
    assert.equal(formatClock(299_001, true), "5:00");
    assert.equal(formatClock(299_999), "4:59");
    assert.equal(formatMinutes(0.5), "30 secondi");
    assert.equal(formatMinutes(1), "1 minuto");
    assert.equal(formatMinutes(2.5), "2:30 minuti");
  });

  console.log("Extras");
  await check("Monza is listed by default, the SF-26 never (the event can't use it); NEXT_PUBLIC_EXTRA_CONTENT narrows them", async () => {
    // The variable left out entirely (a plain build), not set to ""
    const { NEXT_PUBLIC_EXTRA_CONTENT: _unset, ...baseEnv } = process.env;
    void _unset;
    const probe = (env: Record<string, string>) =>
      execFileSync(process.execPath, ["--import", "tsx", "-e", `const h = require(${JSON.stringify(join(__dirname, "../src/lib/hosted-content.ts"))}); console.log(JSON.stringify([h.carListed("sf26"), h.trackListed("monza"), h.carListed("lc26"), h.trackListed("rwanda_official_short")]))`], {
        env: { ...baseEnv, NEXT_PUBLIC_HOSTED_CONTENT: "", ...env },
        encoding: "utf8",
      }).trim();
    // The SF-26 is no extra any more: hosted on librecorsa.org at most (a hosted build lists it there, with its files)
    assert.equal(probe({}), "[false,true,true,true]", "default build");
    assert.equal(probe({ NEXT_PUBLIC_EXTRA_CONTENT: "" }), "[false,false,true,true]", "an empty list leaves Monza out");
    assert.equal(probe({ NEXT_PUBLIC_EXTRA_CONTENT: "sf26" }), "[false,false,true,true]", "naming the SF-26 brings nothing back");
    assert.equal(probe({ NEXT_PUBLIC_EXTRA_CONTENT: "sf26,monza,f2004" }), "[false,true,true,true]", "Monza named (unknown ids ignored)");
  });

  console.log("Config");
  await check("anything sent is made whole and in range", () => {
    const c = sanitizeKioskConfig({ limitMode: "laps", laps: 99, minutes: -3, trackId: "imola", carId: "f2004", difficulty: "x", penaltyS: "7.3", extra: true });
    assert.equal(c.limitMode, "laps");
    assert.equal(c.laps, 20);
    assert.equal(c.minutes, 0.5);
    assert.equal(c.trackId, DEFAULT_KIOSK_CONFIG.trackId);
    assert.equal(c.carId, DEFAULT_KIOSK_CONFIG.carId);
    assert.equal(sanitizeKioskConfig({ trackId: "monza", carId: "sf26" }).trackId, "monza", "Monza is a known circuit");
    assert.equal(sanitizeKioskConfig({ carId: "sf26" }).carId, "lc26", "a config from when the kiosk ran the SF-26 runs the 2026 Prototype");
    // The 2026 Prototype was "vf26" until upstream renamed it: a config saved with the old id keeps its car
    assert.equal(sanitizeKioskConfig({ carId: "vf26" }).carId, "lc26", "an old vf26 is the lc26, not the default car");
    assert.equal(sanitizeKioskConfig({ carId: "lc26" }).carId, "lc26");
    assert.equal(c.difficulty, DEFAULT_KIOSK_CONFIG.difficulty);
    assert.equal(c.penaltyS, 7.5);
    assert.equal("extra" in c, false);
    const d = sanitizeKioskConfig({ device: "joystick", graphics: "ultra" });
    assert.deepEqual([d.trackId, d.carId, d.device, d.graphics], ["monza", "lc26", "controller", "medium"], "the event's defaults");
    assert.deepEqual([sanitizeKioskConfig({ device: "wheel" }).device, sanitizeKioskConfig({ graphics: "high" }).graphics], ["wheel", "high"]);
  });
  await check("tilt steering: off at first, in the game's ranges, on the controller only, never this browser's own", () => {
    const d = sanitizeKioskConfig({});
    assert.deepEqual([d.gyroSteer, d.gyroLockDeg, d.gyroSensitivity], [false, 45, 0.85]);
    const c = sanitizeKioskConfig({ gyroSteer: true, gyroLockDeg: 200, gyroSensitivity: 0.12 });
    assert.deepEqual([c.gyroSteer, c.gyroLockDeg, c.gyroSensitivity], [true, 90, 0.5]);
    assert.equal(sanitizeKioskConfig({ gyroSteer: "yes" }).gyroSteer, false, "only a boolean turns it on");
    assert.equal(sanitizeKioskConfig({ gyroSensitivity: 1.23 }).gyroSensitivity, 1.25, "in steps of 0.05");
    // The browser's full game had it on with its own numbers: the kiosk's config decides, both ways
    const own = { ...DEFAULT_PLAYER_SETTINGS, dualSense: { ...DEFAULT_PLAYER_SETTINGS.dualSense, gyroSteer: true, gyroLockDeg: 20, gyroSensitivity: 1.5 } };
    const off = kioskSettingsFor(sanitizeKioskConfig({}))(own).dualSense;
    assert.deepEqual([off.gyroSteer, off.gyroLockDeg, off.gyroSensitivity], [false, 45, 0.85]);
    const on = kioskSettingsFor(sanitizeKioskConfig({ gyroSteer: true, gyroLockDeg: 50 }))(DEFAULT_PLAYER_SETTINGS).dualSense;
    assert.deepEqual([on.gyroSteer, on.gyroLockDeg], [true, 50]);
    const wheel = kioskSettingsFor(sanitizeKioskConfig({ gyroSteer: true, device: "wheel" }))(DEFAULT_PLAYER_SETTINGS).dualSense;
    assert.equal(wheel.gyroSteer, false, "never with a wheel");
    // The other pad settings stay the browser's
    assert.equal(off.adaptiveTriggers, own.dualSense.adaptiveTriggers);
  });
  await check("the car wears Applikat's livery, the sponsor's only with its logo on", () => {
    assert.equal(kioskSettingsFor(sanitizeKioskConfig({}))(DEFAULT_PLAYER_SETTINGS).liveryId, "applikat");
    assert.equal(kioskSettingsFor(sanitizeKioskConfig({}), "assisted", true)(DEFAULT_PLAYER_SETTINGS).liveryId, "huawei_mgw");
    const livery = LIVERIES.find((l) => l.id === "applikat");
    assert.ok(livery?.decals, "the Applikat livery has its pictures");
    assert.ok(existsSync(join(__dirname, "../public", livery!.decals!.atlas)), "its atlas is in public/");
  });
  await check("the soundtrack is off on the kiosk, every other sound as saved", () => {
    const a = kioskSettingsFor(sanitizeKioskConfig({}))(DEFAULT_PLAYER_SETTINGS).audio;
    assert.equal(a.musicMuted, true);
    assert.equal(a.musicOff.length > 0, true, "every track switched off");
    assert.equal(a.volume, DEFAULT_PLAYER_SETTINGS.audio.volume);
    assert.equal(a.muted, DEFAULT_PLAYER_SETTINGS.audio.muted);
  });
  await check("the motto: the event's at first, one clean line of 80 characters at most, empty for none", () => {
    assert.equal(sanitizeKioskConfig({}).motto, "Sfida il cronometro! Sei tu il più veloce?");
    assert.equal(sanitizeKioskConfig({ motto: 42 }).motto, DEFAULT_KIOSK_CONFIG.motto);
    assert.equal(sanitizeKioskConfig({ motto: "  Vai\n<b>forte</b>\u0007!  " }).motto, "Vai bforte/b !");
    assert.equal(sanitizeKioskConfig({ motto: "x".repeat(200) }).motto.length, 80);
    assert.equal(sanitizeKioskConfig({ motto: "   " }).motto, "");
  });

  console.log("Server (kiosk/server.mjs)");
  const dataDir = mkdtempSync(join(tmpdir(), "kiosk-verify-"));
  // A served build of its own: one built-in logo's picture made, the others not
  const staticDir = mkdtempSync(join(tmpdir(), "kiosk-verify-static-"));
  mkdirSync(join(staticDir, "kiosk", "brand"), { recursive: true });
  writeFileSync(join(staticDir, "kiosk", "brand", "huawei-logo.png"), "not drawn by this test");
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const startServer = (atPort: number) =>
    spawn(process.execPath, [join(__dirname, "../kiosk/server.mjs")], {
      // KIOSK_BRAND=0: no logo downloads from a test (the brand pictures have their own check below)
      env: {
        ...process.env,
        PORT: String(atPort),
        KIOSK_HOST: "127.0.0.1",
        KIOSK_DATA_DIR: dataDir,
        KIOSK_STATIC_DIR: staticDir,
        KIOSK_ADMIN_PIN: "9876",
        KIOSK_BRAND: "0",
        KIOSK_PUBLIC_URL: "http://192.168.50.5:8787/",
        NODE_OPTIONS: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  const waitFor = async (at: string) => {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${at}/api/kiosk/health`)).ok) return;
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const server = startServer(port);
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(base);
    const api = (path: string, init: RequestInit = {}, pin?: string) =>
      fetch(`${base}/api/kiosk${path}`, { ...init, headers: { "Content-Type": "application/json", ...(pin ? { "X-Kiosk-Pin": pin } : {}) } });
    const post = (body: object) => api("/results", { method: "POST", body: JSON.stringify(body) });
    const session = (clientId: string, name: string, lapTimes: [number, boolean][], extra: object = {}) => ({
      clientId,
      name,
      trackId: "rwanda_official_short",
      carId: "lc26",
      limitMode: "laps",
      limitLaps: 2,
      limitMinutes: 10,
      invalidLaps: "penalty",
      penaltyS: 5,
      laps: lapTimes.map(([lapMs, valid]) => ({ lapMs, valid })),
      finished: true,
      drivenMs: 200_000,
      ...extra,
    });

    await check("config: anyone reads it, only the PIN writes it; the event's defaults at first", async () => {
      const first = await api("/config");
      assert.equal(first.status, 200);
      const initial = await first.json();
      assert.deepEqual([initial.trackId, initial.carId, initial.device, initial.graphics], ["monza", "lc26", "controller", "medium"]);
      assert.equal((await api("/config", { method: "PUT", body: JSON.stringify({ laps: 2 }) })).status, 401);
      assert.equal((await api("/config", { method: "PUT", body: JSON.stringify({ laps: 2 }) }, "1111")).status, 401);
      // The boards below are on RISE's short layout in the 2026 prototype, sent by its old id ("vf26", now "lc26")
      const saved = await (
        await api("/config", { method: "PUT", body: JSON.stringify({ limitMode: "laps", laps: 2, trackId: "rwanda_official_short", carId: "vf26" }) }, "9876")
      ).json();
      assert.equal(saved.carId, "lc26", "the 2026 Prototype's old id is read as its new one");
      assert.equal(saved.limitMode, "laps");
      assert.equal(saved.laps, 2);
      assert.ok(saved.updatedAt);
      // A partial update leaves the other fields as they were
      const merged = await (await api("/config", { method: "PUT", body: JSON.stringify({ maxMinutes: 4 }) }, "9876")).json();
      assert.equal(merged.limitMode, "laps");
      assert.equal(merged.laps, 2);
      assert.equal(merged.maxMinutes, 4);
      // The motto: the event's at first, kept as one clean line (the server's copy of the rule)
      assert.equal(initial.motto, "Sfida il cronometro! Sei tu il più veloce?");
      const motto = await (await api("/config", { method: "PUT", body: JSON.stringify({ motto: " Chi è <i>il più</i>\tveloce? " }) }, "9876")).json();
      assert.equal(motto.motto, "Chi è iil più/i veloce?");
      assert.equal(motto.laps, 2, "the motto alone changes nothing else");
      // Tilt steering: off at first, kept as sent, in range (the server's copy of the rule)
      assert.deepEqual([initial.gyroSteer, initial.gyroLockDeg, initial.gyroSensitivity], [false, 45, 0.85]);
      const gyro = await (await api("/config", { method: "PUT", body: JSON.stringify({ gyroSteer: true, gyroLockDeg: 5, gyroSensitivity: 2 }) }, "9876")).json();
      assert.deepEqual([gyro.gyroSteer, gyro.gyroLockDeg, gyro.gyroSensitivity], [true, 10, 1.5]);
      await api("/config", { method: "PUT", body: JSON.stringify({ gyroSteer: false, gyroLockDeg: 45, gyroSensitivity: 0.85 }) }, "9876");
    });
    await check("results: ranked by total time in a laps session, best per driver, retries stored once", async () => {
      assert.equal((await post(session("c1", "Anna", [[100_000, true], [100_000, true]]))).status, 200);
      const second = await (await post(session("c2", "Bruno", [[99_000, true], [99_000, false]]))).json();
      // 99 + 99 + 5 = 203 s against Anna's 200 s
      assert.equal(second.rank, 2);
      const retry = await (await post(session("c2", "Bruno", [[50_000, true], [50_000, true]]))).json();
      assert.equal(retry.result.totalTimeMs, 203_000, "a retried post answers with the stored result");
      await post(session("c3", "anna", [[98_000, true], [98_000, true]]));
      const board = await (await api("/leaderboard")).json();
      assert.equal(board.mode, "total");
      assert.deepEqual(
        board.rows.map((r: { name: string; totalTimeMs: number }) => [r.name, r.totalTimeMs]),
        [
          ["anna", 196_000],
          ["Bruno", 203_000],
        ]
      );
      const all = await (await api("/leaderboard?unique=0")).json();
      assert.equal(all.rows.length, 3);
    });
    await check("best-lap ranking counts every session on the circuit; a session with no lap has no place", async () => {
      const none = await (await post(session("c4", "Carla", [], { limitMode: "time", finished: true }))).json();
      assert.equal(none.ok, true);
      assert.equal(none.rank, null);
      const best = await (await api("/leaderboard?mode=best")).json();
      assert.equal(best.rows[0].name, "anna");
      assert.equal(best.rows[0].bestLapMs, 98_000);
      assert.equal(best.rows.some((r: { name: string }) => r.name === "Carla"), false);
    });
    await check("each car has its own board; an unknown car (the SF-26 too) in the config falls back to the default", async () => {
      // A result an earlier version posted for the SF-26 stays on its own board, off the 2026 Prototype's
      await post(session("c7", "Fede", [[90_000, true], [90_000, true]], { carId: "sf26" }));
      // A result sent with the 2026 Prototype's old id ("vf26") is stored and ranked as the "lc26"
      const legacy = await (await post(session("c7b", "Ivo", [[91_000, true], [91_000, true]], { carId: "vf26" }))).json();
      assert.equal(legacy.result.carId, "lc26");
      const lc26 = await (await api("/leaderboard?mode=best")).json();
      assert.equal(lc26.carId, "lc26");
      assert.equal(lc26.rows.some((r: { name: string }) => r.name === "Fede"), false, "an SF-26 lap on the default car's board");
      assert.equal(lc26.rows.some((r: { name: string }) => r.name === "Ivo"), true, "a vf26 result on the lc26 board");
      const byOldId = await (await api("/leaderboard?mode=best&car=vf26")).json();
      assert.equal(byOldId.carId, "lc26", "the board asked for by the old id is the lc26's");
      const sf26 = await (await api("/leaderboard?mode=best&car=sf26")).json();
      assert.deepEqual(sf26.rows.map((r: { name: string }) => r.name), ["Fede"]);
      const cfg = await (await api("/config", { method: "PUT", body: JSON.stringify({ carId: "f2004", trackId: "monza" }) }, "9876")).json();
      assert.equal(cfg.carId, "lc26");
      assert.equal(cfg.trackId, "monza");
      const noFerrari = await (await api("/config", { method: "PUT", body: JSON.stringify({ carId: "sf26" }) }, "9876")).json();
      assert.equal(noFerrari.carId, "lc26", "the SF-26 can't be set any more");
      await api("/config", { method: "PUT", body: JSON.stringify({ trackId: "rwanda_official_short", carId: "lc26" }) }, "9876");
    });
    await check("the player's level is kept with the result and shown on the board", async () => {
      const easy = await (await post(session("c8", "Gino", [[95_000, true], [95_000, true]], { difficulty: "semi_pro" }))).json();
      assert.equal(easy.result.difficulty, "semi_pro");
      const odd = await (await post(session("c9", "Ugo", [[97_000, true], [97_000, true]], { difficulty: "expert" }))).json();
      assert.equal(odd.result.difficulty, null, "an unknown level is not stored");
      const board = await (await api("/leaderboard")).json();
      const row = board.rows.find((r: { name: string }) => r.name === "Gino");
      assert.equal(row?.difficulty, "semi_pro");
      assert.equal(board.rows.find((r: { name: string }) => r.name === "Ugo")?.difficulty, null);
    });
    await check("the leaderboard's addresses on the network", async () => {
      const net = await (await api("/network")).json();
      assert.equal(net.port, port);
      assert.equal(net.urls[0].url, "http://192.168.50.5:8787", "KIOSK_PUBLIC_URL first, without its trailing slash");
      assert.equal(net.paths.leaderboardPage, "/kiosk/classifica");
      assert.equal(net.paths.leaderboardApi, "/api/kiosk/leaderboard");
      // Listening on 127.0.0.1 only: no LAN address to offer
      assert.equal(net.urls.length, 1);
    });
    await check("bad posts are refused", async () => {
      assert.equal((await post({ ...session("c5", "", [[100_000, true]]) })).status, 400);
      assert.equal((await post({ ...session("c6", "Dario", [[1_000, true]]) })).status, 400);
      assert.equal((await api("/results", { method: "POST", body: "{" })).status, 400);
    });
    await check("admin: list, CSV, delete one, reset with a backup", async () => {
      assert.equal((await api("/results")).status, 401);
      const { results } = await (await api("/results", {}, "9876")).json();
      // Seven sessions above, and Ivo's sent with the old "vf26"
      assert.equal(results.length, 8);
      const csv = await (await api("/results.csv", {}, "9876")).text();
      assert.match(csv, /miglior_giro/);
      assert.match(csv, /,difficolta,/);
      assert.match(csv, /,medio,/);
      assert.equal(csv.trim().split("\n").length, 9);
      assert.equal(/,vf26,/.test(csv), false, "the CSV names the 2026 Prototype by its new id");
      assert.equal((await api(`/results/${results[0].id}`, { method: "DELETE" }, "9876")).status, 200);
      const reset = await (await api("/results", { method: "DELETE" }, "9876")).json();
      assert.ok(reset.backup);
      assert.equal((await (await api("/results", {}, "9876")).json()).results.length, 0);
    });
    await check("the game's online side reads as off; other API paths are a quick 404", async () => {
      const online = await (await fetch(`${base}/api/config`)).json();
      assert.equal(online.board, false);
      assert.equal((await fetch(`${base}/api/usage`, { method: "POST" })).status, 404);
    });

    // ---- Logos (kiosk/logos.mjs): the built-in three, shown or hidden, and the staff's uploads
    type Logo = { id: string; name: string; builtin: boolean; enabled: boolean; ground: string; boxed: boolean; groundMode: string; logo: string | null; banner: string | null };
    const logoList = async (at = base): Promise<Logo[]> => (await (await fetch(`${at}/api/kiosk/logos`)).json()).logos;
    const putLogos = (body: object, pin = "9876") => api("/logos", { method: "PUT", body: JSON.stringify(body) }, pin);
    const upload = (bytes: Buffer | string, name: string, pin: string | null = "9876") =>
      fetch(`${base}/api/kiosk/logos?name=${encodeURIComponent(name)}`, {
        method: "POST",
        body: typeof bytes === "string" ? bytes : new Uint8Array(bytes),
        headers: { "Content-Type": "application/octet-stream", ...(pin ? { "X-Kiosk-Pin": pin } : {}) },
      });
    const pngSize = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];
    const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const sharp = (await import("sharp")).default;
    // A blue badge on a transparent ground, a green disc on a white JPEG, and an SVG with a script in it
    const badge = await sharp({ create: { width: 600, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect x="100" y="90" width="400" height="120" rx="20" fill="#1565C0"/></svg>') }])
      .png()
      .toBuffer();
    const disc = await sharp({ create: { width: 500, height: 400, channels: 3, background: "#ffffff" } })
      .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400"><circle cx="250" cy="200" r="120" fill="#2E7D32"/></svg>') }])
      .jpeg()
      .toBuffer();
    const scripted = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100" onload="alert(1)"><script>alert(2)</script><rect x="50" y="20" width="300" height="60" fill="#C00"/></svg>';
    let badgeId = "";

    await check("logos: the three built-in ones, hidden, at first; a picture only where the server has made it", async () => {
      const logos = await logoList();
      assert.deepEqual(logos.map((l) => [l.id, l.enabled, l.builtin]), [["huawei", false, true], ["mgw", false, true], ["windtre", false, true]]);
      assert.match(logos[0].logo ?? "", /^\/kiosk\/brand\/huawei-logo\.png\?v=/);
      assert.equal(logos[1].logo, null, "no picture made: the game draws its name");
      assert.equal(logos[2].banner, null);
    });
    await check("logos: only the PIN changes them; hiding one leaves the order, the order changes on its own", async () => {
      assert.equal((await putLogos({ logos: [{ id: "mgw", enabled: false }] }, "1111")).status, 401);
      const refused = await upload(badge, "X", null);
      assert.equal(refused.status, 401);
      assert.equal((await fetch(`${base}/api/kiosk/logos/huawei`, { method: "DELETE" })).status, 401);
      // The staff turn the brands on (they start hidden), then hide one
      const on = (await (await putLogos({ logos: ["huawei", "mgw", "windtre"].map((id) => ({ id, enabled: true })) })).json()).logos as Logo[];
      assert.deepEqual(on.map((l) => [l.id, l.enabled]), [["huawei", true], ["mgw", true], ["windtre", true]]);
      const hidden = (await (await putLogos({ logos: [{ id: "mgw", enabled: false }] })).json()).logos as Logo[];
      assert.deepEqual(hidden.map((l) => [l.id, l.enabled]), [["huawei", true], ["mgw", false], ["windtre", true]]);
      const moved = (await (await putLogos({ order: ["windtre", "huawei"] })).json()).logos as Logo[];
      assert.deepEqual(moved.map((l) => l.id), ["windtre", "huawei", "mgw"]);
      const builtinGround = (await (await putLogos({ logos: [{ id: "huawei", groundMode: "dark" }] })).json()).logos as Logo[];
      assert.equal(builtinGround.find((l) => l.id === "huawei")?.groundMode, "auto", "a built-in logo's pictures are its own");
    });
    await check("an uploaded logo is drawn at once: its picture and its 1024 × 128 board, served as PNG only", async () => {
      const res = await upload(badge, "Partner  X");
      assert.equal(res.status, 201);
      const body = await res.json();
      assert.equal(body.logo.name, "Partner X");
      assert.deepEqual([body.logo.builtin, body.logo.enabled, body.logo.boxed, body.logo.ground], [false, true, false, "light"]);
      badgeId = body.logo.id;
      assert.deepEqual((body.logos as Logo[]).map((l) => l.id), ["windtre", "huawei", "mgw", badgeId], "a new logo goes last");
      const banner = await fetch(`${base}${body.logo.banner}`);
      assert.equal(banner.headers.get("content-type"), "image/png");
      assert.equal(banner.headers.get("x-content-type-options"), "nosniff");
      const bannerPng = Buffer.from(await banner.arrayBuffer());
      assert.deepEqual(pngSize(bannerPng), [1024, 128]);
      const logoPng = Buffer.from(await (await fetch(`${base}${body.logo.logo}`)).arrayBuffer());
      const [w, h] = pngSize(logoPng);
      assert.ok(Math.abs(w / h - 400 / 120) < 0.1, `the picture is cropped to the logo (${w} × ${h})`);
      const boxed = await (await upload(disc, "Disco")).json();
      assert.equal(boxed.logo.boxed, true, "a JPEG keeps its own background");
      const svg = await (await upload(Buffer.from(scripted), "Svg")).json();
      const svgPicture = Buffer.from(await (await fetch(`${base}${svg.logo.logo}`)).arrayBuffer());
      assert.ok(svgPicture.subarray(0, 4).equals(PNG_HEAD), "an SVG is served drawn, as a PNG");
      assert.equal((await fetch(`${base}/api/kiosk/logos/${svg.logo.id}/src.svg`)).status, 404, "the uploaded file itself is never served");
    });
    await check("uploads that are no picture, empty, all transparent or too big are refused", async () => {
      assert.equal((await upload("<!doctype html><html><body>hi</body></html>", "Page")).status, 415);
      assert.equal((await upload(Buffer.alloc(0), "Empty")).status, 400);
      const clear = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
      assert.equal((await upload(clear, "Clear")).status, 422);
      const plain = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#ffffff" } }).png().toBuffer();
      assert.equal((await upload(plain, "Plain")).status, 422, "a picture of one colour holds no logo");
      assert.equal((await upload(Buffer.alloc(10 * 1024 * 1024 + 1, 1), "Huge")).status, 413);
      assert.equal((await logoList()).length, 6, "nothing refused was added");
    });
    await check("an SVG with a print-size artboard is drawn; pictures inside an SVG count against the size limit", async () => {
      const poster = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 20000 5000"><rect x="1000" y="1000" width="18000" height="3000" fill="#C00"/></svg>';
      const res = await upload(Buffer.from(poster), "Poster");
      assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
      const id = (await res.json()).logo.id;
      assert.equal((await fetch(`${base}/api/kiosk/logos/${id}`, { method: "DELETE", headers: { "X-Kiosk-Pin": "9876" } })).status, 200);
      // Eight 9-megapixel pictures inside one small SVG: 72 megapixels decoded, over the 64 allowed
      const tile = (await sharp({ create: { width: 3000, height: 3000, channels: 3, background: "#2244aa" } }).png().toBuffer()).toString("base64");
      const images = Array.from({ length: 8 }, (_, i) => `<image x="${i * 10}" width="10" height="10" href="data:image/png;base64,${tile}"/>`).join("");
      const heavy = await upload(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 10">${images}</svg>`), "Heavy");
      assert.equal(heavy.status, 413);
      assert.match((await heavy.json()).error, /megapixel/);
      // The same pictures with their payload's first letter as a character reference (librsvg reads it the same)
      const masked = Array.from({ length: 8 }, (_, i) => `<image x="${i * 10}" width="10" height="10" href="data:image/png;base64,&#x${tile.charCodeAt(0).toString(16)};${tile.slice(1)}"/>`).join("");
      assert.equal((await upload(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 10">${masked}</svg>`), "Masked")).status, 413);
      // A picture behind an entity (it could be drawn as many times as the entity is used): refused, however small
      const dot = (await sharp({ create: { width: 30, height: 30, channels: 3, background: "#2244aa" } }).png().toBuffer()).toString("base64");
      const viaEntity = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY pic "data:image/png;base64,${dot}">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image width="10" height="10" href="&pic;"/></svg>`;
      assert.equal((await upload(Buffer.from(viaEntity), "Entity")).status, 422);
      // Thousands of empty addresses: refused at once, not looked at one by one with the server held
      const t0 = Date.now();
      const swarm = await upload(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/><desc>${'data:,"'.repeat(50_000)}</desc></svg>`), "Swarm");
      assert.equal(swarm.status, 422);
      assert.ok(Date.now() - t0 < 3000, `${Date.now() - t0} ms for 50,000 empty addresses`);
      // A long thin strip (an artboard of 4000 × 40) is drawn, not refused as too big
      const strip = await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="40"><rect x="10" y="5" width="3980" height="30" fill="#063"/></svg>'), "Strip");
      assert.equal(strip.status, 201, JSON.stringify(await strip.clone().json()));
      assert.equal((await fetch(`${base}/api/kiosk/logos/${(await strip.json()).logo.id}`, { method: "DELETE", headers: { "X-Kiosk-Pin": "9876" } })).status, 200);
    });
    await check("scripts are taken out of an SVG in linear time (an upload of unclosed tags can't hold the server)", async () => {
      const { cleanSvg } = (await import(pathToFileURL(join(__dirname, "../kiosk/brand.mjs")).href)) as { cleanSvg: (t: string) => string };
      assert.equal(cleanSvg('<svg><script type="x">a()</script ><rect onclick="b()"/></svg>'), "<svg><rect/></svg>");
      assert.equal(cleanSvg('<svg><script xlink:href="m.js"/><rect/></svg>'), "<svg><rect/></svg>", "a self-closing script goes alone");
      assert.equal(cleanSvg("<svg><!-- no <script> here --><rect/></svg>"), "<svg><!-- no <script> here --><rect/></svg>", "a comment stays whole");
      assert.equal(cleanSvg("<svg><script/><rect/><script>x()</script><circle/></svg>"), "<svg><rect/><circle/></svg>");
      assert.equal(cleanSvg("<svg><rect/><script>never"), "<svg><rect/><script>never", "an unclosed script leaves the file as it is");
      for (const unit of ["<script ", "<script/>", "<!--"]) {
        const t0 = Date.now();
        cleanSvg(`<svg xmlns="http://www.w3.org/2000/svg">${unit.repeat(200_000)}`);
        assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms for 200,000 × ${unit}`);
      }
      // The look for pictures inside an SVG reads each entity declaration once
      const { embeddedPixels } = (await import(pathToFileURL(join(__dirname, "../kiosk/brand.mjs")).href)) as { embeddedPixels: (s: unknown, t: string) => Promise<number> };
      const sharpLib = (await import("sharp")).default;
      for (const unit of ["<!ENTITY ", '<!ENTITY a "']) {
        const t0 = Date.now();
        await embeddedPixels(sharpLib, `<svg>${unit.repeat(200_000)}`);
        assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms for 200,000 × ${unit}`);
      }
    });
    await check("an upload's board takes the ground chosen; built-in logos can't be deleted, uploads can", async () => {
      const before = (await logoList()).find((l) => l.id === badgeId);
      const dark = ((await (await putLogos({ logos: [{ id: badgeId, groundMode: "dark" }] })).json()).logos as Logo[]).find((l) => l.id === badgeId);
      assert.equal(dark?.groundMode, "dark");
      assert.equal(dark?.ground, "dark");
      assert.notEqual(dark?.banner, before?.banner, "a new board, at a new address");
      assert.equal((await fetch(`${base}/api/kiosk/logos/huawei`, { method: "DELETE", headers: { "X-Kiosk-Pin": "9876" } })).status, 400);
      const disc = (await logoList()).find((l) => l.name === "Disco");
      const gone = await fetch(`${base}/api/kiosk/logos/${disc?.id}`, { method: "DELETE", headers: { "X-Kiosk-Pin": "9876" } });
      assert.equal(gone.status, 200);
      assert.equal(((await gone.json()).logos as Logo[]).some((l) => l.id === disc?.id), false);
      assert.equal((await fetch(`${base}${disc?.banner}`)).status, 404);
    });
    await check("logos outlast a restart: the list, the order, the uploads; a lost picture is drawn again, a lost file drops its logo", async () => {
      const lost = (await (await upload(badge, "Lost")).json()).logo as Logo;
      const before = await logoList();
      // One upload's board picture goes, another upload's own file goes
      rmSync(join(dataDir, "logos", `${badgeId}-banner.png`));
      rmSync(join(dataDir, "logos", `${lost.id}-src.png`));
      const again = startServer(port + 2);
      const at = `http://127.0.0.1:${port + 2}`;
      try {
        await waitFor(at);
        const after = await logoList(at);
        assert.deepEqual(after, before.filter((l) => l.id !== lost.id));
        const badgeAfter = after.find((l) => l.id === badgeId);
        const redrawn = await fetch(`${at}${badgeAfter?.banner}`);
        assert.equal(redrawn.status, 200, "the lost board picture is drawn again at start");
        assert.deepEqual(pngSize(Buffer.from(await redrawn.arrayBuffer())), [1024, 128]);
        assert.equal((await fetch(`${at}${lost.banner}`)).status, 404);
      } finally {
        again.kill();
      }
    });
  } finally {
    server.kill();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(staticDir, { recursive: true, force: true });
  }

  await check("a config saved by an earlier version takes up Monza and the 2026 Prototype once, keeping the rest", async () => {
    const oldDir = mkdtempSync(join(tmpdir(), "kiosk-verify-old-"));
    writeFileSync(join(oldDir, "config.json"), JSON.stringify({ limitMode: "laps", laps: 4, trackId: "rwanda_official_short", carId: "vf26" }));
    const oldPort = port + 1;
    const old = spawn(process.execPath, [join(__dirname, "../kiosk/server.mjs")], {
      env: { ...process.env, PORT: String(oldPort), KIOSK_HOST: "127.0.0.1", KIOSK_DATA_DIR: oldDir, KIOSK_BRAND: "0", NODE_OPTIONS: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      let cfg: { trackId?: string; carId?: string; laps?: number; limitMode?: string } | null = null;
      for (let i = 0; i < 50 && !cfg; i++) {
        try {
          cfg = await (await fetch(`http://127.0.0.1:${oldPort}/api/kiosk/config`)).json();
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      assert.deepEqual([cfg?.trackId, cfg?.carId, cfg?.limitMode, cfg?.laps], ["monza", "lc26", "laps", 4]);
    } finally {
      old.kill();
      rmSync(oldDir, { recursive: true, force: true });
    }
  });

  console.log("Brand pictures (kiosk/brand.mjs)");
  {
    type BrandResult = { made: string[]; upToDate: string[]; removed: string[]; failed: string[]; skipped?: string };
    const brandUrl = pathToFileURL(join(__dirname, "../kiosk/brand.mjs")).href;
    const { ensureBrandAssets } = (await import(brandUrl)) as { ensureBrandAssets: (o: object) => Promise<BrandResult> };
    const quiet = { warn: () => {}, log: () => {} };
    const ALL = ["banner-huawei.png", "banner-mgw.png", "banner-windtre.png", "huawei-logo.png", "mgw-logo.png", "windtre-logo.png"];
    const bar = (fill: string, width = 600) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 100"><rect x="0" y="10" width="${width}" height="80" fill="${fill}"/></svg>`;
    const setup = () => {
      const tmp = mkdtempSync(join(tmpdir(), "kiosk-brand-"));
      const brandDir = join(tmp, "brand");
      const outDir = join(tmp, "out", "kiosk", "brand");
      mkdirSync(brandDir, { recursive: true });
      mkdirSync(join(tmp, "out", "kiosk"), { recursive: true });
      return { tmp, brandDir, outDir, cacheDir: join(tmp, "cache"), log: quiet };
    };
    const hashOf = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
    const noDownloads = { KIOSK_SPONSOR_LOGO_URL: "", KIOSK_EVENT_LOGO_URL: "", KIOSK_WINDTRE_LOGO_URL: "" };
    // WINDTRE's logo: an orange mark beside grey text
    const twoColours = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect x="0" y="0" width="200" height="200" fill="#FF6B00"/><rect x="200" y="0" width="200" height="200" fill="#9C9B9B"/></svg>';
    const withEnv = async <T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> => {
      const before = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
      Object.assign(process.env, env);
      try {
        return await fn();
      } finally {
        for (const [k, v] of Object.entries(before)) if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    };

    await check("made from local logos at the game's sizes; a restart leaves them alone", async () => {
      const o = setup();
      try {
        writeFileSync(join(o.brandDir, "sponsor-logo.svg"), bar("#000"));
        // An illustration program's file: a DOCTYPE with entities the drawing depends on, its root past byte 512
        const entities = Array.from({ length: 8 }, (_, i) => `<!ENTITY st${i} "fill:#fff">`).join("\n");
        writeFileSync(join(o.brandDir, "event-logo.svg"), `<?xml version="1.0"?>\n<!DOCTYPE svg [\n${entities}\n${" ".repeat(400)}]>\n<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 4500 2392"><script>x()</script><path d="M0 0H4500V2392Z" style="&st1;"/></svg>`);
        writeFileSync(join(o.brandDir, "windtre.svg"), twoColours);
        const first = await withEnv(noDownloads, () => ensureBrandAssets(o));
        assert.deepEqual(first.made.sort(), ALL, JSON.stringify(first));
        const size = (name: string) => {
          const png = readFileSync(join(o.outDir, name));
          return [png.readUInt32BE(16), png.readUInt32BE(20)];
        };
        for (const banner of ["banner-huawei.png", "banner-mgw.png", "banner-windtre.png"]) assert.deepEqual(size(banner), [1024, 128], banner);
        // WINDTRE on the dark screens: its orange kept, its grey text turned white
        const sharp = (await import("sharp")).default;
        const { data, info } = await sharp(readFileSync(join(o.outDir, "windtre-logo.png"))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const pixel = (x: number) => Array.from(data.subarray((Math.round(info.height / 2) * info.width + x) * 4, (Math.round(info.height / 2) * info.width + x) * 4 + 3));
        assert.deepEqual(pixel(20), [255, 107, 0], "orange kept");
        assert.deepEqual(pixel(info.width - 20), [255, 255, 255], "grey turned white");
        const second = await withEnv(noDownloads, () => ensureBrandAssets(o));
        assert.deepEqual([second.made, second.upToDate.sort()], [[], ALL]);
      } finally {
        rmSync(o.tmp, { recursive: true, force: true });
      }
    });

    await check("a swapped logo (even one with an older date) and changed event texts are drawn again", async () => {
      const o = setup();
      try {
        writeFileSync(join(o.brandDir, "sponsor-logo.svg"), bar("#000"));
        writeFileSync(join(o.brandDir, "event-logo.svg"), bar("#fff"));
        await withEnv(noDownloads, () => ensureBrandAssets(o));
        const before = hashOf(join(o.outDir, "banner-huawei.png"));
        writeFileSync(join(o.brandDir, "sponsor-logo.svg"), bar("#000", 300));
        utimesSync(join(o.brandDir, "sponsor-logo.svg"), new Date(2020, 0, 1), new Date(2020, 0, 1));
        const swapped = await withEnv(noDownloads, () => ensureBrandAssets(o));
        assert.ok(swapped.made.includes("banner-huawei.png"), JSON.stringify(swapped));
        assert.notEqual(hashOf(join(o.outDir, "banner-huawei.png")), before);
        const mgw = hashOf(join(o.outDir, "banner-mgw.png"));
        const retext = await withEnv({ ...noDownloads, KIOSK_EVENT_DATES: "1–3 DICEMBRE 2026" }, () => ensureBrandAssets(o));
        assert.ok(retext.made.includes("banner-mgw.png"), JSON.stringify(retext));
        assert.notEqual(hashOf(join(o.outDir, "banner-mgw.png")), mgw);
      } finally {
        rmSync(o.tmp, { recursive: true, force: true });
      }
    });

    await check("finished pictures are used without any source; pictures with nothing to come from are removed", async () => {
      const o = setup();
      try {
        writeFileSync(join(o.brandDir, "sponsor-logo.svg"), bar("#000"));
        await withEnv(noDownloads, () => ensureBrandAssets(o));
        assert.ok(existsSync(join(o.outDir, "banner-huawei.png")));
        const finished = readFileSync(join(o.outDir, "banner-huawei.png"));
        rmSync(join(o.brandDir, "sponsor-logo.svg"));
        writeFileSync(join(o.brandDir, "banner-mgw.png"), finished);
        const res = await withEnv(noDownloads, () => ensureBrandAssets(o));
        assert.deepEqual(res.made, ["banner-mgw.png (kiosk/brand)"], JSON.stringify(res));
        assert.deepEqual(res.removed.sort(), ["banner-huawei.png", "huawei-logo.png"]);
        assert.equal(hashOf(join(o.outDir, "banner-mgw.png")), createHash("sha256").update(finished).digest("hex"));
      } finally {
        rmSync(o.tmp, { recursive: true, force: true });
      }
    });

    await check("uploaded pictures: no ground blended from logo and edge; grounds chosen for contrast", async () => {
      const sharp = (await import("sharp")).default;
      type Drawn = { logo: Buffer; banner: Buffer; boxed: boolean; ground: string; background: string | null };
      const { drawUploadedLogo } = (await import(brandUrl)) as { drawUploadedLogo: (s: unknown, raw: Buffer, o?: object) => Promise<Drawn> };
      const px = async (png: Buffer, x: number, y: number) => {
        const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const i = (Math.min(y, info.height - 1) * info.width + Math.min(x, info.width - 1)) * 4;
        return Array.from(data.subarray(i, i + 4));
      };
      const grey = ([r, g, b]: number[]) => Math.max(r, g, b) - Math.min(r, g, b) < 12 && r > 40 && r < 215;
      // Black letters on white, cut tight to them (they touch the edges), as a JPEG
      const letters = await sharp({ create: { width: 1400, height: 400, channels: 3, background: "#ffffff" } })
        .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="400"><text x="40" y="300" font-family="sans-serif" font-weight="900" font-size="260">HUMMEL</text></svg>') }])
        .png()
        .toBuffer();
      const tight = await sharp(await sharp(letters).trim().toBuffer()).jpeg().toBuffer();
      const t = await drawUploadedLogo(sharp, tight);
      assert.equal(t.boxed, true);
      assert.ok(!grey(await px(t.banner, 40, 4)), `the board isn't a blend of ink and paper (${await px(t.banner, 40, 4)})`);
      assert.ok(!grey(await px(t.logo, 1, 1)), `nor the screens' frame (${await px(t.logo, 1, 1)})`);
      // A red badge with rounded corners and white text: its red frames it, with no see-through notches
      const badge = await sharp({ create: { width: 800, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300"><rect width="800" height="300" rx="24" fill="#D40000"/><text x="400" y="190" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="120" fill="#fff">MEDIA</text></svg>') }])
        .png()
        .toBuffer();
      const b = await drawUploadedLogo(sharp, badge);
      assert.equal(b.background?.toUpperCase(), "#D40000");
      const corner = await px(b.logo, 0, 0);
      const { data: logoPixels } = await sharp(b.logo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let seeThrough = 0;
      for (let i = 3; i < logoPixels.length; i += 4) if (logoPixels[i] < 250) seeThrough++;
      assert.equal(seeThrough, 0, "no see-through pixel on the screens' picture (the badge's round corners left out)");
      assert.ok(corner[0] > 200 && corner[1] < 30, `the badge's red around it (${corner})`);
      // A blue mark beside white letters, on transparency: a dark board, so the letters show
      const negative = await sharp({ create: { width: 900, height: 240, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="240"><rect x="20" y="20" width="200" height="200" rx="30" fill="#0D47A1"/><text x="260" y="170" font-family="sans-serif" font-weight="900" font-size="150" fill="#fff">BRAND</text></svg>') }])
        .png()
        .toBuffer();
      const n = await drawUploadedLogo(sharp, negative);
      assert.equal(n.ground, "dark");
      const fill = await px(n.banner, 60, 4);
      assert.ok(fill[0] < 30 && fill[1] < 30 && fill[2] < 30, `a dark board (${fill})`);
    });

    await check("the combined banner of earlier versions is taken out of the served folder", async () => {
      const o = setup();
      try {
        mkdirSync(o.outDir, { recursive: true });
        writeFileSync(join(o.outDir, "banner-combo.png"), "an old picture");
        const res = await withEnv(noDownloads, () => ensureBrandAssets(o));
        assert.ok(res.removed.includes("banner-combo.png"), JSON.stringify(res));
        assert.equal(existsSync(join(o.outDir, "banner-combo.png")), false);
      } finally {
        rmSync(o.tmp, { recursive: true, force: true });
      }
    });

    await check("downloads: cached per address and checked; a web page is refused; a silent server is given up on in time", async () => {
      const o = setup();
      const served: Record<string, string> = { "/a.svg": bar("#000"), "/b.svg": bar("#000", 250), "/page": "<!doctype html><html><body><svg></svg></body></html>" };
      const hits: string[] = [];
      const http = await import("node:http");
      const srv = http.createServer((req, res) => {
        hits.push(req.url ?? "");
        if (req.url === "/stall") return; // never answers
        const body = served[req.url ?? ""];
        if (!body) return void res.writeHead(404).end();
        res.writeHead(200, { "Content-Type": req.url === "/page" ? "text/html" : "image/svg+xml" }).end(body);
      });
      await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
      const at = (p: string) => `http://127.0.0.1:${(srv.address() as { port: number }).port}${p}`;
      try {
        const a = await withEnv({ KIOSK_SPONSOR_LOGO_URL: at("/a.svg"), KIOSK_EVENT_LOGO_URL: "", KIOSK_WINDTRE_LOGO_URL: "" }, () => ensureBrandAssets(o));
        assert.ok(a.made.includes("banner-huawei.png"), JSON.stringify(a));
        const fromA = hashOf(join(o.outDir, "banner-huawei.png"));
        const b = await withEnv({ KIOSK_SPONSOR_LOGO_URL: at("/b.svg"), KIOSK_EVENT_LOGO_URL: "", KIOSK_WINDTRE_LOGO_URL: "" }, () => ensureBrandAssets(o));
        assert.ok(b.made.includes("banner-huawei.png") && hits.includes("/b.svg"), JSON.stringify(b));
        assert.notEqual(hashOf(join(o.outDir, "banner-huawei.png")), fromA, "a new address is downloaded and drawn");
        const page = await withEnv({ KIOSK_SPONSOR_LOGO_URL: at("/page"), KIOSK_EVENT_LOGO_URL: "", KIOSK_WINDTRE_LOGO_URL: "" }, () => ensureBrandAssets(o));
        assert.equal(page.made.length, 0, JSON.stringify(page));
        const pagesBefore = hits.filter((h) => h === "/page").length;
        await withEnv({ KIOSK_SPONSOR_LOGO_URL: at("/page"), KIOSK_EVENT_LOGO_URL: "", KIOSK_WINDTRE_LOGO_URL: "" }, () => ensureBrandAssets(o));
        assert.equal(hits.filter((h) => h === "/page").length, pagesBefore, "a failed address is not asked again at once");
        const t0 = Date.now();
        await withEnv({ KIOSK_SPONSOR_LOGO_URL: at("/stall"), KIOSK_EVENT_LOGO_URL: "", KIOSK_WINDTRE_LOGO_URL: "", KIOSK_BRAND_TIMEOUT_MS: "1500" }, () => ensureBrandAssets(o));
        assert.ok(Date.now() - t0 < 6000, `silent server held it ${Date.now() - t0} ms`);
      } finally {
        srv.closeAllConnections?.();
        srv.close();
        rmSync(o.tmp, { recursive: true, force: true });
      }
    });
  }

  console.log("Logo list in the browser (src/lib/kiosk/kiosk-logos.ts)");
  {
    // A browser of sorts: window, storage and a fetch that answers as the test says (put back afterwards)
    const g = globalThis as unknown as Record<string, unknown>;
    const realFetch = globalThis.fetch;
    const stored = new Map<string, string>();
    const asked: string[] = [];
    let answer: () => Promise<Response> = async () => {
      throw new TypeError("fetch failed");
    };
    g.window = globalThis;
    g.localStorage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) };
    globalThis.fetch = (async (url: string) => {
      asked.push(String(url));
      return answer();
    }) as typeof fetch;
    const until = async (test: () => boolean, ms: number) => {
      for (const t0 = Date.now(); !test(); ) {
        if (Date.now() - t0 > ms) return false;
        await new Promise((r) => setTimeout(r, 20));
      }
      return true;
    };
    try {
      const store = await import("../src/lib/kiosk/kiosk-logos");
      const api = await import("../src/lib/kiosk/kiosk-api");
      await check("a mark that only follows the list never asks for it; nothing is shown until there is an answer", async () => {
        const stopFollowing = store.followLogos(() => {});
        await new Promise((r) => setTimeout(r, 100));
        assert.equal(asked.length, 0, "a passive follower asked for the list");
        assert.equal(store.getLogosSnapshot(), null);
        stopFollowing();
      });
      await check("a slow first answer is waited for (no built-in logos meanwhile), then the server's list is shown", async () => {
        let changes = 0;
        const stop = store.subscribeLogos(() => changes++);
        try {
          assert.ok(await until(() => asked.length >= 1, 2000), "not asked at once");
          await new Promise((r) => setTimeout(r, 200));
          assert.equal(store.getLogosSnapshot(), null, "the built-in logos stood in after one failed read");
          answer = async () =>
            new Response(JSON.stringify({ logos: [{ id: "windtre", name: "WINDTRE", builtin: true, enabled: true }, { id: "huawei", name: "HUAWEI", builtin: true, enabled: false }] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          assert.ok(await until(() => store.getLogosSnapshot() !== null, 4000), "the second try didn't come within a few seconds");
          assert.deepEqual(store.getLogosSnapshot()?.map((l) => [l.id, l.enabled]), [["windtre", true], ["huawei", false]]);
          assert.equal(changes, 1);
          assert.equal(store.challengeName(store.getLogosSnapshot()), "RACING CHALLENGE", "the sponsor's hidden: so is its name");
          assert.ok(stored.get("kiosk.logos.v1"), "the list is kept for a start without the server");
        } finally {
          stop();
        }
      });
      await check("a site with no kiosk server is told apart at once: the built-in logos (hidden) without waiting", async () => {
        answer = async () => new Response("<!doctype html><title>404</title>", { status: 404, headers: { "Content-Type": "text/html" } });
        await assert.rejects(api.kioskRequest("/logos"), (err: unknown) => err instanceof api.KioskApiError && err.status === 0 && err.httpStatus === 404);
        // A page just opened, with no list kept from an earlier visit
        store.resetLogoStoreForTests();
        stored.clear();
        const stop = store.subscribeLogos(() => {});
        try {
          // Well before the 1.5 s a slow kiosk server is given
          assert.ok(await until(() => store.getLogosSnapshot() !== null, 800), "the built-in logos waited as for a slow server");
          assert.deepEqual(store.getLogosSnapshot()?.map((l) => [l.id, l.enabled]), [["huawei", false], ["mgw", false], ["windtre", false]]);
          assert.equal(store.challengeName(store.getLogosSnapshot()), "RACING CHALLENGE");
        } finally {
          stop();
          store.resetLogoStoreForTests();
        }
      });
    } finally {
      globalThis.fetch = realFetch;
      delete g.window;
      delete g.localStorage;
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} kiosk check(s) failed`);
    process.exit(1);
  }
  console.log("\nKiosk checks passed.");
}

void main();
