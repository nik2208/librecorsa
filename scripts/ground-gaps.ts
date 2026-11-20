/**
 * Where a circuit's physics ground parts from the ground it draws. Every spot a car can reach (a grid flooded out from
 * the centreline over the drawn ground, stopped only by the barrier colliders, as a car sliding off the road is) is
 * asked for the height the cars drive on (the track colliders, built as the game builds them) and compared with the
 * height of the surface on screen (scripts/lib/drawn-ground.ts). Three kinds of fault are listed:
 *  - the ground ends: the physics stops short of the drawn ground with no barrier in between, and a car driving on
 *    falls through what it sees (the lost-car rescue picks it up 15 m down);
 *  - holes: small patches with no physics ground, inside it;
 *  - offsets: patches where the physics is more than `--tol` under (the car sinks into the drawn ground) or over it.
 *
 *   node --import tsx scripts/ground-gaps.ts [--track monza] [--grid 1] [--reach 60] [--tol 0.05] [--json out.json]
 *
 * The flood climbs or drops at most MAX_DRAWN_STEP_M between neighbouring cells (no car drives up a wall face or off a
 * ledge) and goes no further than `--reach` metres from the centreline. The physics is asked as a wheel asks it, from
 * a little above the drawn surface. `--json` writes every reached cell (position, track s and offset, drawn height,
 * the physics' height, normal, surface and source) to compare runs: the cells depend on the drawn meshes and the
 * barriers only, so two runs on the same GLB list the same cells.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { getActiveTrackData, getActiveTrackMetadata, setActiveTrack, type RawTrackJson } from '../src/lib/track-data';
import { createGroundHit, WALL_SEGMENT_STRIDE } from '../src/lib/sim/f12026-car/TrackColliderQuery';
import { trackColliders } from '../src/lib/sim/track-colliders';
import { loadGlbGeometry } from './lib/glb-geometry';
import { buildDrawnGround, nodeMaterialNames } from './lib/drawn-ground';

const argv = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const trackId = opt('track', 'monza');
const G = Number(opt('grid', '1'));
const REACH_M = Number(opt('reach', '60'));
const TOL_M = Number(opt('tol', '0.05'));
const jsonOut = opt('json', '');
/** A wheel probes from its hardpoint + 0.6 m (VehiclePhysics GROUND_PROBE_UP_M); the hardpoint rides ≈ 0.3 m up */
const PROBE_UP_M = 0.9;
/** Most the drawn ground may rise or fall between neighbouring cells before it is a wall face or a ledge, not ground */
const MAX_DRAWN_STEP_M = 0.45;
/** A barrier stops a car whose floor is within this of its span (m): the body stands about a metre tall */
const CAR_HEIGHT_M = 1.0;
/** A patch with no physics ground up to this size (m²) is a hole in it; a larger one is where the ground ends */
const HOLE_MAX_M2 = 400;
/**
 * The edge of the physics ground counts as reached from the road when the shortest drive to it from the centreline
 * (without crossing a barrier) is at most this long (m); farther edges are only reached by a detour behind the barriers
 */
const DIRECT_REACH_M = 80;
/** Patches of fewer cells than this are not listed (they are counted) */
const MIN_CELLS = 4;

setActiveTrack(trackId, JSON.parse(readFileSync(`public/tracks/${trackId}/track_data.json`, 'utf8')) as RawTrackJson);
const track = getActiveTrackData(1200);
const meta = getActiveTrackMetadata();
const glbPath = `public${track.meshUrl}`;
const root = loadGlbGeometry(glbPath);
const nodeMats = nodeMaterialNames(glbPath);

// The physics first: a fitted circuit moves its surfaces while its colliders are built, and the drawn ground is read after
const { ground, walls } = trackColliders(root);
if (!ground) throw new Error(`${trackId}: no Track_Collider_Road, the cars drive on the track samples`);

// Bounds: the centreline's box grown by the reach
let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
for (const smp of track.samples) {
  minX = Math.min(minX, smp.position.x); maxX = Math.max(maxX, smp.position.x);
  minZ = Math.min(minZ, smp.position.z); maxZ = Math.max(maxZ, smp.position.z);
}
minX -= REACH_M + 2; minZ -= REACH_M + 2; maxX += REACH_M + 2; maxZ += REACH_M + 2;
const drawn = buildDrawnGround(root, {
  materialOf: (m) => (m.userData.materialName as string | undefined) || nodeMats.get(m.name) || '',
  cutMaterials: meta.mesh?.cutMaterials,
  bounds: { minX, minZ, maxX, maxZ },
});

