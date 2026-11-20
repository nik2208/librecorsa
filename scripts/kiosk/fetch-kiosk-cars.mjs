// The kiosk's extra cars, fetched from librecorsa.org when the game is built: the MTRacing 496R and the LC-LMDH. Their
// files are not in the repository (.gitignore ignores public/cars/ but for the 2026 prototype): the 496R's maker gave
// LibreCorsa, not this fork, permission to use it, and the LC-LMDH's sound has no licence on record, so this branch
// doesn't republish them. The LC-LMDH's body is CC BY 4.0 (credited in CREDITS.md and in the kiosk's credits).
//
//   node scripts/kiosk/fetch-kiosk-cars.mjs                  # `npm run build` runs it first (prebuild)
//   node scripts/kiosk/fetch-kiosk-cars.mjs --lock           # record what librecorsa.org serves now in the lock
//   node scripts/kiosk/fetch-kiosk-cars.mjs --lock --force   # ... even a car body that changed (check its dress!)
//
// Every file is checked against kiosk-cars.lock.json (size and SHA-256), then the car gets the event's dress: other
// companies' marks off and Applikat's on (MTR 496R), Applikat's colours (LC-LMDH). A complete car gets
// public/cars/<id>/.kiosk-ready, and next.config.ts lists only those. A car this run leaves out (KIOSK_CARS, no network,
// a file that changed on librecorsa.org) has its folder removed, so it is neither listed nor shipped; the build goes on
// without it. As prebuild this script never fails the build; --lock fails loudly.
//
// KIOSK_CARS narrows the set (a comma list, or "none"); KIOSK_CARS_BASE changes where the files come from.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { art, CARBON, clear, clone, CREAM, disc, editGlb, fill, item, linear, RIBBON, ringClone, sidewall, STICKER } from './glb-art.mjs';

export const LOCK = 'scripts/kiosk/kiosk-cars.lock.json';
const BASE = (process.env.KIOSK_CARS_BASE ?? 'https://librecorsa.org').replace(/\/$/, '');
/** Part of every car's stamp: bump it for a change the stamp can't see (the stamp already covers the lock entry, the
 * car's dress and glb-art.mjs) */
