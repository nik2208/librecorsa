/**
 * The kiosk's extra cars (event branch): the cars a kiosk build fetches from librecorsa.org and dresses for the event
 * before `next build` (scripts/kiosk/fetch-kiosk-cars.mjs, npm's `prebuild`), and how a build lists them.
 *   - the same ids everywhere: the fetch script and its lock, next.config.ts, the kiosk's car list, its server;
 *   - a build lists a fetched car only when it names it (NEXT_PUBLIC_KIOSK_FETCHED_CARS, from next.config.ts), and the
 *     full game's listing is what it was;
 *   - the lock names every file a car loads: its body, its sound manifest and every sound the manifest lists;
 *   - with librecorsa.org out of reach the fetch leaves the cars out, exits 0 and leaves no half-written folder;
 *   - a car fetched into this copy matches its lock and wears the event's dress.
 *
 * Run: node scripts/run-verify.mjs kiosk-cars
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { KIOSK_CARS } from '../src/lib/kiosk/kiosk-types';

/** The 2026 Prototype, the car every build has (its id is lc26 since upstream's rename, vf26 before) */
const PROTOTYPE: string = KIOSK_CARS[0].id;

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(76)} ${detail}`);
  if (!ok) failures.push(name);
};
const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');
/** A child's environment with nothing of this run's (run-verify sets NEXT_PUBLIC_HOSTED_CONTENT=1) but PATH and HOME */
const cleanEnv = (extra: Record<string, string> = {}) =>
  ({ PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...extra }) as unknown as NodeJS.ProcessEnv;
type LockFile = { path: string; size: number; sha256: string };
type Lock = { base: string; cars: Record<string, { files: LockFile[] }> };

/** A scratch copy of the fetch (the script, glb-art, a lock, the game's node_modules) to run against a fake server */
function scratch(lock?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'kiosk-cars-'));
  mkdirSync(join(dir, 'scripts/kiosk'), { recursive: true });
  mkdirSync(join(dir, 'public/cars'), { recursive: true });
  for (const f of ['fetch-kiosk-cars.mjs', 'glb-art.mjs', 'kiosk-cars.lock.json']) copyFileSync(join('scripts/kiosk', f), join(dir, 'scripts/kiosk', f));
  if (lock) writeFileSync(join(dir, 'scripts/kiosk/kiosk-cars.lock.json'), JSON.stringify(lock));
  symlinkSync(join(process.cwd(), 'node_modules'), join(dir, 'node_modules'));
  return dir;
}

/** Runs the fetch in `dir` without blocking this process (a fake server here must keep answering) */
function runFetch(dir: string, env: Record<string, string>): Promise<{ status: number | null; out: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, ['scripts/kiosk/fetch-kiosk-cars.mjs'], { cwd: dir, env: cleanEnv(env) });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('close', (status) => {
      clearTimeout(timer);
      done({ status, out });
    });
  });
}

/** Every file under `dir`, relative, hidden ones too */
function listAll(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listAll(join(dir, e.name), base) : [join(dir, e.name).slice(base.length + 1)]
  );
}

function glbJson(file: string) {
  const b = readFileSync(file);
  const n = b.readUInt32LE(12);
  return { json: JSON.parse(b.subarray(20, 20 + n).toString('utf8')), bin: b.subarray(28 + n) };
}

async function main() {
  const fetchModule = (await import('./kiosk/fetch-kiosk-cars.mjs')) as {
    CARS: Record<string, { edits?: unknown; colours?: Record<string, number[]> }>;
    VERSION: string;
    LOCK: string;
    stampOf: (id: string, entry: { files: LockFile[] }) => string;
  };
  const fetched = Object.keys(fetchModule.CARS).sort();
  const lock = JSON.parse(readFileSync(fetchModule.LOCK, 'utf8')) as Lock;

  console.log('== The same cars everywhere');
  {
    const nextConfig = readFileSync('next.config.ts', 'utf8');
    const inNext = [...(nextConfig.match(/KIOSK_EXTRA_CARS = \[([^\]]*)\]/)?.[1] ?? '').matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]).sort();
    const server = readFileSync('kiosk/server.mjs', 'utf8');
    const inServer = [...(server.match(/const CAR_IDS = \[([^\]]*)\]/)?.[1] ?? '').matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
    const kiosk = KIOSK_CARS.map((c) => c.id as string);
    check('the fetch script and next.config.ts name the same cars', JSON.stringify(inNext) === JSON.stringify(fetched), fetched.join(', '));
    check('the lock has each of them, and nothing else', JSON.stringify(Object.keys(lock.cars).sort()) === JSON.stringify(fetched), Object.keys(lock.cars).join(', '));
    check('the kiosk lists each of them, as an extra', fetched.every((id) => KIOSK_CARS.some((c) => c.id === id && c.extra)), kiosk.join(', '));
    check('the kiosk server takes each of them', fetched.every((id) => inServer.includes(id)) && inServer.includes(PROTOTYPE), inServer.join(', '));
    check('each has a plain label of its own', fetched.every((id) => /^[A-Z][\w ]+$/.test(KIOSK_CARS.find((c) => c.id === id)?.label ?? '')),
      fetched.map((id) => KIOSK_CARS.find((c) => c.id === id)?.label).join(', '));
  }

  console.log('\n== What a build lists (src/lib/hosted-content.ts)');
  {
    const probe = (env: Record<string, string>) =>
      execFileSync(process.execPath, ['--import', 'tsx', '-e', `const h = require(${JSON.stringify(join(process.cwd(), 'src/lib/hosted-content.ts'))}); console.log(JSON.stringify(${JSON.stringify([PROTOTYPE, ...fetched])}.map((id) => h.carListed(id))))`], {
        env: cleanEnv(env),
        encoding: 'utf8',
      }).trim();
    const ids = [PROTOTYPE, ...fetched].join(', ');
    check('a build without the fetched cars lists the Prototype only', probe({}) === JSON.stringify([true, ...fetched.map(() => false)]), `${ids}: ${probe({})}`);
    const all = probe({ NEXT_PUBLIC_KIOSK_FETCHED_CARS: fetched.join(',') });
    check('a build that fetched them lists them', all === JSON.stringify([true, ...fetched.map(() => true)]), `${ids}: ${all}`);
    if (fetched.length > 1) {
      const one = probe({ NEXT_PUBLIC_KIOSK_FETCHED_CARS: fetched[0] });
      check('... only the ones it fetched', one === JSON.stringify([true, true, ...fetched.slice(1).map(() => false)]), `${ids}: ${one}`);
    }
    const hosted = probe({ NEXT_PUBLIC_HOSTED_CONTENT: '1' });
    check('the full game with the hosted content lists them as before', hosted === JSON.stringify([true, ...fetched.map(() => true)]), `${ids}: ${hosted}`);
  }

  console.log('\n== The lock');
  for (const id of fetched) {
    const files = lock.cars[id]?.files ?? [];
    const paths = new Set(files.map((f) => f.path));
    const wellFormed = files.every((f) => f.path.startsWith(`cars/${id}/`) && !f.path.includes('..') && f.size > 0 && /^[0-9a-f]{64}$/.test(f.sha256));
    check(`${id}: body and sound manifest, every entry inside its folder`, paths.has(`cars/${id}/model/${id}.glb`) && paths.has(`cars/${id}/audio/manifest.json`) && wellFormed,
      `${files.length} files, ${(files.reduce((s, f) => s + f.size, 0) / 1048576).toFixed(1)} MiB`);
    const manifestFile = `public/cars/${id}/audio/manifest.json`;
    if (existsSync(manifestFile)) {
      const sounds = new Set<string>();
      JSON.stringify(JSON.parse(readFileSync(manifestFile, 'utf8')), (k, v) => (k === 'file' && typeof v === 'string' ? (sounds.add(v), v) : v));
      const missing = [...sounds].filter((f) => !paths.has(`cars/${id}/audio/${f}`));
      check(`${id}: every sound its manifest lists`, missing.length === 0, missing.length ? `missing ${missing.slice(0, 3).join(', ')}` : `${sounds.size} sounds`);
    } else {
      console.log(`SKIP  ${id}: not fetched into this copy, its manifest not checked`);
    }
  }

  console.log('\n== librecorsa.org out of reach');
  {
    const dir = scratch();
    try {
      // Port 9 (discard): nothing answers, every request fails at once
      const run = spawnSync(process.execPath, ['scripts/kiosk/fetch-kiosk-cars.mjs'], {
        cwd: dir,
        env: cleanEnv({ KIOSK_CARS_BASE: 'http://127.0.0.1:9' }),
        encoding: 'utf8',
        timeout: 120_000,
      });
      const left = readdirSync(join(dir, 'public/cars'));
      check('the build goes on: the script exits 0', run.status === 0, `exit ${run.status}`);
      check('each car is reported left out', fetched.every((id) => (run.stderr ?? '').includes(`${id}: left out of this build`)), (run.stderr ?? '').trim().split('\n').join(' | ').slice(0, 140));
      check('no car folder and no half-written one is left', left.length === 0, left.join(', ') || 'public/cars/ empty');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log('\n== One file fails while the others are still coming');
  {
    // A fake car of twelve files; the fake server answers each after 300 ms, and the fourth with an HTTP 500
    const id = fetched[0];
    const files = Array.from({ length: 12 }, (_, i) => {
      const body = Buffer.from(`file ${i} of the fake ${id}\n`.repeat(200 + i));
      return { path: i === 0 ? `cars/${id}/model/${id}.glb` : `cars/${id}/audio/sound_${i}.ogg`, size: body.length, sha256: sha256(body), body };
    });
    const served: string[] = [];
    const server = createServer((req, res) => {
      const f = files.find((x) => `/${x.path}` === req.url);
      served.push(req.url ?? '');
      setTimeout(() => {
        if (!f || f === files[3]) {
          res.statusCode = f ? 500 : 404;
          res.end();
        } else res.end(f.body);
      }, 300);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as AddressInfo).port;
    const dir = scratch({ base: 'fake', cars: { [id]: { files: files.map(({ body: _b, ...f }) => f) } } });
    try {
      const run = await runFetch(dir, { KIOSK_CARS_BASE: `http://127.0.0.1:${port}`, KIOSK_CARS: id });
      const left = listAll(join(dir, 'public'));
      check('the build goes on, the car left out', run.status === 0 && run.out.includes(`${id}: left out of this build`), `exit ${run.status}`);
      check('nothing half-written left once the downloads under way end', left.length === 0, left.slice(0, 4).join(', ') || `public/ empty, ${served.length} of ${files.length} files asked for`);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log('\n== A car this run leaves out is not left listed');
  {
    const id = fetched[0];
    const dir = scratch();
    try {
      const plant = () => {
        mkdirSync(join(dir, `public/cars/${id}/model`), { recursive: true });
        writeFileSync(join(dir, `public/cars/${id}/.kiosk-ready`), 'an older dress\n');
        writeFileSync(join(dir, `public/cars/${id}/model/${id}.glb`), 'an older body');
      };
      plant();
      const none = await runFetch(dir, { KIOSK_CARS: 'none', KIOSK_CARS_BASE: 'http://127.0.0.1:9' });
      check('KIOSK_CARS=none takes away a car an earlier build fetched', none.status === 0 && !existsSync(join(dir, `public/cars/${id}`)), `exit ${none.status}`);
      plant();
      const offline = await runFetch(dir, { KIOSK_CARS_BASE: 'http://127.0.0.1:9' });
      check('a refresh that fails takes the old copy away too', offline.status === 0 && !existsSync(join(dir, `public/cars/${id}`)), `exit ${offline.status}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log('\n== A lock path that leaves the car\'s folder');
  {
    const id = fetched[0];
    const body = Buffer.from('not a car');
    const dir = scratch({ base: 'fake', cars: { [id]: { files: [{ path: `cars/${id}/../../../escaped.txt`, size: body.length, sha256: sha256(body) }] } } });
    const server = createServer((_req, res) => res.end(body));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const run = await runFetch(dir, { KIOSK_CARS_BASE: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, KIOSK_CARS: id });
      const written = listAll(dir).filter((f) => f.includes('escaped'));
      check('refused: the car left out, nothing written outside', run.status === 0 && run.out.includes('not a plain path') && written.length === 0, written.join(', ') || 'nothing written');
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log('\n== The cars fetched into this copy');
  for (const id of fetched) {
    const dir = `public/cars/${id}`;
    if (!existsSync(join(dir, '.kiosk-ready'))) {
      console.log(`SKIP  ${id}: not fetched into this copy (npm run build, or node scripts/kiosk/fetch-kiosk-cars.mjs)`);
      continue;
    }
    const entry = lock.cars[id];
    check(`${id}: .kiosk-ready matches the lock and this version of the dress`, readFileSync(join(dir, '.kiosk-ready'), 'utf8') === fetchModule.stampOf(id, entry));
    const others = entry.files.filter((f) => !f.path.endsWith(`/model/${id}.glb`));
    const bad = others.filter((f) => {
      const p = join('public', f.path);
      return !existsSync(p) || sha256(readFileSync(p)) !== f.sha256;
    });
    check(`${id}: every file but the body is the one in the lock`, bad.length === 0, bad.length ? `differ: ${bad.slice(0, 3).map((f) => f.path).join(', ')}` : `${others.length} files`);
    const { json, bin } = glbJson(join(dir, 'model', `${id}.glb`));
    check(`${id}: the body wears the event's dress`, json.asset?.extras?.kioskDress === fetchModule.VERSION, String(json.asset?.extras?.kioskDress));
    const colours = fetchModule.CARS[id].colours ?? {};
    const wrong = Object.entries(colours).filter(([name, factor]) => {
      const m = (json.materials ?? []).find((x: { name?: string }) => x.name === name);
      return JSON.stringify(m?.pbrMetallicRoughness?.baseColorFactor) !== JSON.stringify(factor);
    });
    if (Object.keys(colours).length) check(`${id}: its paint in the livery's colours`, wrong.length === 0, Object.keys(colours).join(', '));
    if (id === 'mtr-496r') {
      type Mat = { name?: string; normalTexture?: { index: number }; pbrMetallicRoughness?: { baseColorTexture?: { index: number } } };
      const material = (name: string) => (json.materials as Mat[]).find((m) => m.name === name) as Mat;
      const picture = (index: number) => {
        const view = json.bufferViews[json.images[json.textures[index].source].bufferView];
        return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
      };
      const rgba = async (index: number) => sharp(picture(index)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      // The tyre maker's logos were the only saturated colours on the sidewall (yellow mascot, blue band)
      {
        const { data, info } = await rgba(material('tyre').pbrMetallicRoughness!.baseColorTexture!.index);
        let vivid = 0;
        for (let i = 0; i < data.length; i += 4) if (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 60) vivid++;
        check('mtr-496r: no logo colour left on the tyres', vivid < 50, `${vivid} vivid pixels of ${info.width * info.height}`);
      }
      // The lettering moulded in the sidewall was relief in the normal map: now each radius is one slope, give or take
      // the rubber's grain
      {
        const { data, info } = await rgba(material('tyre').normalTexture!.index);
        const bins = new Map<number, number[]>();
        for (let y = 0; y < info.height; y++)
          for (let x = 0; x < info.width; x++) {
            const r = Math.round(Math.hypot(x - 256, y - 256));
            if (r < 160 || r > 236 || (x >= 115 && y >= 128 && x < 395 && y < 380)) continue;
            const o = (y * info.width + x) * 4;
            if (!bins.has(r)) bins.set(r, []);
            bins.get(r)!.push(data[o], data[o + 1]);
          }
        let worst = 0;
        for (const v of bins.values()) {
          const mean = v.reduce((a, b) => a + b, 0) / v.length;
          worst = Math.max(worst, Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length));
        }
        check('mtr-496r: no lettering moulded in the tyres (normal map)', worst < 6, `largest spread at one radius ${worst.toFixed(1)}`);
      }
      // The disc's bell: the names were light lettering on the dark ring, between its bolts
      {
        const { data, info } = await rgba(material('brake_disc').pbrMetallicRoughness!.baseColorTexture!.index);
        const light = (r0: number, r1: number, a0: number, a1: number) => {
          let n = 0;
          for (let y = 0; y < info.height; y++)
            for (let x = 0; x < info.width; x++) {
              const r = Math.hypot(x - 256, y - 256);
              const a = (Math.atan2(y - 256, x - 256) * 180) / Math.PI;
              const o = (y * info.width + x) * 4;
              if (r >= r0 && r <= r1 && a >= a0 && a <= a1 && (data[o] + data[o + 1] + data[o + 2]) / 3 > 80) n++;
            }
          return n;
        };
        const names = light(138, 162, -108, -36) + light(128, 160, 32, 60);
        check('mtr-496r: no names left on the brake discs', names < 20, `${names} light pixels where the names were`);
      }
      // The hubs' brake-maker logo was a decal on a transparent sheet: gone, colour and all
      {
        const { data, info } = await rgba(material('hub_mechanics').pbrMetallicRoughness!.baseColorTexture!.index);
        let kept = 0;
        for (let y = 424; y < 478; y++) for (let x = 296; x < 496; x++) if (data[(y * info.width + x) * 4 + 3] > 0) kept++;
        check('mtr-496r: no logo left on the hubs', kept === 0, `${kept} opaque pixels where it was`);
      }
      // Lossless PNGs (sharp's palette mode would have posterised the decal sheets)
      {
        const pngs = (json.images as { mimeType?: string; bufferView: number }[])
          .map((im, i) => ({ im, i }))
          .filter(({ im }) => im.mimeType === 'image/png')
          .map(({ im, i }) => {
            const v = json.bufferViews[im.bufferView];
            return { i, type: bin[(v.byteOffset ?? 0) + 25] };
          });
        const palette = pngs.filter((p) => p.type === 3);
        check('mtr-496r: its edited PNGs are not quantised to a palette', palette.length === 0, palette.length ? `palette: pictures ${palette.map((p) => p.i).join(', ')}` : `${pngs.length} PNGs`);
      }
    }
  }

  console.log(failures.length ? `\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}` : '\nAll kiosk car checks passed');
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
