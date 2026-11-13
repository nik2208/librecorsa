/**
 * Kiosk mode (event branch): the scoring rules, the config's ranges, and kiosk/server.mjs's API (config behind the
 * PIN, results, ranking, a retried post stored once, the CSV) on a throwaway data folder.
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
  await check("the SF-26 and Monza are listed only when NEXT_PUBLIC_EXTRA_CONTENT names them", async () => {
    const probe = (env: Record<string, string>) =>
      execFileSync(process.execPath, ["--import", "tsx", "-e", `const h = require(${JSON.stringify(join(__dirname, "../src/lib/hosted-content.ts"))}); console.log(JSON.stringify([h.carListed("sf26"), h.trackListed("monza"), h.carListed("vf26"), h.trackListed("rwanda_official_short")]))`], {
        env: { ...process.env, NEXT_PUBLIC_HOSTED_CONTENT: "", NEXT_PUBLIC_EXTRA_CONTENT: "", ...env },
        encoding: "utf8",
      }).trim();
    assert.equal(probe({}), "[false,false,true,true]", "default build");
    assert.equal(probe({ NEXT_PUBLIC_HOSTED_CONTENT: "1" }), "[false,false,true,true]", "hosted build without the flag");
    assert.equal(probe({ NEXT_PUBLIC_EXTRA_CONTENT: "sf26" }), "[true,false,true,true]", "only the SF-26 named");
    assert.equal(probe({ NEXT_PUBLIC_EXTRA_CONTENT: "sf26,monza,f2004" }), "[true,true,true,true]", "both named (unknown ids ignored)");
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
    assert.equal(c.difficulty, DEFAULT_KIOSK_CONFIG.difficulty);
    assert.equal(c.penaltyS, 7.5);
    assert.equal("extra" in c, false);
  });

  console.log("Server (kiosk/server.mjs)");
  const dataDir = mkdtempSync(join(tmpdir(), "kiosk-verify-"));
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const server = spawn(process.execPath, [join(__dirname, "../kiosk/server.mjs")], {
    // KIOSK_BRAND=0: no logo downloads from a test (the brand pictures have their own check below)
    env: { ...process.env, PORT: String(port), KIOSK_HOST: "127.0.0.1", KIOSK_DATA_DIR: dataDir, KIOSK_ADMIN_PIN: "9876", KIOSK_BRAND: "0", NODE_OPTIONS: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`${base}/api/kiosk/health`)).ok) break;
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const api = (path: string, init: RequestInit = {}, pin?: string) =>
      fetch(`${base}/api/kiosk${path}`, { ...init, headers: { "Content-Type": "application/json", ...(pin ? { "X-Kiosk-Pin": pin } : {}) } });
    const post = (body: object) => api("/results", { method: "POST", body: JSON.stringify(body) });
    const session = (clientId: string, name: string, lapTimes: [number, boolean][], extra: object = {}) => ({
      clientId,
      name,
      trackId: "rwanda_official_short",
      carId: "vf26",
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

    await check("config: anyone reads it, only the PIN writes it", async () => {
      assert.equal((await api("/config")).status, 200);
      assert.equal((await api("/config", { method: "PUT", body: JSON.stringify({ laps: 2 }) })).status, 401);
      assert.equal((await api("/config", { method: "PUT", body: JSON.stringify({ laps: 2 }) }, "1111")).status, 401);
      const saved = await (await api("/config", { method: "PUT", body: JSON.stringify({ limitMode: "laps", laps: 2 }) }, "9876")).json();
      assert.equal(saved.limitMode, "laps");
      assert.equal(saved.laps, 2);
      assert.ok(saved.updatedAt);
      // A partial update leaves the other fields as they were
      const merged = await (await api("/config", { method: "PUT", body: JSON.stringify({ maxMinutes: 4 }) }, "9876")).json();
      assert.equal(merged.limitMode, "laps");
      assert.equal(merged.laps, 2);
      assert.equal(merged.maxMinutes, 4);
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
    await check("each car has its own board; an unknown car in the config falls back to the default", async () => {
      await post(session("c7", "Fede", [[90_000, true], [90_000, true]], { carId: "sf26" }));
      const vf26 = await (await api("/leaderboard?mode=best")).json();
      assert.equal(vf26.carId, "vf26");
      assert.equal(vf26.rows.some((r: { name: string }) => r.name === "Fede"), false, "an SF-26 lap on the default car's board");
      const sf26 = await (await api("/leaderboard?mode=best&car=sf26")).json();
      assert.deepEqual(sf26.rows.map((r: { name: string }) => r.name), ["Fede"]);
      const cfg = await (await api("/config", { method: "PUT", body: JSON.stringify({ carId: "f2004", trackId: "monza" }) }, "9876")).json();
      assert.equal(cfg.carId, "vf26");
      assert.equal(cfg.trackId, "monza");
      await api("/config", { method: "PUT", body: JSON.stringify({ trackId: "rwanda_official_short" }) }, "9876");
    });
    await check("bad posts are refused", async () => {
      assert.equal((await post({ ...session("c5", "", [[100_000, true]]) })).status, 400);
      assert.equal((await post({ ...session("c6", "Dario", [[1_000, true]]) })).status, 400);
      assert.equal((await api("/results", { method: "POST", body: "{" })).status, 400);
    });
    await check("admin: list, CSV, delete one, reset with a backup", async () => {
      assert.equal((await api("/results")).status, 401);
      const { results } = await (await api("/results", {}, "9876")).json();
      assert.equal(results.length, 5);
      const csv = await (await api("/results.csv", {}, "9876")).text();
      assert.match(csv, /miglior_giro/);
      assert.equal(csv.trim().split("\n").length, 6);
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
  } finally {
    server.kill();
    rmSync(dataDir, { recursive: true, force: true });
  }

  console.log("Brand pictures (kiosk/brand.mjs)");
  {
    type BrandResult = { made: string[]; upToDate: string[]; removed: string[]; failed: string[]; skipped?: string };
    const brandUrl = pathToFileURL(join(__dirname, "../kiosk/brand.mjs")).href;
    const { ensureBrandAssets } = (await import(brandUrl)) as { ensureBrandAssets: (o: object) => Promise<BrandResult> };
    const quiet = { warn: () => {}, log: () => {} };
    const ALL = ["banner-combo.png", "banner-huawei.png", "banner-mgw.png", "huawei-logo.png", "mgw-logo.png"];
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
    const noDownloads = { KIOSK_SPONSOR_LOGO_URL: "", KIOSK_EVENT_LOGO_URL: "" };
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
        const first = await withEnv(noDownloads, () => ensureBrandAssets(o));
        assert.deepEqual(first.made.sort(), ALL, JSON.stringify(first));
        const size = (name: string) => {
          const png = readFileSync(join(o.outDir, name));
          return [png.readUInt32BE(16), png.readUInt32BE(20)];
        };
        for (const banner of ["banner-huawei.png", "banner-mgw.png", "banner-combo.png"]) assert.deepEqual(size(banner), [1024, 128], banner);
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
        rmSync(join(o.brandDir, "sponsor-logo.svg"));
        const finished = readFileSync(join(o.outDir, "banner-combo.png"));
        writeFileSync(join(o.brandDir, "banner-mgw.png"), finished);
        const res = await withEnv(noDownloads, () => ensureBrandAssets(o));
        assert.deepEqual(res.made, ["banner-mgw.png (kiosk/brand)"], JSON.stringify(res));
        assert.deepEqual(res.removed.sort(), ["banner-combo.png", "banner-huawei.png", "huawei-logo.png"]);
        assert.equal(hashOf(join(o.outDir, "banner-mgw.png")), createHash("sha256").update(finished).digest("hex"));
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
        const a = await withEnv({ KIOSK_SPONSOR_LOGO_URL: at("/a.svg"), KIOSK_EVENT_LOGO_URL: "" }, () => ensureBrandAssets(o));
        assert.ok(a.made.includes("banner-huawei.png"), JSON.stringify(a));
        const fromA = hashOf(join(o.outDir, "banner-huawei.png"));
        const b = await withEnv({ KIOSK_SPONSOR_LOGO_URL: at("/b.svg"), KIOSK_EVENT_LOGO_URL: "" }, () => ensureBrandAssets(o));
        assert.ok(b.made.includes("banner-huawei.png") && hits.includes("/b.svg"), JSON.stringify(b));
        assert.notEqual(hashOf(join(o.outDir, "banner-huawei.png")), fromA, "a new address is downloaded and drawn");
        const page = await withEnv({ KIOSK_SPONSOR_LOGO_URL: at("/page"), KIOSK_EVENT_LOGO_URL: "" }, () => ensureBrandAssets(o));
        assert.equal(page.made.length, 0, JSON.stringify(page));
        const pagesBefore = hits.filter((h) => h === "/page").length;
        await withEnv({ KIOSK_SPONSOR_LOGO_URL: at("/page"), KIOSK_EVENT_LOGO_URL: "" }, () => ensureBrandAssets(o));
        assert.equal(hits.filter((h) => h === "/page").length, pagesBefore, "a failed address is not asked again at once");
        const t0 = Date.now();
        await withEnv({ KIOSK_SPONSOR_LOGO_URL: at("/stall"), KIOSK_EVENT_LOGO_URL: "", KIOSK_BRAND_TIMEOUT_MS: "1500" }, () => ensureBrandAssets(o));
        assert.ok(Date.now() - t0 < 6000, `silent server held it ${Date.now() - t0} ms`);
      } finally {
        srv.closeAllConnections?.();
        srv.close();
        rmSync(o.tmp, { recursive: true, force: true });
      }
    });
  }

  if (failures > 0) {
    console.error(`\n${failures} kiosk check(s) failed`);
    process.exit(1);
  }
  console.log("\nKiosk checks passed.");
}

void main();