export const VERSION = 'scripts/kiosk/fetch-kiosk-cars.mjs v2';
/** Plain white lettering, for small marks where the livery's outlined lettering would read grey */
const WHITE = { paint: [245, 245, 245], opacity: 1 };
/** One request's limit; a timed-out request isn't tried again (librecorsa.org is then too slow for this build) */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The 496R's marks, by material and texture slot (every picture of the car was looked at, and which ones its meshes
 * show was checked; generic cockpit labels stay):
 *   tyre, tyre#normalTexture  a tyre maker's logos and mascot on the sidewalls, and its lettering moulded in the
 *                         rubber (the normal map's relief)                          -> plain rubber
 *   interior_decals       cockpit stickers of a car maker, engine, electronics, extinguisher, harness and seat makers,
 *                         the brake maker and the car's own team -> taken off
 *   chassis_panels/plastic a suspension maker's mark                                 -> the panel's colour
 *   door_decals           the car's team name on the number boards and doors         -> APPLIKAT
 *   sunstrip_decal        the team's name across the windscreen                      -> the sticker and applikat.it
 *   rear_suspension_decal a parody of a damper maker's badge                         -> taken off
 *   fuel_filler_badge     a coupling maker's fuel-filler disc, a team's and a wheel maker's plates
 *                                                                                    -> the sticker, APPLIKAT, applikat.it
 *   brake_disc            a car maker's and its brakes' names on the disc's bell     -> the bell's own pattern
 *   hub_mechanics         a parody of a brake maker's logo on the hubs (and, not shown on any mesh, a federation's
 *                         logo and a parts maker's name)                             -> taken off
 */
const MTR_EDITS = {
  tyre: [sidewall(512, 512, 300, 484, [230, 255, 560, 505])],
  'tyre#normalTexture': [sidewall(256, 256, 150, 242, [115, 128, 280, 252])],
  interior_decals: [
    clear(140, 0, 445, 42),
    clear(726, 0, 160, 40),
    clear(0, 36, 60, 232),
    clear(676, 42, 170, 76),
    clear(846, 54, 52, 202),
    clear(896, 50, 120, 92),
    clear(514, 40, 66, 80),
    clear(538, 118, 114, 244),
    clear(226, 196, 104, 206),
    clear(346, 366, 368, 42),
    clear(378, 458, 266, 50),
    clear(660, 436, 364, 76),
    // The seat's homologation label (its maker's name in small print)
    clear(278, 54, 56, 144),
  ],
  chassis_panels: [fill(622, 464, 74, 34, [612, 480])],
  chassis_plastic: [fill(622, 464, 74, 34, [612, 480])],
  door_decals: [
    // The number boards' bands (the upper board is the other door's, upside down)
    fill(300, 325, 272, 85, [305, 330]),
    art(300, 325, 272, 85, { pad: 10, items: [item('letters', 56, 'light', 180)] }),
    fill(300, 612, 272, 86, [305, 616]),
    art(300, 612, 272, 86, { pad: 10, items: [item('letters', 56, 'light')] }),
    // The small names on the doors
    clear(626, 118, 166, 42),
    art(626, 118, 166, 42, { pad: 4, over: true, items: [item('letters', 30, WHITE, 180)] }),
    clear(626, 862, 166, 42),
    art(626, 862, 166, 42, { pad: 4, over: true, items: [item('letters', 30, WHITE)] }),
  ],
  sunstrip_decal: [
    clone(230, 60, 230, 135, 0, 60),
    clone(460, 60, 230, 135, 0, 60),
    clone(690, 60, 120, 135, 0, 60),
    art(0, 0, 1024, 256, { pad: 24, gap: 26, items: [STICKER(112), item('site', 84)] }),
  ],
  rear_suspension_decal: [clear(446, 398, 136, 64)],
  fuel_filler_badge: [
    disc(392, 113, 100, [330, 70]),
    art(312, 33, 160, 160, { items: [STICKER(150)] }),
    fill(219, 238, 293, 92, [222, 242]),
    art(219, 238, 293, 92, { pad: 10, items: [item('letters', 48, 'dark')] }),
    fill(210, 351, 215, 51, [214, 355]),
    art(210, 351, 215, 51, { pad: 6, items: [item('site', 30, 'dark')] }),
  ],
  // The bell's ring repeats every 30° (its bolts): each name takes the ring from a clean stretch a multiple of 30° away
  brake_disc: [ringClone(256, 256, 124, 172, -114, -30, 180), ringClone(256, 256, 124, 172, 22, 70, 60)],
  // Shared with hub_mechanics_detail: one edit covers both
  hub_mechanics: [clear(296, 424, 200, 54), clear(252, 330, 166, 32), clear(414, 296, 98, 70), clear(252, 362, 256, 48)],
};

/** The cars this branch offers, with their dress */
export const CARS = {
  'mtr-496r': { edits: MTR_EDITS },
  // No marks on it (LibreCorsa took them off): the livery's colours, as on the 2026 prototype
  'lc-lmdh': { colours: { paint_primary: linear(RIBBON), paint_accent: linear(CREAM), paint_secondary: linear(CARBON) } },
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** One file from librecorsa.org; a network error is tried twice more, a timeout or an HTTP error isn't */
async function get(path, { optional = false } = {}) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE}/${path}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (e) {
      last = e;
      if (e?.name === 'TimeoutError') break;
      continue;
    }
    if (res.status === 404 && optional) return null;
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    try {
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      last = e;
      if (e?.name === 'TimeoutError') break;
    }
  }
  throw new Error(`${path}: ${last?.message ?? last}`);
}

/**
 * Runs `fn` over `items`, `n` at a time. After the first failure no new item starts, and the call waits for the ones
 * under way before it rethrows: once it returns, nothing is still writing (a caller can clean up for good)
 */
async function pool(items, n, fn) {
  const out = [];
  let next = 0;
  let failure = null;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (!failure && next < items.length) {
        const i = next++;
        try {
          out[i] = await fn(items[i]);
        } catch (e) {
          failure ??= e;
        }
      }
    }),
  );
  if (failure) throw failure;
  return out;
}