// ---- Flood fill from the centreline over the drawn ground, stopped by the barriers
const nx = Math.ceil((maxX - minX) / G);
const nz = Math.ceil((maxZ - minZ) / G);
const N = nx * nz;
const cellY = new Float32Array(N).fill(NaN);
const cellLabel = new Int16Array(N).fill(-1);
const cellS = new Float32Array(N);
const cellLat = new Float32Array(N);
/** Path length from the centreline (cells, 4-connected) */
const cellDist = new Int32Array(N);
const queue = new Int32Array(N);
let qTail = 0;
const cx = (i: number) => minX + ((i % nx) + 0.5) * G;
const cz = (i: number) => minZ + (Math.floor(i / nx) + 0.5) * G;
const cellOf = (x: number, z: number) => {
  const ix = Math.floor((x - minX) / G);
  const iz = Math.floor((z - minZ) / G);
  return ix < 0 || iz < 0 || ix >= nx || iz >= nz ? -1 : iz * nx + ix;
};
const floor = { y: 0, label: 0 };

const segs = walls.segments;
const near = new Int32Array(256);
/** The move from (ax, az) to (bx, bz) at floor height y crosses a barrier */
function crossesWall(ax: number, az: number, bx: number, bz: number, y: number): boolean {
  const n = walls.near((ax + bx) / 2, (az + bz) / 2, G, near);
  for (let k = 0; k < n; k++) {
    const o = near[k] * WALL_SEGMENT_STRIDE;
    const sx = segs[o], sz = segs[o + 1], ex = segs[o + 2], ez = segs[o + 3];
    if (segs[o + 5] < y || segs[o + 4] > y + CAR_HEIGHT_M) continue;
    const d1 = (ex - sx) * (az - sz) - (ez - sz) * (ax - sx);
    const d2 = (ex - sx) * (bz - sz) - (ez - sz) * (bx - sx);
    const d3 = (bx - ax) * (sz - az) - (bz - az) * (sx - ax);
    const d4 = (bx - ax) * (ez - az) - (bz - az) * (ex - ax);
    if (d1 * d2 <= 0 && d3 * d4 <= 0) return true;
  }
  return false;
}

const t0 = Date.now();
for (let s = 0; s < track.totalLengthM; s += G * 0.5) {
  const smp = track.getSampleAtDistance(s);
  const i = cellOf(smp.position.x, smp.position.z);
  if (i < 0 || !Number.isNaN(cellY[i])) continue;
  if (!drawn.floor(cx(i), cz(i), smp.position.y, MAX_DRAWN_STEP_M, floor)) continue;
  cellY[i] = floor.y;
  cellLabel[i] = floor.label;
  cellS[i] = s;
  cellLat[i] = 0;
  queue[qTail++] = i;
}
const DIRS = [1, -1, nx, -nx];
for (let qHead = 0; qHead < qTail; qHead++) {
  const i = queue[qHead];
  const ax = cx(i), az = cz(i), ay = cellY[i];
  for (const d of DIRS) {
    const j = i + d;
    if (j < 0 || j >= N || !Number.isNaN(cellY[j])) continue;
    if ((d === 1 && j % nx === 0) || (d === -1 && i % nx === 0)) continue;
    const bx = cx(j), bz = cz(j);
    if (!drawn.floor(bx, bz, ay, MAX_DRAWN_STEP_M, floor)) continue;
    const pr = track.projectWorldToTrack(bx, bz, cellS[i]);
    if (Math.abs(pr.lateralOffset) > REACH_M) continue;
    if (crossesWall(ax, az, bx, bz, Math.min(ay, floor.y))) continue;
    cellY[j] = floor.y;
    cellLabel[j] = floor.label;
    cellS[j] = pr.s;
    cellLat[j] = pr.lateralOffset;
    cellDist[j] = cellDist[i] + 1;
    queue[qTail++] = j;
  }
}
const fillS = (Date.now() - t0) / 1000;

