/**
 * The kiosk's «Guida semplice» (event branch): the switch in the config on both sides (src/lib/kiosk/kiosk-types.ts and
 * kiosk/server.mjs, on a throwaway data folder), the realism flags it becomes (and that nothing else turns on), and
 * what they do to the kiosk's car, the LC26 on the rigid-body engine: a store that never runs down, so the car is no
 * longer held near 257 km/h once the store is at the RAC floor; Straight Mode working itself; the brakes as before; and
 * the flags reaching the car the simulation worker drives.
 *
 * Run: node scripts/run-verify.mjs kiosk-simple-drive
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLc26OnRigidBody } from '../src/lib/cars/lc26-engine';
import { vehicleModelSpec } from '../src/lib/cars/vehicle-models';
import { DEFAULT_KIOSK_CONFIG, KIOSK_DIFFICULTIES, sanitizeKioskConfig, type KioskConfig } from '../src/lib/kiosk/kiosk-types';
import { kioskSettingsFor } from '../src/lib/kiosk/kiosk-settings';
import { DEFAULT_PLAYER_SETTINGS, parsePlayerSettings } from '../src/lib/settings/player-settings';
import { F12026CarSim } from '../src/lib/sim/f12026-car/F12026CarSim';
import { createLc26Sim, LC26_SIM_PROFILE } from '../src/lib/sim/f12026-car/Lc26Sim';
import { createSimHost, loopbackTransport } from '../src/lib/sim/runtime/sim-host';
import { FULL_REALISM, SIM_REALISM_FLAGS, SIM_REALISM_LEVELS, simRealismFlagsFor, type SimRealismFlags } from '../src/lib/sim/sim-realism';
import { inLapWindow } from '../src/lib/sim/straight-mode-zones';
import { TrackEnvironment } from '../src/lib/sim/track-environment';
import { getActiveTrackData, RWANDA_DRS_ZONES } from '../src/lib/track-data';
import type { ControlInputs } from '../src/types/f1';
import { createFlatTestTrack } from './lib/flat-track';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(76)} ${detail}`);
  if (!ok) failures.push(name);
};
const kmh = (v: number) => `${v.toFixed(1)} km/h`;
const pct = (v: number) => `${(100 * v).toFixed(2)} %`;
const started = Date.now();

/** The flags a kiosk session drives on, through the game's own chain: config → kiosk settings → realism flags */
const flagsOf = (config: KioskConfig, level = config.difficulty): Readonly<SimRealismFlags> => {
  const s = kioskSettingsFor(config, level)(DEFAULT_PLAYER_SETTINGS);
  return simRealismFlagsFor(s.realism, s.simpleDrive);
};
const simpleOn = (f: Readonly<SimRealismFlags>) => f.unlimitedEnergy === true && f.autoStraightMode === true;
const simpleOff = (f: Readonly<SimRealismFlags>) => f.unlimitedEnergy !== true && f.autoStraightMode !== true;