/** A lock path, checked: inside its car's folder, plain names only */
function checkedPath(id, path) {
  const prefix = `cars/${id}/`;
  const rest = typeof path === 'string' && path.startsWith(prefix) ? path.slice(prefix.length) : null;
  if (!rest || !rest.split('/').every((part) => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..'))
    throw new Error(`${path}: not a plain path inside cars/${id}/`);
  return rest;
}

/** --lock: every file each car needs, as librecorsa.org serves it now */
async function writeLock({ force }) {
  let old = { cars: {} };
  try {
    old = JSON.parse(readFileSync(LOCK, 'utf8'));
  } catch {
    // No lock yet
  }
  const cars = {};
  for (const id of Object.keys(CARS)) {
    const paths = [`cars/${id}/model/${id}.glb`, `cars/${id}/audio/manifest.json`];
    const manifest = JSON.parse((await get(paths[1])).toString('utf8'));
    const sounds = new Set();
    JSON.stringify(manifest, (k, v) => (k === 'file' && typeof v === 'string' ? (sounds.add(v), v) : v));
    paths.push(...[...sounds].sort().map((f) => `cars/${id}/audio/${f}`));
    for (const p of paths) checkedPath(id, p);
    const files = await pool(paths, 6, async (path) => {
      const buf = await get(path);
      return { path, size: buf.length, sha256: sha256(buf) };
    });
    const thumb = await get(`cars/${id}/thumb.webp`, { optional: true });
    if (thumb) files.push({ path: `cars/${id}/thumb.webp`, size: thumb.length, sha256: sha256(thumb) });
    // The dress is pixel positions on today's pictures: a body that changed needs its dress checked again first
    const body = (entry) => entry?.files?.find((f) => f.path === `cars/${id}/model/${id}.glb`)?.sha256;
    if (CARS[id].edits && body(old.cars?.[id]) && body(old.cars[id]) !== body({ files }) && !force)
      throw new Error(`${id}: its body changed on librecorsa.org; check MTR_EDITS against the new pictures, then run with --force`);
    cars[id] = { files };
    console.log(`${id}: ${files.length} files, ${(files.reduce((s, f) => s + f.size, 0) / 1048576).toFixed(1)} MiB`);
  }
  writeFileSync(LOCK, `${JSON.stringify({ base: BASE, cars }, null, 1)}\n`);
  console.log(`${LOCK} written`);
}

const GLB_ART = fileURLToPath(new URL('./glb-art.mjs', import.meta.url));
/** The content of a car's .kiosk-ready: changes when its files, its dress or the code that dresses it does */
export const stampOf = (id, entry) =>
  `${VERSION}\n${sha256(JSON.stringify(entry))}\n${sha256(JSON.stringify(CARS[id] ?? null))}\n${sha256(readFileSync(GLB_ART))}\n`;

/** Fetches and dresses one car; true when it is ready. Never throws */
async function fetchCar(id, entry) {
  const dir = `public/cars/${id}`;
  const part = `public/cars/.${id}.part`;
  try {
    const stamp = stampOf(id, entry);
    const ready = join(dir, '.kiosk-ready');
    if (existsSync(ready) && readFileSync(ready, 'utf8') === stamp) {
      console.log(`${id}: already fetched and dressed`);
      return true;
    }
    rmSync(part, { recursive: true, force: true });
    const root = resolve(part);
    await pool(entry.files, 6, async (f) => {
      const to = resolve(root, checkedPath(id, f.path));
      if (!to.startsWith(root + sep)) throw new Error(`${f.path}: outside ${part}`);
      const buf = await get(f.path);
      if (buf.length !== f.size || sha256(buf) !== f.sha256) throw new Error(`${f.path} is not the file recorded in ${LOCK}`);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, buf);
    });
    const car = CARS[id];
    await editGlb(join(part, 'model', `${id}.glb`), car.edits ?? {}, {
      mark: VERSION,
      markKey: 'kioskDress',
      colours: car.colours ?? {},
      log: (s) => console.log(`  ${s}`),
    });
    writeFileSync(join(part, '.kiosk-ready'), stamp);
    rmSync(dir, { recursive: true, force: true });
    renameSync(part, dir);
    console.log(`${id}: ready (${entry.files.length} files)`);
    return true;
  } catch (e) {
    console.warn(`${id}: left out of this build (${e?.message ?? e})`);
    return false;
  } finally {
    rmSync(part, { recursive: true, force: true });
  }
}

/** The build's step: every car of this branch ready, or gone */
async function fetchAll() {
  const wanted = new Set(
    (process.env.KIOSK_CARS ?? Object.keys(CARS).join(','))
      .split(',')
      .map((s) => s.trim())
      .filter((id) => id && id !== 'none'),
  );
  for (const id of wanted) if (!CARS[id]) console.warn(`${id}: not one of this kiosk's extra cars`);
  let lock = { cars: {} };
  try {
    lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  } catch (e) {
    console.warn(`${LOCK}: ${e.message}`);
  }
  for (const id of Object.keys(CARS)) {
    const ok = wanted.has(id) && lock.cars?.[id] ? await fetchCar(id, lock.cars[id]) : false;
    if (ok) continue;
    if (!wanted.has(id)) console.log(`${id}: not wanted in this build (KIOSK_CARS)`);
    // Neither listed (no .kiosk-ready) nor shipped (no files in out/)
    rmSync(`public/cars/${id}`, { recursive: true, force: true });
  }
}

// Run as a script (npm's prebuild, or by hand); imported by scripts/verify-kiosk-cars.ts for its lists
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.includes('--lock')) {
    await writeLock({ force: process.argv.includes('--force') });
  } else {
    try {
      await fetchAll();
    } catch (e) {
      console.warn(`kiosk cars: none in this build (${e?.message ?? e})`);
    }
  }
}