// ---- The physics under every reached cell
const hit = createGroundHit();
/** 0 on the drawn ground, 1 under it, 2 over it, 3 no ground */
const fault = new Int8Array(N);
const physY = new Float32Array(N).fill(NaN);
const physSrc = new Map<number, string>();
const rows: (string | number | null)[][] = [];
let nBelow = 0, nAbove = 0, nMissing = 0;
for (let k = 0; k < qTail; k++) {
  const i = queue[k];
  const has = ground.query(cx(i), cz(i), cellY[i] + PROBE_UP_M, hit);
  if (has) {
    physY[i] = hit.height;
    physSrc.set(i, hit.source);
    const d = hit.height - cellY[i];
    if (d < -TOL_M) { fault[i] = 1; nBelow++; }
    else if (d > TOL_M) { fault[i] = 2; nAbove++; }
  } else {
    fault[i] = 3;
    nMissing++;
  }
  if (jsonOut) {
    rows.push([
      +cx(i).toFixed(2), +cz(i).toFixed(2), +cellS[i].toFixed(1), +cellLat[i].toFixed(2), +cellY[i].toFixed(3),
      has ? hit.height : null, has ? hit.nx : null, has ? hit.ny : null, has ? hit.nz : null, has ? hit.surface : null, has ? hit.grip : null, has ? hit.source : null,
    ]);
  }
}

// ---- Patches: 8-connected cells with the same kind of fault (under and over count as one: an offset)
const L = track.totalLengthM;
interface Patch {
  kind: 'missing' | 'offset';
  cells: number[];
}
const seen = new Uint8Array(N);
const patches: Patch[] = [];
for (let k = 0; k < qTail; k++) {
  const start = queue[k];
  if (!fault[start] || seen[start]) continue;
  const missing = fault[start] === 3;
  const p: Patch = { kind: missing ? 'missing' : 'offset', cells: [] };
  seen[start] = 1;
  const stack = [start];
  while (stack.length) {
    const i = stack.pop()!;
    p.cells.push(i);
    const ix = i % nx;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dz) || ix + dx < 0 || ix + dx >= nx) continue;
        const j = i + dz * nx + dx;
        if (j < 0 || j >= N || seen[j] || !fault[j] || (fault[j] === 3) !== missing) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  patches.push(p);
}

/** The s span of a set of cells (it may straddle the line) */
function sSpan(cells: number[]): [number, number] {
  const ss = cells.map((i) => cellS[i]).sort((u, v) => u - v);
  let gap = 0;
  let gapAt = 0;
  for (let q = 1; q < ss.length; q++) if (ss[q] - ss[q - 1] > gap) { gap = ss[q] - ss[q - 1]; gapAt = q; }
  return L - (ss[ss.length - 1] - ss[0]) >= gap || gapAt === 0 ? [ss[0], ss[ss.length - 1]] : [ss[gapAt], ss[gapAt - 1]];
}
const turnAt = (s: number) => {
  const smp = track.getSampleAtDistance(s);
  return smp.turnNumber ? `T${smp.turnNumber}` : `S${smp.sector}`;
};
const sideOf = (lat0: number, lat1: number) => (lat1 <= 0 ? 'left' : lat0 >= 0 ? 'right' : 'both');
const count = <T>(items: T[], key: (t: T) => string) => {
  const m = new Map<string, number>();
  for (const t of items) m.set(key(t), (m.get(key(t)) ?? 0) + 1);
  return [...m.entries()].sort((u, v) => v[1] - u[1]).slice(0, 2).map(([k, v]) => `${k.replace(/^Track_(Surface|Collider)_/, '')}×${v}`).join(' ');
};
const latRange = (cells: number[]) => {
  let lo = Infinity, hi = -Infinity;
  for (const i of cells) { lo = Math.min(lo, cellLat[i]); hi = Math.max(hi, cellLat[i]); }
  return [lo, hi] as const;
};
const fmtS = ([s0, s1]: [number, number]) => `${s0.toFixed(0).padStart(5)}–${s1.toFixed(0).padEnd(5)}`;
const fmtLat = ([lo, hi]: readonly [number, number]) => `${lo.toFixed(1).padStart(6)}…${hi.toFixed(1).padEnd(6)}`;

const area = qTail * G * G;
console.log(`${trackId}: ${qTail} cells reached (${(area / 1e4).toFixed(1)} ha on a ${G} m grid, out to ${REACH_M} m from the centreline) in ${fillS.toFixed(1)} s`);
console.log(`physics off the drawn ground by more than ${(TOL_M * 100).toFixed(0)} cm: ${nBelow} cells under it, ${nAbove} over it, ${nMissing} with no ground at all`);

