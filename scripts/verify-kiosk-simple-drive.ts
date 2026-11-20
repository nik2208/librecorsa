/**
 * The kiosk's Guida semplice (simple driving): one switch in its config, on by default, that every visitor drives with
 * at every level. The drive gets it as two realism flags that only the kiosk sets: the energy store kept full, and
 * Straight Mode (the flaps on pad X, which no screen explains) opening by itself on the autopilot's rule and closing on
 * the brake. Without it a visitor tops out near 257 km/h from the second lap: the car's RAC mode stops deploying at the
 * store's 20 % floor, and only the brakes put energy back.
 *
 *  - the config, in the game and in kiosk/server.mjs: on by default and for a config saved before it existed (an
 *    existing config.json too), the default for anything but true or false, off kept (across a restart too)
 *  - the drive's flags: both with the switch on at every level, neither with it off, nor in the full game, whose saved
 *    settings cannot turn them on
 *  - the kiosk's car (the 2026 Prototype on its rigid-body engine) flat out on a long flat straight with the flaps shut:
 *    without the flags the store sits at the floor and the speed under 265 km/h; with them the store stays full past
 *    the 9 MJ a lap and the car passes 290 km/h, and its brakes stop it as before. Straight Mode by itself in a zone,
 *    from where it starts to where it ends, never outside one, shut on the brake and open again on the throttle. Each
 *    flag does its own job alone. A car with no energy store is the same
 *  - through the track environment and the simulation worker (every message cloned as postMessage clones it): its car
 *    gets the flags
 *
 * Run: npm run verify kiosk-simple-drive
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setVf26OnRigidBody } from "../src/lib/cars/vf26-engine";
import { vehicleModelSpec } from "../src/lib/cars/vehicle-models";
import { kioskSettingsFor } from "../src/lib/kiosk/kiosk-settings";
import { DEFAULT_KIOSK_CONFIG, KIOSK_DIFFICULTIES, sanitizeKioskConfig, type KioskConfig } from "../src/lib/kiosk/kiosk-types";
import { DEFAULT_PLAYER_SETTINGS, parsePlayerSettings } from "../src/lib/settings/player-settings";
import type { F12026CarSim } from "../src/lib/sim/f12026-car/F12026CarSim";
import { createVf26Sim } from "../src/lib/sim/f12026-car/Vf26Sim";
import { createAmgGt3Sim } from "../src/lib/sim/gt3/AmgGt3Sim";
import { createSimHost, loopbackTransport } from "../src/lib/sim/runtime/sim-host";
import { SIM_REALISM_FLAGS, SIM_REALISM_LEVELS, simRealismFlagsFor, type SimRealismFlags } from "../src/lib/sim/sim-realism";
import { TrackEnvironment } from "../src/lib/sim/track-environment";
import { getActiveTrackData, RWANDA_DRS_ZONES } from "../src/lib/track-data";
import type { ControlInputs } from "../src/types/f1";
import { createFlatTestTrack } from "./lib/flat-track";

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(78)} ${detail}`);
  if (!ok) failures.push(name);
};
const f = (v: number, d = 1) => v.toFixed(d);

async function main() {
  // ---------------------------------------------------------------------------------------------------------------
  console.log("== The switch in the config (the game's copy of the rules)");
  {
    // A config saved before the switch existed: everything else as a stand set it
    const { simpleDrive: _dropped, ...older } = { ...DEFAULT_KIOSK_CONFIG, limitMode: "laps" as const, laps: 4, device: "wheel" as const };
    void _dropped;
    check("on by default", DEFAULT_KIOSK_CONFIG.simpleDrive === true && sanitizeKioskConfig({}).simpleDrive === true && sanitizeKioskConfig(null).simpleDrive === true);
    const fromOlder = sanitizeKioskConfig(older);
    check("on for a config saved before it existed (the rest of it kept)", fromOlder.simpleDrive === true && fromOlder.laps === 4 && fromOlder.device === "wheel");
    const odd: unknown[] = ["false", "true", 0, 1, null, {}, "Spenta"];
    check("anything but true or false takes the default", odd.every((v) => sanitizeKioskConfig({ simpleDrive: v }).simpleDrive === true), odd.map((v) => JSON.stringify(v)).join(" "));
    check("off is kept (a second pass too: the admin page compares sanitized configs)", sanitizeKioskConfig(sanitizeKioskConfig({ simpleDrive: false })).simpleDrive === false && sanitizeKioskConfig({ simpleDrive: true }).simpleDrive === true);
  }

  // ---------------------------------------------------------------------------------------------------------------
  console.log("\n== The switch in kiosk/server.mjs (its plain-JS copy of the rules), on throwaway data folders");
  {
    const PIN = "4321";
    const staticDir = mkdtempSync(join(tmpdir(), "kiosk-simple-static-"));
    const fresh = mkdtempSync(join(tmpdir(), "kiosk-simple-fresh-"));
    const existing = mkdtempSync(join(tmpdir(), "kiosk-simple-existing-"));
    // A stand's config.json from before the switch (it has "device", so it is no config of the versions before Monza)
    const olderFile = {
      limitMode: "laps",
      laps: 4,
      minutes: 5,
      maxMinutes: 10,
      trackId: "rwanda_official_short",
      carId: "vf26",
      difficulty: "semi_pro",
      device: "wheel",
      graphics: "low",
      invalidLaps: "exclude",
      penaltyS: 5,
      racingLine: false,
      countdownS: 3,
      resultsHoldS: 30,
      motto: "Chi è il più veloce?",
      updatedAt: "2026-11-19T10:00:00.000Z",
    };
    writeFileSync(join(existing, "config.json"), JSON.stringify(olderFile, null, 2));
    // No --import tsx here: the server is plain JS, as the stand runs it
    const start = async (dataDir: string) => {
      const port = 20_000 + Math.floor(Math.random() * 20_000);
      let log = "";
      const child = spawn(process.execPath, [join(__dirname, "../kiosk/server.mjs")], {
        // KIOSK_BRAND=0: no logo downloads from a test
        env: { ...process.env, PORT: String(port), KIOSK_HOST: "127.0.0.1", KIOSK_DATA_DIR: dataDir, KIOSK_STATIC_DIR: staticDir, KIOSK_ADMIN_PIN: PIN, KIOSK_BRAND: "0", NODE_OPTIONS: "" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.on("data", (d) => (log += String(d)));
      child.stderr?.on("data", (d) => (log += String(d)));
      const base = `http://127.0.0.1:${port}`;
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(`${base}/api/kiosk/health`)).ok) break;
        } catch {
          // not listening yet
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      const stop = () =>
        new Promise<void>((done) => {
          if (child.exitCode !== null) return done();
          child.once("exit", () => done());
          child.kill();
        });
      const config = async () => (await fetch(`${base}/api/kiosk/config`)).json() as Promise<KioskConfig>;
      const put = async (body: object) =>
        (await fetch(`${base}/api/kiosk/config`, { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json", "X-Kiosk-Pin": PIN } })).json() as Promise<KioskConfig>;
      return { config, put, stop, log: () => log };
    };

    const a = await start(fresh);
    try {
      check("on by default (no config.json yet)", (await a.config()).simpleDrive === true);
    } catch (err) {
      check("on by default (no config.json yet)", false, `${String(err)} ${a.log().slice(0, 300)}`);
    } finally {
      await a.stop();
    }

    const b = await start(existing);
    try {
      const c = await b.config();
      check(
        "an existing config.json without it comes out on, the rest kept",
        c.simpleDrive === true && c.laps === 4 && c.device === "wheel" && c.difficulty === "semi_pro" && c.racingLine === false && c.trackId === "rwanda_official_short",
        `simpleDrive ${c.simpleDrive}, ${c.laps} laps, ${c.device}, ${c.difficulty}`
      );
      const offSaved = await b.put({ simpleDrive: false });
      const onDisk = JSON.parse(readFileSync(join(existing, "config.json"), "utf8")) as KioskConfig;
      check("off is saved (the answer, the next read and config.json)", offSaved.simpleDrive === false && (await b.config()).simpleDrive === false && onDisk.simpleDrive === false);
      const partial = await b.put({ laps: 2 });
      check("a save that leaves it out keeps it off", partial.simpleDrive === false && partial.laps === 2);
    } catch (err) {
      check("the server's config", false, `${String(err)} ${b.log().slice(0, 300)}`);
    } finally {
      await b.stop();
    }

    const c = await start(existing);
    try {
      check("off outlasts a restart", (await c.config()).simpleDrive === false);
      const odd = await c.put({ simpleDrive: "no" });
      const nulled = await c.put({ simpleDrive: false }).then(() => c.put({ simpleDrive: null }));
      check("anything but true or false takes the default", odd.simpleDrive === true && nulled.simpleDrive === true);
    } catch (err) {
      check("the server's config after a restart", false, `${String(err)} ${c.log().slice(0, 300)}`);
    } finally {
      await c.stop();
    }
    for (const dir of [staticDir, fresh, existing]) rmSync(dir, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------------------------------------------------------
  console.log("\n== Into the drive: two realism flags, which only the kiosk sets");
  const on = sanitizeKioskConfig({});
  const off = sanitizeKioskConfig({ simpleDrive: false });
  /** The flags the kiosk's drive runs with, as LibreCorsaSimulator builds them from the kiosk's settings */
  const kioskFlags = (config: KioskConfig, level = config.difficulty) => simRealismFlagsFor(kioskSettingsFor(config, level)(DEFAULT_PLAYER_SETTINGS));
  const both = (fl: Readonly<SimRealismFlags>) => fl.unlimitedEnergy === true && fl.autoStraightMode === true;
  const neither = (fl: Readonly<SimRealismFlags>) => !fl.unlimitedEnergy && !fl.autoStraightMode;
  {
    check(
      "the full game: neither, at every realism level (its own flags object, as before)",
      SIM_REALISM_LEVELS.every((realism) => {
        const flags = simRealismFlagsFor({ ...DEFAULT_PLAYER_SETTINGS, realism });
        return neither(flags) && neither(SIM_REALISM_FLAGS[realism]) && flags === SIM_REALISM_FLAGS[realism];
      })
    );
    const saved = parsePlayerSettings({ ...DEFAULT_PLAYER_SETTINGS, realism: "casual", simpleDrive: true });
    check("... and its saved settings cannot turn them on", saved.simpleDrive === undefined && neither(simRealismFlagsFor(saved)));
    check("the kiosk with the switch on: both, at every level", KIOSK_DIFFICULTIES.every((d) => both(kioskFlags(on, d.id))), KIOSK_DIFFICULTIES.map((d) => d.label).join(", "));
    const casual = SIM_REALISM_FLAGS.casual;
    const flags = kioskFlags(on);
    check(
      "... on top of the kiosk's casual realism, unchanged",
      flags.tyreWearScale === casual.tyreWearScale && flags.thermalGripScale === casual.thermalGripScale && flags.fuelUse === casual.fuelUse && flags.wetSeverity === casual.wetSeverity
    );
    check("the kiosk with the switch off: neither, at every level", KIOSK_DIFFICULTIES.every((d) => neither(kioskFlags(off, d.id))));
    check("turned off between two players: the next one drives without", neither(simRealismFlagsFor(kioskSettingsFor(off)(kioskSettingsFor(on)(DEFAULT_PLAYER_SETTINGS)))));
    const ownManual = { ...DEFAULT_PLAYER_SETTINGS, autoGearbox: false };
    check(
      "the levels keep their aids and gearbox either way",
      KIOSK_DIFFICULTIES.every((d) =>
        [DEFAULT_PLAYER_SETTINGS, ownManual].every((own) => {
          const a = kioskSettingsFor(on, d.id)(own);
          const b = kioskSettingsFor(off, d.id)(own);
          return a.assistPreset === b.assistPreset && a.assistPreset === d.id && a.autoGearbox === b.autoGearbox;
        })
      )
    );
  }

  // ---------------------------------------------------------------------------------------------------------------
  console.log("\n== The kiosk's car (2026 Prototype, rigid-body engine) on a long flat straight");
  const pad = createFlatTestTrack(60_000, 3000);
  const L = pad.totalLengthM;
  const H = 1 / 240;
  // Straight Mode's zones are the active circuit's, as shares of a lap: on the 60 km pad they are kilometres long
  const inWindow = (p: number, from: number, to: number) => (from <= to ? p >= from && p <= to : p >= from || p <= to);
  const inZone = (s: number) => RWANDA_DRS_ZONES.some((z) => inWindow((((s % L) + L) % L) / L, z.start, z.end));
  /** Where a run of `lengthM` stays inside one zone, or clear of them all */
  const spotOnPad = (inside: boolean, lengthM: number): number => {
    for (let s = 1000; s < L - lengthM; s += 100) {
      let ok = true;
      for (let d = 0; d <= lengthM && ok; d += 50) ok = inZone(s + d) === inside;
      if (ok) return s;
    }
    throw new Error(`no ${inside ? "zone" : "zone-free stretch"} of ${lengthM} m on the pad`);
  };
  const CLEAR = spotOnPad(false, 7000);
  const ZONE = spotOnPad(true, 2500);
  /** The car as the kiosk's session sets it up: the event's level (Facile), the automatic gearbox, the 2026 rules */
  const kioskCar = (flags: Readonly<SimRealismFlags>, s: number, kmh: number): F12026CarSim => {
    const sim = createVf26Sim(pad, null);
    sim.assistPreset = "assisted";
    sim.autoGearbox = true;
    sim.setOvertakingRules("straight-mode-2026");
    sim.setSimRealism(flags);
    sim.teleportToDistance(s, kmh / 3.6);
    return sim;
  };
  const MAX_J = 4_000_000;
  {
    /** Flat out from 150 km/h on a full store (as after a start from the grid), clear of every zone */
    const flatOut = (flags: Readonly<SimRealismFlags>, seconds: number) => {
      const sim = kioskCar(flags, CLEAR, 150);
      const maxJ = sim.vehicle.config.ers.ERS_MAX_CHARGE;
      let peak = 0;
      let minSoc = 1;
      let floorAtS: number | null = null;
      let minHud = 100;
      let flapsOpened = false;
      let deployedJ = 0;
      const last: number[] = [];
      for (let t = 0; t < seconds; t += H) {
        const tel = sim.step(H, { throttle: 1, brake: 0 });
        const soc = sim.vehicle.ersEnergyJ / maxJ;
        minSoc = Math.min(minSoc, soc);
        if (floorAtS === null && soc <= 0.205) floorAtS = t;
        minHud = Math.min(minHud, Math.round(tel.ersBatteryPercent));
        peak = Math.max(peak, tel.speedKmh);
        flapsOpened ||= sim.vehicle.drsOpen;
        if (tel.mgukPowerKw > 0) deployedJ += tel.mgukPowerKw * 1000 * H;
        if (t >= seconds - 10) last.push(tel.speedKmh);
      }
      const settled = last.reduce((a, b) => a + b, 0) / last.length;
      return { peak, settled, minSoc, endSoc: sim.vehicle.ersEnergyJ / maxJ, floorAtS, minHud, flapsOpened, deployedJ, endKw: sim.telemetry.mgukPowerKw, gear: sim.telemetry.gear, maxJ };
    };
    const stock = flatOut(kioskFlags(off), 80);
    check("store as on the stand: 4 MJ", stock.maxJ === MAX_J, `${stock.maxJ / 1e6} MJ`);
    check("without the flags the store reaches RAC's 20 % floor and stays there", stock.minSoc <= 0.205 && stock.endSoc <= 0.205, `at the floor after ${stock.floorAtS === null ? "-" : f(stock.floorAtS)} s`);
    check(
      "... and the speed settles under 265 km/h (no electric power left on the straight)",
      stock.settled < 265 && stock.settled > 235,
      `${f(stock.peak)} km/h on the full store, then ${f(stock.settled)} in gear ${stock.gear} (Monza's main straight: about 257)`
    );
    check("... with the flaps shut throughout", !stock.flapsOpened);
    const simple = flatOut(kioskFlags(on), 60);
    check("with Guida semplice the store stays full (the HUD reads 100 %)", simple.minSoc >= 0.999 && simple.minHud === 100, `lowest ${f(simple.minSoc * 100, 2)} %`);
    check("... and the car passes 290 km/h", simple.peak > 290 && simple.settled > 290, `${f(simple.settled)} km/h`);
    check(
      "... deploying past the store's usable 3.2 MJ and the 9 MJ a lap, and still at the end",
      simple.deployedJ > 9e6 && simple.endKw > 100,
      `${f(simple.deployedJ / 1e6)} MJ at the motor in 60 s, ${f(simple.endKw, 0)} kW at the end`
    );
    check("... with the flaps shut throughout (no zone on this stretch)", !simple.flapsOpened);
  }
  {
    /** Full brake from about 290 km/h (a moment flat out first, so both runs start alike) down to 100 */
    const stop = (flags: Readonly<SimRealismFlags>, socShare: number) => {
      const sim = kioskCar(flags, CLEAR, 290);
      sim.vehicle.ersEnergyJ = socShare * sim.vehicle.config.ers.ERS_MAX_CHARGE;
      for (let t = 0; t < 0.5; t += H) sim.step(H, { throttle: 1, brake: 0 });
      const fromKmh = sim.telemetry.speedKmh;
      const s0 = sim.sMeters;
      let harvestKw = 0;
      for (let t = 0; sim.telemetry.speedKmh > 100 && t < 10; t += H) harvestKw = Math.min(harvestKw, sim.step(H, { throttle: 0, brake: 1 }).mgukPowerKw);
      return { metres: sim.sMeters - s0, fromKmh, harvestKw };
    };
    // Against a store with room, so the stock car harvests on the brakes: a full one stops harvesting either way
    const stock = stop(kioskFlags(off), 0.5);
    const simple = stop(kioskFlags(on), 1);
    check(
      "the brakes stop it as before: the full store harvests nothing, the rear calipers take its share",
      stock.harvestKw < -200 && simple.harvestKw > -1 && Math.abs(simple.metres / stock.metres - 1) < 0.02 && Math.abs(simple.fromKmh - stock.fromKmh) < 1,
      `${f(stock.fromKmh)} → 100 km/h in ${f(stock.metres, 2)} m harvesting ${f(-stock.harvestKw, 0)} kW, ${f(simple.metres, 2)} m with Guida semplice`
    );
  }
  {
    /** Straight Mode through a run of phases (throttle, brake, seconds; a press of X on its first frame) */
    const flapsThrough = (flags: Readonly<SimRealismFlags>, s: number, phases: { throttle: number; brake: number; seconds: number; pressX?: boolean }[]) => {
      const sim = kioskCar(flags, s, 200);
      return phases.map((p) => {
        let openedAfterS: number | null = null;
        let open = false;
        let shutAfterS: number | null = null;
        for (let t = 0; t < p.seconds; t += H) {
          const inputs: Partial<ControlInputs> = { throttle: p.throttle, brake: p.brake, toggleXMode: p.pressX === true && t === 0 };
          sim.step(H, inputs);
          open = sim.vehicle.drsOpen;
          if (open && openedAfterS === null) openedAfterS = t + H;
          if (!open && shutAfterS === null) shutAfterS = t + H;
        }
        return { open, openedAfterS, shutAfterS, inZone: inZone(sim.sMeters) };
      });
    };
    const [opened, braked, reopened, bothPedals, released, pressed] = flapsThrough(kioskFlags(on), ZONE, [
      { throttle: 1, brake: 0, seconds: 1 },
      { throttle: 0, brake: 1, seconds: 0.3 },
      { throttle: 1, brake: 0, seconds: 1 },
      { throttle: 1, brake: 0.3, seconds: 0.5 },
      { throttle: 1, brake: 0, seconds: 1 },
      { throttle: 1, brake: 0, seconds: 0.5, pressX: true },
    ]);
    check(
      "with Guida semplice the flaps open by themselves in a zone, on full throttle",
      opened.open && opened.openedAfterS !== null && opened.openedAfterS <= 0.1 && opened.inZone,
      `after ${opened.openedAfterS === null ? "-" : f(opened.openedAfterS * 1000, 0)} ms`
    );
    check(
      "... shut on the brake",
      opened.open && !braked.open && braked.shutAfterS !== null && braked.shutAfterS <= 0.02,
      `after ${braked.shutAfterS === null ? "-" : f(braked.shutAfterS * 1000, 0)} ms`
    );
    check("... and open again on the throttle", reopened.open && reopened.openedAfterS !== null && reopened.openedAfterS <= 0.1);
    check(
      "... stay shut while both triggers are down, and open as the brake lets go",
      !bothPedals.open && released.open && released.openedAfterS !== null && released.openedAfterS <= 0.1 && released.inZone
    );
    check("... and X still shuts them", !pressed.open && pressed.inZone);
    const [stock] = flapsThrough(kioskFlags(off), ZONE, [{ throttle: 1, brake: 0, seconds: 2 }]);
    check("without it they stay shut (a visitor who never presses X)", !stock.open && stock.openedAfterS === null);
    const [outside] = flapsThrough(kioskFlags(on), CLEAR, [{ throttle: 1, brake: 0, seconds: 2 }]);
    check("never outside a zone", outside.openedAfterS === null && !outside.inZone);
  }
  {
    // The ask is read on its edge (VehiclePhysics handleEdges): a car already flat out as it reaches a zone must still
    // get its flaps there, and lose them where the zone ends
    const zone = RWANDA_DRS_ZONES.find((z) => z.start < z.end);
    if (!zone) throw new Error("the active circuit has no zone that does not run over the line");
    const startM = zone.start * L;
    const endM = zone.end * L;
    /** Flat out at 250 km/h from `fromM` for 6 s: where the flaps first open and first shut */
    const edges = (fromM: number) => {
      const sim = kioskCar(kioskFlags(on), fromM, 250);
      let openAtM: number | null = null;
      let shutAtM: number | null = null;
      let was = sim.vehicle.drsOpen;
      for (let t = 0; t < 6; t += H) {
        sim.step(H, { throttle: 1, brake: 0 });
        const open = sim.vehicle.drsOpen;
        if (open && !was && openAtM === null) openAtM = sim.sMeters;
        if (!open && was && shutAtM === null) shutAtM = sim.sMeters;
        was = open;
      }
      return { openAtM, shutAtM };
    };
    const at = (m: number | null, ref: number) => (m === null ? "-" : `${m - ref >= 0 ? "+" : ""}${f(m - ref, 2)} m`);
    const entry = edges(startM - 200);
    check("flat out into a zone: the flaps open where it starts", entry.openAtM !== null && Math.abs(entry.openAtM - startM) < 2, `${at(entry.openAtM, startM)} from its start`);
    const exit = edges(endM - 200);
    check(
      "... and shut where it ends, still flat out",
      exit.openAtM !== null && exit.openAtM < endM && exit.shutAtM !== null && Math.abs(exit.shutAtM - endM) < 2,
      `${at(exit.shutAtM, endM)} from its end`
    );
  }
  {
    // Each flag does its own job, and not the other's (the kiosk always sets both)
    const casual = SIM_REALISM_FLAGS.casual;
    /** Flat out from 200 km/h in a zone: when the flaps first open, and the lowest the store gets */
    const zoneFlatOut = (flags: Readonly<SimRealismFlags>, seconds: number) => {
      const sim = kioskCar(flags, ZONE, 200);
      const maxJ = sim.vehicle.config.ers.ERS_MAX_CHARGE;
      let openedAfterS: number | null = null;
      let minSoc = 1;
      for (let t = 0; t < seconds; t += H) {
        sim.step(H, { throttle: 1, brake: 0 });
        if (openedAfterS === null && sim.vehicle.drsOpen) openedAfterS = t + H;
        minSoc = Math.min(minSoc, sim.vehicle.ersEnergyJ / maxJ);
      }
      return { openedAfterS, minSoc, inZone: inZone(sim.sMeters) };
    };
    const energy = zoneFlatOut({ ...casual, unlimitedEnergy: true }, 3);
    check(
      "unlimitedEnergy alone: the store stays full, the flaps shut (in a zone)",
      energy.minSoc >= 0.999 && energy.openedAfterS === null && energy.inZone,
      `lowest ${f(energy.minSoc * 100, 2)} %`
    );
    const flaps = zoneFlatOut({ ...casual, autoStraightMode: true }, 20);
    check(
      "autoStraightMode alone: the flaps open by themselves, the store runs down as ever",
      flaps.openedAfterS !== null && flaps.openedAfterS <= 0.1 && flaps.minSoc < 0.5 && flaps.inZone,
      `lowest ${f(flaps.minSoc * 100, 1)} % after 20 s`
    );
  }
  {
    /** A car with no energy store and no flaps (the GT3), flat out in a zone for 10 s */
    const gt3 = (flags: Readonly<SimRealismFlags>) => {
      const sim = createAmgGt3Sim(pad, null);
      sim.autoGearbox = true;
      sim.setSimRealism(flags);
      sim.teleportToDistance(ZONE, 100 / 3.6);
      for (let t = 0; t < 10; t += H) sim.step(H, { throttle: 1, brake: 0 });
      return [sim.vxMs, sim.sMeters, sim.vehicle.ersEnergyJ, sim.telemetry.ersBatteryPercent, sim.vehicle.drsOpen ? 1 : 0];
    };
    const a = gt3(kioskFlags(off));
    const b = gt3(kioskFlags(on));
    check("a car with no energy store drives exactly the same with the flags", a.every((v, i) => v === b[i]), `${f(a[0] * 3.6)} km/h after 10 s either way`);
  }

  // ---------------------------------------------------------------------------------------------------------------
  console.log("\n== Through the simulation worker (each message cloned as postMessage clones it)");
  {
    setVf26OnRigidBody(true);
    const track = getActiveTrackData(1200);
    /** The kiosk's car behind the worker, set up as the session's createCar does, flat out */
    const workerDrive = (flags: Readonly<SimRealismFlags>) => {
      const loop = loopbackTransport();
      const host = createSimHost(loop.transport, loop.wallNowMs);
      const car = host.adopt(vehicleModelSpec("vf26").createSim(track, null), "vf26");
      car.setOvertakingRules?.("straight-mode-2026");
      car.aiAutopilot = false;
      car.assistPreset = "assisted";
      car.autoGearbox = true;
      car.resetToStartGrid(false);
      host.endFrame(true);
      // The flags take the game's own way: the page gives them to the track environment, which hands them to each car
      // it updates (here the stand-in, which passes them to its twin and to the worker's car)
      const env = new TrackEnvironment(track);
      env.setSimRealism(flags);
      let minHud = 100;
      let flapsOpened = false;
      let deployed = false;
      const FRAME_S = 1 / 60;
      for (let frame = 0; frame < 60 * 8; frame++) {
        // In the session's order: the environment, then the car
        env.update(FRAME_S, [car]);
        car.step(FRAME_S, { throttle: 1, brake: 0 });
        loop.advance(FRAME_S);
        host.endFrame(true);
        // What the game reads from its stand-in (the worker's states and telemetry)
        if (frame > 30) {
          minHud = Math.min(minHud, car.telemetry.ersBatteryPercent);
          flapsOpened ||= car.telemetry.activeAeroMode === "X_MODE";
          deployed ||= car.telemetry.mgukPowerKw > 50;
        }
      }
      return { remote: host.remote, worker: loop.runtime.simulatedCar, minHud, flapsOpened, deployed, kmh: car.telemetry.speedKmh };
    };
    const simple = workerDrive(kioskFlags(on));
    const stock = workerDrive(kioskFlags(off));
    check("the worker drives the kiosk's car on its rigid-body engine", simple.remote && stock.remote && simple.worker?.constructor.name === "F12026CarSim", simple.worker?.constructor.name ?? "none");
    check("with the kiosk's flags its store stays full while it deploys", simple.deployed && simple.minHud >= 99.5, `lowest ${f(simple.minHud, 2)} % (${f(simple.kmh, 0)} km/h after 8 s)`);
    check("... and its flaps open by themselves on the start straight (a zone)", simple.flapsOpened);
    check("without them the store runs down and the flaps stay shut", stock.minHud < 95 && !stock.flapsOpened, `lowest ${f(stock.minHud, 1)} %`);
  }

  console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll Guida semplice checks passed");
  process.exit(failures.length ? 1 : 0);
}

void main();