async function main() {
  console.log('== The switch in the config (src/lib/kiosk/kiosk-types.ts)');
  {
    check('on by default', DEFAULT_KIOSK_CONFIG.simpleDrive === true && sanitizeKioskConfig({}).simpleDrive === true);
    // A config saved before the switch existed: every other field of its own, kept
    const { simpleDrive: _none, ...before } = { ...DEFAULT_KIOSK_CONFIG, minutes: 4, difficulty: 'semi_pro' as const, graphics: 'low' as const };
    void _none;
    const old = sanitizeKioskConfig(before);
    check('a config without the field comes out on, the rest as it was', old.simpleDrive === true && old.minutes === 4 && old.difficulty === 'semi_pro' && old.graphics === 'low');
    const odd = ['false', 'no', 0, 1, null, {}, []].map((v) => sanitizeKioskConfig({ simpleDrive: v }).simpleDrive);
    check('anything but a boolean gives the default', odd.every((v) => v === true), JSON.stringify(odd));
    check('off is kept, and on', sanitizeKioskConfig({ simpleDrive: false }).simpleDrive === false && sanitizeKioskConfig({ simpleDrive: true }).simpleDrive === true);
    check('kept through a second pass (the admin page sanitizes what it loaded)', sanitizeKioskConfig(sanitizeKioskConfig({ simpleDrive: false })).simpleDrive === false);
  }

  console.log('\n== The switch on the server (kiosk/server.mjs)');
  {
    const PIN = '4321';
    const staticDir = mkdtempSync(join(tmpdir(), 'kiosk-simple-static-'));
    mkdirSync(join(staticDir, 'kiosk', 'brand'), { recursive: true });
    const freshDir = mkdtempSync(join(tmpdir(), 'kiosk-simple-fresh-'));
    // An existing kiosk's config.json, saved before the switch (with "device": not one from before Monza)
    const oldDir = mkdtempSync(join(tmpdir(), 'kiosk-simple-old-'));
    const oldConfig = { limitMode: 'time', laps: 3, minutes: 4, maxMinutes: 10, trackId: 'monza', carId: 'lc26', difficulty: 'semi_pro', device: 'controller', graphics: 'low', motto: 'Prova' };
    writeFileSync(join(oldDir, 'config.json'), JSON.stringify(oldConfig));
    const servers: ChildProcess[] = [];
    const startServer = async (dataDir: string, port: number) => {
      const server = spawn(process.execPath, [join(__dirname, '../kiosk/server.mjs')], {
        env: { ...process.env, PORT: String(port), KIOSK_HOST: '127.0.0.1', KIOSK_DATA_DIR: dataDir, KIOSK_STATIC_DIR: staticDir, KIOSK_ADMIN_PIN: PIN, KIOSK_BRAND: '0', NODE_OPTIONS: '' },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      servers.push(server);
      const base = `http://127.0.0.1:${port}`;
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(`${base}/api/kiosk/health`)).ok) break;
        } catch {
          // not listening yet
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return {
        stop: () =>
          new Promise<void>((resolve) => {
            if (server.exitCode !== null) return resolve();
            server.once('exit', () => resolve());
            server.kill();
          }),
        get: async () => (await fetch(`${base}/api/kiosk/config`)).json() as Promise<KioskConfig>,
        put: async (body: object) =>
          (await fetch(`${base}/api/kiosk/config`, { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'X-Kiosk-Pin': PIN } })).json() as Promise<KioskConfig>,
      };
    };
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    try {
      const fresh = await startServer(freshDir, port);
      check('a new kiosk: on', (await fresh.get()).simpleDrive === true);
      await fresh.stop();

      const old = await startServer(oldDir, port + 1);
      const loaded = await old.get();
      check('an existing config.json without the field: on, its own settings kept', loaded.simpleDrive === true && loaded.minutes === 4 && loaded.difficulty === 'semi_pro' && loaded.motto === 'Prova', `minutes ${loaded.minutes}, ${loaded.difficulty}`);
      const off = await old.put({ simpleDrive: false });
      const onDisk = JSON.parse(readFileSync(join(oldDir, 'config.json'), 'utf8')) as KioskConfig;
      check('switched off: kept, and saved to config.json', off.simpleDrive === false && onDisk.simpleDrive === false);
      const partial = await old.put({ laps: 2 });
      check('a save that leaves it out keeps it off', partial.simpleDrive === false && partial.laps === 2);
      await old.stop();
      const again = await startServer(oldDir, port + 2);
      check('still off after a restart', (await again.get()).simpleDrive === false);
      const odd = [await again.put({ simpleDrive: 'no' }), await again.put({ simpleDrive: 0 }), await again.put({ simpleDrive: null })].map((c) => c.simpleDrive);
      check('anything but a boolean gives the default (on)', odd.every((v) => v === true), JSON.stringify(odd));
      await again.stop();
    } finally {
      for (const s of servers) if (s.exitCode === null) s.kill();
      for (const dir of [staticDir, freshDir, oldDir]) rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log('\n== The flags it becomes, and the full game without them');
  {
    check('no realism level has either', SIM_REALISM_LEVELS.every((l) => simpleOff(SIM_REALISM_FLAGS[l]) && simpleOff(simRealismFlagsFor(l))) && simpleOff(FULL_REALISM));
    const own = DEFAULT_PLAYER_SETTINGS;
    check('the full game: the switch off, and its flags without either', own.simpleDrive === false && simpleOff(simRealismFlagsFor(own.realism, own.simpleDrive)));
    check(
      'a save never turns it on (the full game on the stand PC)',
      parsePlayerSettings({ ...DEFAULT_PLAYER_SETTINGS, simpleDrive: true }).simpleDrive === false && parsePlayerSettings({}).simpleDrive === false
    );
    check('a car nobody gave flags has neither', simpleOff(createLc26Sim(createFlatTestTrack(), null).vehicle.realism));
    const on = sanitizeKioskConfig({});
    const off = sanitizeKioskConfig({ simpleDrive: false });
    check('the kiosk, on: every level drives with both', KIOSK_DIFFICULTIES.every((d) => simpleOn(flagsOf(on, d.id))));
    check('the kiosk, off: no level has either (the casual level as it was)', KIOSK_DIFFICULTIES.every((d) => flagsOf(off, d.id) === SIM_REALISM_FLAGS.casual));
    const casual = flagsOf(on);
    check(
      "on top of the kiosk's casual level, which it keeps",
      casual.tyreWearScale === 0 && casual.thermalGripScale === SIM_REALISM_FLAGS.casual.thermalGripScale && casual.wetSeverity === SIM_REALISM_FLAGS.casual.wetSeverity
    );
    check('one object per level (the cars are handed flags again on a new one)', flagsOf(on) === flagsOf(sanitizeKioskConfig({ minutes: 3 })));
    const same = KIOSK_DIFFICULTIES.every((d) => {
      const a = kioskSettingsFor(on, d.id)(DEFAULT_PLAYER_SETTINGS);
      const b = kioskSettingsFor(off, d.id)(DEFAULT_PLAYER_SETTINGS);
      return a.assistPreset === b.assistPreset && a.autoGearbox === b.autoGearbox && a.assistPreset === d.id;
    });
    check("the levels keep their own assists and gearbox, on or off", same);
  }

  const KIOSK_ON = flagsOf(sanitizeKioskConfig({}));
  const KIOSK_OFF = flagsOf(sanitizeKioskConfig({ simpleDrive: false }));
  const ENERGY_ONLY: Readonly<SimRealismFlags> = { ...KIOSK_OFF, unlimitedEnergy: true };
  const pad = createFlatTestTrack(60_000, 3000);
  const ERS = LC26_SIM_PROFILE.config.ers;
  const MAX = ERS.ERS_MAX_CHARGE;
  const mj = (j: number) => `${(j / 1e6).toFixed(1)} MJ`;
  // The page's frames: several of the car's ticks to each
  const FRAME_S = 1 / 60;
  /** The kiosk's car (Facile: the assisted dials, the automatic gearbox; the 2026 rules) rolling down the flat pad */
  const kioskCar = (flags: Readonly<SimRealismFlags>, startKmh: number, soc = 1): F12026CarSim => {
    const sim = createLc26Sim(pad, null);
    sim.assistPreset = 'assisted';
    sim.autoGearbox = true;
    sim.setOvertakingRules('straight-mode-2026');
    sim.setSimRealism(flags);
    sim.teleportToDistance(2000, startKmh / 3.6);
    sim.vehicle.ersEnergyJ = soc * MAX;
    sim.vehicle.resetLapEnergy();
    return sim;
  };

  console.log('\n== Flat out down a long flat straight, the flaps shut (the kiosk\'s car from 150 km/h, 80 s)');
  {
    const flatOut = (flags: Readonly<SimRealismFlags>, seconds = 80) => {
      const sim = kioskCar(flags, 150);
      let socMin = 1;
      // The store as the physics left it at the end of each frame's last tick, before the refill that follows the tick:
      // what it had to deploy from, not the refilled figure
      let stepSocMin = 1;
      // What the HUDs print (they round it)
      let hudMin = 100;
      let peak = 0;
      let flapsS = 0;
      // The motor's work at its shaft (J), over the whole run and over its last 5 s
      let motorJ = 0;
      let motorLastJ = 0;
      const last: number[] = [];
      for (let t = 0; t < seconds; t += FRAME_S) {
        const tel = sim.step(FRAME_S, { throttle: 1 });
        socMin = Math.min(socMin, sim.vehicle.ersEnergyJ / MAX);
        stepSocMin = Math.min(stepSocMin, sim.vehicle.telemetry.ERS_CHARGE);
        hudMin = Math.min(hudMin, Math.round(tel.ersBatteryPercent));
        const motor = Math.max(0, sim.vehicle.telemetry.MGUK_POWER) * FRAME_S;
        motorJ += motor;
        peak = Math.max(peak, tel.speedKmh);
        if (sim.vehicle.drsOpen) flapsS += FRAME_S;
        if (t >= seconds - 5) {
          last.push(tel.speedKmh);
          motorLastJ += motor;
        }
      }
      return {
        socMin,
        stepSocMin,
        hudMin,
        socEnd: sim.vehicle.ersEnergyJ / MAX,
        peak,
        settled: Math.max(...last),
        drift: last[last.length - 1] - last[0],
        flapsS,
        gear: sim.telemetry.gear,
        motorJ,
        motorLastKw: motorLastJ / 5 / 1000,
      };
    };
    const stock = flatOut(KIOSK_OFF);
    check(
      'without the flags the store runs down to the RAC floor (20 %) and stays there',
      stock.socMin > 0.19 && Math.abs(stock.socEnd - 0.2) < 0.005 && stock.motorLastKw < 1,
      `lowest ${pct(stock.socMin)}, at the end ${pct(stock.socEnd)}; the motor gave ${mj(stock.motorJ)}, ${stock.motorLastKw.toFixed(1)} kW over the last 5 s`
    );
    check(
      'and the top speed settles under 265 km/h (the engine alone)',
      stock.settled < 265 && Math.abs(stock.drift) < 1.5 && stock.flapsS === 0,
      `${kmh(stock.settled)} in gear ${stock.gear} over the last 5 s (peak ${kmh(stock.peak)} while the store lasted)`
    );
    const bottomless = flatOut(ENERGY_ONLY);
    check(
      'with unlimitedEnergy the store stays at 100 %',
      bottomless.socMin > 0.9999 && bottomless.stepSocMin > 0.999 && bottomless.hudMin === 100,
      `lowest ${pct(bottomless.stepSocMin)} as the physics left a tick; the HUD at ${bottomless.hudMin} % or more`
    );
    check('and the top speed passes 290 km/h', bottomless.settled > 290 && bottomless.flapsS === 0, `${kmh(bottomless.settled)} in gear ${bottomless.gear} (peak ${kmh(bottomless.peak)})`);
    // No line to cross on the pad: without the flag, a lap's allowance and the store would both have run out by then
    check(
      "the motor deploys past a lap's allowance and the store's size, still at it at the end",
      bottomless.motorJ > ERS.deployPerLapJ && bottomless.motorLastKw > 100,
      `${mj(bottomless.motorJ)} at its shaft in 80 s (allowance ${mj(ERS.deployPerLapJ)}, store ${mj(MAX)}), ${bottomless.motorLastKw.toFixed(0)} kW over the last 5 s`
    );
    const kiosk = flatOut(KIOSK_ON, 40);
    console.log(`      the kiosk with both flags: ${kmh(kiosk.settled)} in gear ${kiosk.gear}, the flaps open ${kiosk.flapsS.toFixed(1)} of 40 s, store at ${pct(kiosk.socMin)} or more`);
    // The override still works over a full store (push decided as ever)
    const sim = kioskCar(ENERGY_ONLY, 250);
    let pushed = 0;
    for (let t = 0; t < 2; t += FRAME_S) {
      sim.step(FRAME_S, { throttle: 1, manualOverride: true });
      if (sim.vehicle.performanceMode === 'PSH') pushed += FRAME_S;
    }
    check('the override still switches to push over the full store', pushed > 1.9 && sim.vehicle.ersEnergyJ / MAX > 0.9999, `${pushed.toFixed(2)} s of 2 in PSH`);
  }

  console.log('\n== The brakes, from 290 to 80 km/h at full pedal');
  {
    const stop = (flags: Readonly<SimRealismFlags>, soc: number) => {
      const sim = kioskCar(flags, 290, soc);
      const s0 = sim.sMeters;
      let t = 0;
      let harvestJ = 0;
      while (sim.telemetry.speedKmh > 80 && t < 10) {
        sim.step(FRAME_S, { brake: 1 });
        harvestJ += Math.max(0, -sim.vehicle.telemetry.MGUK_POWER) * FRAME_S;
        t += FRAME_S;
      }
      return { m: sim.sMeters - s0, s: t, harvestKJ: harvestJ / 1000 };
    };
    const full = stop(KIOSK_OFF, 1);
    const floor = stop(KIOSK_OFF, 0.2);
    const bottomless = stop(ENERGY_ONLY, 1);
    const detail = (r: { m: number; s: number; harvestKJ: number }) => `${r.m.toFixed(1)} m in ${r.s.toFixed(2)} s, ${r.harvestKJ.toFixed(0)} kJ harvested`;
    console.log(`      stock, store full:     ${detail(full)}`);
    console.log(`      stock, store at 20 %:  ${detail(floor)}`);
    console.log(`      unlimitedEnergy:       ${detail(bottomless)}`);
    check('the store kept full harvests nothing on the brakes', bottomless.harvestKJ < 1 && floor.harvestKJ > 100);
    check('and stops as a stock car with a full store does', Math.abs(bottomless.m - full.m) < 0.005 * full.m, `${bottomless.m.toFixed(1)} m against ${full.m.toFixed(1)} m`);
    check(
      'and as one harvesting from the floor (the rear calipers take the motor\'s share)',
      Math.abs(bottomless.m - floor.m) < 0.015 * floor.m,
      `${bottomless.m.toFixed(1)} m against ${floor.m.toFixed(1)} m (${((100 * (bottomless.m - floor.m)) / floor.m).toFixed(2)} %)`
    );
    // Stop after stop, the rear discs heat up with no harvest to share their work: eight stops from 240 km/h (as fast as
    // the stock car gets at its floor), flat out back up to it between them
    const stops = (flags: Readonly<SimRealismFlags>, soc: number) => {
      const sim = kioskCar(flags, 240, soc);
      const out: { m: number; rearC: number }[] = [];
      for (let n = 0; n < 8; n++) {
        for (let t = 0; sim.telemetry.speedKmh < 240 && t < 40; t += FRAME_S) sim.step(FRAME_S, { throttle: 1 });
        const s0 = sim.sMeters;
        let rearC = 0;
        for (let t = 0; sim.telemetry.speedKmh > 80 && t < 10; t += FRAME_S) {
          sim.step(FRAME_S, { brake: 1 });
          const W = sim.vehicle.wheels;
          rearC = Math.max(rearC, W[2].brakeDisc.surfaceTempC, W[3].brakeDisc.surfaceTempC);
        }
        out.push({ m: sim.sMeters - s0, rearC });
      }
      return out;
    };
    const visitor = stops(KIOSK_OFF, 0.2);
    const simple = stops(ENERGY_ONLY, 1);
    const line = (r: { m: number; rearC: number }[]) => r.map((x) => `${x.m.toFixed(1)} m/${x.rearC.toFixed(0)} °C`).join(', ');
    console.log(`      stock at the floor: ${line(visitor)}`);
    console.log(`      unlimitedEnergy:    ${line(simple)}`);
    // (The first is about 1 % longer: its rear discs start at 250 °C, under the pads' full grip from 400 °C, and do the
    // whole of the rear's braking there; the stock car's motor takes most of it)
    const worst = Math.max(...simple.map((x, i) => (x.m - visitor[i].m) / visitor[i].m));
    check(
      'eight stops in a row: each within 2 % of the stock car\'s, the last no longer than the first',
      worst < 0.02 && simple[7].m < 1.01 * simple[0].m,
      `at most ${(100 * worst).toFixed(2)} % longer; the eighth ${simple[7].m.toFixed(1)} m, rear discs up to ${Math.max(...simple.map((x) => x.rearC)).toFixed(0)} °C (stock ${Math.max(...visitor.map((x) => x.rearC)).toFixed(0)} °C)`
    );
  }

  console.log('\n== Cars without an energy store');
  {
    const gt3 = vehicleModelSpec('amg-gt3').createSim(pad, null);
    const ok = gt3 instanceof F12026CarSim;
    if (ok) {
      gt3.setSimRealism(KIOSK_ON);
      gt3.teleportToDistance(2000, 150 / 3.6);
      gt3.vehicle.ersEnergyJ = 0;
      for (let t = 0; t < 1; t += FRAME_S) gt3.step(FRAME_S, { throttle: 1 });
    }
    check('unlimitedEnergy leaves a car without ERS alone (the AMG GT3)', ok && gt3.vehicle.ersEnergyJ === 0, ok ? `store ${gt3.vehicle.ersEnergyJ} J` : 'not on the rigid-body engine');
  }

  console.log('\n== Straight Mode working itself (the flat pad is one long Straight Mode stretch)');
  {
    /** Drives with the same pedals; when the flaps first opened and first shut, and how they are at the end */
    const drive = (sim: F12026CarSim, seconds: number, inputs: Partial<ControlInputs>) => {
      let firstOpen: number | null = null;
      let firstShut: number | null = null;
      let openS = 0;
      for (let t = 0; t < seconds - 1e-9; t += FRAME_S) {
        sim.step(FRAME_S, inputs);
        if (sim.vehicle.drsOpen) {
          firstOpen ??= t + FRAME_S;
          openS += FRAME_S;
        } else firstShut ??= t + FRAME_S;
      }
      return { firstOpen, firstShut, openS, open: sim.vehicle.drsOpen };
    };
    const s = (v: number | null) => (v === null ? 'never' : `${v.toFixed(3)} s`);

    const stock = kioskCar(KIOSK_OFF, 200);
    check('without the flag: never open on full throttle (nobody pressed X)', drive(stock, 3, { throttle: 1 }).openS === 0);

    const sim = kioskCar(KIOSK_ON, 200);
    const a = drive(sim, 1, { throttle: 1 });
    check('with it: open by themselves on full throttle', a.open && a.firstOpen !== null && a.firstOpen <= 0.05, `after ${s(a.firstOpen)}`);
    const b = drive(sim, 0.5, { brake: 0.6 });
    check('shut on the brake', !b.open && b.openS === 0, `open ${b.openS.toFixed(3)} s after the brake went on`);
    const c = drive(sim, 1, { throttle: 1 });
    check('open again once back on the throttle', c.open && c.firstOpen !== null && c.firstOpen <= 0.05, `after ${s(c.firstOpen)}`);
    const d = drive(sim, 1, { throttle: 1, brake: 0.5 });
    const e = drive(sim, 1, { throttle: 1 });
    check('both pedals at once: shut, and open again once the brake is let go', !d.open && d.openS === 0 && e.open && e.firstOpen !== null && e.firstOpen <= 0.05, `after ${s(e.firstOpen)}`);
    const f = drive(sim, 0.3, { throttle: 0.2 });
    const g = drive(sim, 1, { throttle: 0.8 });
    const h = drive(sim, 1, { throttle: 1 });
    check("the autopilot's rule: shut on a lift, not opened on part throttle, opened on full", !f.open && g.openS === 0 && h.open, `opened ${s(h.firstOpen)} into full throttle`);
    // X still works: it shuts them (they stay shut until the throttle comes off and back), and opens them on part
    // throttle, which the automatic press does not
    const x = drive(sim, FRAME_S, { throttle: 1, toggleXMode: true });
    const xHeld = drive(sim, 0.5, { throttle: 1 });
    drive(sim, 0.2, { throttle: 0.2 });
    const xAgain = drive(sim, 0.5, { throttle: 1 });
    check('X still shuts them; after a lift they open by themselves again', !x.open && xHeld.openS === 0 && xAgain.open);
    drive(sim, 0.3, { throttle: 0.2 });
    drive(sim, 0.3, { throttle: 0.8 });
    const partX = drive(sim, FRAME_S, { throttle: 0.8, toggleXMode: true });
    const partHeld = drive(sim, 0.3, { throttle: 0.8 });
    check('X still opens them on part throttle', partHeld.open && (partX.open || partHeld.firstOpen !== null));
    // A press kept for the stretch (off the throttle there) is not taken back by the automatic one: a moment later on
    // full throttle the autopilot's press alone would be a second press, cancelling it
    drive(sim, 0.3, { throttle: 0.2 });
    drive(sim, FRAME_S, { throttle: 0.3, toggleXMode: true });
    drive(sim, 0.2, { throttle: 0.3 });
    const queued = sim.vehicle.telemetry.drsQueued;
    const kept = drive(sim, 0.5, { throttle: 1 });
    check('a press kept for the stretch is not taken back by the automatic one', queued && kept.open, `kept ${queued}, then open after ${s(kept.firstOpen)}`);
    const none = kioskCar(KIOSK_ON, 200);
    none.setOvertakingRules('none');
    check('never where the flaps may not open (no flaps fitted)', drive(none, 2, { throttle: 1 }).openS === 0);

    // Where a stretch ends, flat out (a driver who never brakes there): a pad whose curvature marks a 300 m bend while
    // its road stays straight, so the car needs no steering. The bend is clear of the circuit data's own zones, which
    // every car carries as fractions of a lap (the default circuit's here)
    const bendPad = createFlatTestTrack(12_000, 600, 2400);
    const lapM = bendPad.totalLengthM;
    const BEND_M = 300;
    const inDataZone = (m: number) => RWANDA_DRS_ZONES.some((z) => inLapWindow(m / lapM, z.start, z.end));
    let bendAt = 2000;
    while (bendAt < lapM - 2000 && [0, 0.25, 0.5, 0.75, 1].some((k) => inDataZone(bendAt + k * BEND_M))) bendAt += 100;
    for (const sample of bendPad.samples) if (sample.s >= bendAt && sample.s < bendAt + BEND_M) sample.curvature = 1 / 150;
    const bendCar = createLc26Sim(bendPad, null);
    bendCar.assistPreset = 'assisted';
    bendCar.autoGearbox = true;
    bendCar.setOvertakingRules('straight-mode-2026');
    bendCar.setSimRealism(KIOSK_ON);
    bendCar.teleportToDistance(bendAt - 600, 220 / 3.6);
    let openBefore = false;
    let shutAt: number | null = null;
    // How far into the bend they were still open (m), and where they opened again after it
    let openInBendM = 0;
    let reopenedAt: number | null = null;
    for (let t = 0; t < 20 && bendCar.sMeters < bendAt + BEND_M + 200; t += FRAME_S) {
      bendCar.step(FRAME_S, { throttle: 1 });
      const m = bendCar.sMeters;
      const open = bendCar.vehicle.drsOpen;
      if (m < bendAt - 20 && open) openBefore = true;
      if (openBefore && !open) shutAt ??= m;
      if (m >= bendAt && m < bendAt + BEND_M && open) openInBendM = Math.max(openInBendM, m - bendAt);
      if (m >= bendAt + BEND_M && open) reopenedAt ??= m;
    }
    check(
      'flat out to the end of a stretch: shut where it ends, open again on the next',
      openBefore && shutAt !== null && shutAt > bendAt - 20 && openInBendM < 2 && reopenedAt !== null && reopenedAt - (bendAt + BEND_M) < 10,
      `bend ${bendAt}-${bendAt + BEND_M} m: shut at ${shutAt?.toFixed(1) ?? 'never'} m, open ${openInBendM.toFixed(1)} m into it at most, open again at ${reopenedAt?.toFixed(1) ?? 'never'} m`
    );
  }

  console.log('\n== Through the simulation worker (its messages cloned as postMessage clones them)');
  {
    // The kiosk's engine for the LC26 (the scripts' default too)
    setLc26OnRigidBody(true);
    const track = getActiveTrackData(1200);
    const viaWorker = (flags: Readonly<SimRealismFlags>, seconds: number) => {
      const loop = loopbackTransport();
      const host = createSimHost(loop.transport, loop.wallNowMs);
      const twin = vehicleModelSpec('lc26').createSim(track, null);
      const car = host.adopt(twin, 'lc26');
      car.aiAutopilot = false;
      car.assistPreset = 'assisted';
      car.gamepadAssistEnabled = true;
      car.autoGearbox = true;
      car.resetToStartGrid(false);
      // As on the page: the session's flags on the track environment, which hands them to the car on its update
      const env = new TrackEnvironment(track);
      env.setSimRealism(flags);
      host.endFrame(true);
      let socMin = 1;
      for (let t = 0; t < seconds; t += FRAME_S) {
        env.update(FRAME_S, [car]);
        car.step(FRAME_S, { throttle: 1 });
        loop.advance(FRAME_S);
        host.endFrame(true);
        socMin = Math.min(socMin, car.ersEnergyJ / MAX);
      }
      const sim = loop.runtime.simulatedCar;
      const rigid = sim instanceof F12026CarSim;
      const own = rigid ? (sim as unknown as { realism: SimRealismFlags }).realism : null;
      const result = {
        // The worker drove: its car is where the game reads it, the page's own stood still
        remote: host.remote && sim !== null && Math.abs(sim.sMeters - car.sMeters) < 1 && Math.abs(twin.vxMs) < 0.5 && sim.telemetry.speedKmh > 100,
        rigid,
        socMin,
        own,
        physics: rigid ? sim.vehicle.realism : null,
        kmh: car.telemetry.speedKmh,
      };
      host.dispose();
      return result;
    };
    const on = viaWorker(KIOSK_ON, 6);
    check('the worker drives the kiosk\'s car, on the rigid-body engine', on.remote && on.rigid, kmh(on.kmh));
    check('the flags reach its car whole', on.own !== null && simpleOn(on.own) && on.physics !== null && simpleOn(on.physics) && on.own.tyreWearScale === 0);
    const off = viaWorker(KIOSK_OFF, 6);
    check('its store stays full flat out from the grid, where the stock car\'s runs down', on.socMin > 0.9999 && off.socMin < 0.95, `lowest ${pct(on.socMin)} against ${pct(off.socMin)} (${kmh(on.kmh)} / ${kmh(off.kmh)} after 6 s)`);
    check('and without them it has neither', off.own !== null && simpleOff(off.own));
  }

  console.log(`\n${failures.length === 0 ? 'All kiosk simple-drive checks passed' : `${failures.length} failed:\n  ${failures.join('\n  ')}`} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  if (failures.length > 0) process.exit(1);
}

void main();