// 1. The ground ends: the edge of each large no-ground patch, as stretches of road per side
const ends = patches.filter((p) => p.kind === 'missing' && p.cells.length * G * G > HOLE_MAX_M2);
const edge: number[] = [];
let detourEdge = 0;
for (const p of ends) {
  for (const i of p.cells) {
    if (![1, -1, nx, -nx].some((d) => fault[i + d] !== 3 && !Number.isNaN(physY[i + d]))) continue;
    if (cellDist[i] * G <= DIRECT_REACH_M) edge.push(i);
    else detourEdge++;
  }
}
const stretches: number[][] = [];
for (const side of [-1, 1]) {
  const cells = edge.filter((i) => Math.sign(cellLat[i]) === side).sort((u, v) => cellS[u] - cellS[v]);
  let cur: number[] | null = null;
  for (const i of cells) {
    if (!cur || cellS[i] - cellS[cur[cur.length - 1]] > 6) stretches.push((cur = []));
    cur.push(i);
  }
}
const endCells = ends.reduce((a, p) => a + p.cells.length, 0);
console.log(`\nThe ground ends with no barrier in the way: ${endCells} m² of drawn ground past it`);
console.log(`  its edge within ${DIRECT_REACH_M} m drive of the road (${edge.length} m) along ${stretches.length} stretches; ${detourEdge} m more only by a detour behind the barriers`);
console.log('  s from–to (m)  where  side   ends at (m off the centreline)   nearest drive (m)   drawn past the edge');
for (const st of stretches.sort((u, v) => cellS[u[0]] - cellS[v[0]])) {
  const span = sSpan(st);
  const lat = latRange(st);
  const abs = st.map((i) => Math.abs(cellLat[i]));
  console.log(
    `  ${fmtS(span)}   ${turnAt(span[0]).padEnd(5)}  ${(lat[1] <= 0 ? 'left' : 'right').padEnd(5)}  ${Math.min(...abs).toFixed(1).padStart(5)}…${Math.max(...abs).toFixed(1).padEnd(5)}` +
      `                    ${String(Math.min(...st.map((i) => cellDist[i] * G))).padStart(5)}             ${count(st, (i) => drawn.labels[cellLabel[i]])}`
  );
}

// 2. Holes
const holes = patches.filter((p) => p.kind === 'missing' && p.cells.length * G * G <= HOLE_MAX_M2);
console.log(`\nHoles in the physics ground: ${holes.length} (${holes.reduce((a, p) => a + p.cells.length, 0)} m²)`);
console.log('  s from–to (m)  where  side   lateral (m)       m²   drawn | physics around it');
for (const p of holes.filter((h) => h.cells.length >= 1).sort((u, v) => cellS[u.cells[0]] - cellS[v.cells[0]])) {
  const span = sSpan(p.cells);
  const lat = latRange(p.cells);
  const around = p.cells.flatMap((i) => [1, -1, nx, -nx].map((d) => i + d)).filter((j) => physSrc.has(j));
  console.log(`  ${fmtS(span)}   ${turnAt(span[0]).padEnd(5)}  ${sideOf(lat[0], lat[1]).padEnd(5)} ${fmtLat(lat)} ${String(p.cells.length).padStart(5)}   ${count(p.cells, (i) => drawn.labels[cellLabel[i]])} | ${count(around, (j) => physSrc.get(j)!)}`);
}

// 3. Offsets
const offsets = patches.filter((p) => p.kind === 'offset');
const listed = offsets.filter((p) => p.cells.length >= MIN_CELLS);
console.log(`\nOffsets over ${(TOL_M * 100).toFixed(0)} cm: ${offsets.length} patches (${listed.length} of ${MIN_CELLS}+ m² listed)`);
console.log('  s from–to (m)  where  side   lateral (m)       m²  deepest under / most over (m)   drawn | physics');
for (const p of listed.sort((u, v) => cellS[u.cells[0]] - cellS[v.cells[0]])) {
  const span = sSpan(p.cells);
  const lat = latRange(p.cells);
  let under = 0, over = 0;
  for (const i of p.cells) { const d = physY[i] - cellY[i]; under = Math.min(under, d); over = Math.max(over, d); }
  console.log(
    `  ${fmtS(span)}   ${turnAt(span[0]).padEnd(5)}  ${sideOf(lat[0], lat[1]).padEnd(5)} ${fmtLat(lat)} ${String(p.cells.length).padStart(5)}  ${(under < 0 ? under.toFixed(2) : '-').padStart(8)} / ${(over > 0 ? over.toFixed(2) : '-').padEnd(8)}` +
      `            ${count(p.cells, (i) => drawn.labels[cellLabel[i]])} | ${count(p.cells, (i) => physSrc.get(i)!)}`
  );
}

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ trackId, grid: G, reach: REACH_M, fields: ['x', 'z', 's', 'lat', 'drawn', 'height', 'nx', 'ny', 'nz', 'surface', 'grip', 'source'], cells: rows }));
  console.log(`\nwrote ${rows.length} cells to ${jsonOut}`);
}
