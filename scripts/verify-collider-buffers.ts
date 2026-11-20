/**
 * A track's ground and wall colliders handed over as plain buffers (`toBuffers` / `fromBuffers`), the way a worker
 * would receive them: through a structured clone, with no track mesh on the far side. The rebuilt colliders must give
 * the same answers as the ones built from the mesh. Monza's, built as the game builds them (with the scan ground it is
 * driven on off its own road, `mesh.groundMaterials`), are checked too where this copy has the circuit.
 *
 *   npx tsx scripts/verify-collider-buffers.ts
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { getActiveTrackData, setActiveTrack, type RawTrackJson } from '../src/lib/track-data';
import { createGroundHit, TrackColliderQuery, TrackWallQuery, type GroundHit } from '../src/lib/sim/f12026-car/TrackColliderQuery';
import { trackColliders } from '../src/lib/sim/track-colliders';
import { loadGlbGeometry } from './lib/glb-geometry';
import { hasFile, noteSkip } from './lib/hosted-files';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(60)} ${detail}`);
  if (!ok) failures.push(name);
};

setActiveTrack('rwanda_official', JSON.parse(readFileSync('public/tracks/rwanda_official/track_data.json', 'utf8')) as RawTrackJson);
const track = getActiveTrackData(1200);
const root = loadGlbGeometry(`public${track.meshUrl}`);

const ground = TrackColliderQuery.fromTrackRoot(root, undefined, { conformSurfaces: true });
const walls = TrackWallQuery.fromTrackRoot(root);

const groundBuffers = structuredClone(ground.toBuffers());
const wallBuffers = structuredClone(walls.toBuffers());
const bytes = (o: object) => Object.values(o).reduce((a, v) => a + (ArrayBuffer.isView(v) ? v.byteLength : 0), 0);
const ground2 = TrackColliderQuery.fromBuffers(groundBuffers);
const walls2 = TrackWallQuery.fromBuffers(wallBuffers);
check('The clone shares no memory with the original', groundBuffers.tris.buffer !== ground.toBuffers().tris.buffer && wallBuffers.segments.buffer !== walls.segments.buffer,
  `${(bytes(groundBuffers) / 1e6).toFixed(1)} MB of ground, ${(bytes(wallBuffers) / 1e3).toFixed(0)} kB of walls`);
check('Same triangles and wall segments', ground2.triangleCount === ground.triangleCount && walls2.segmentCount === walls.segmentCount, `${ground.triangleCount} triangles, ${walls.segmentCount} segments`);

// Ground: points across the road and well off it, all round the lap
let same = 0;
let asked = 0;
let hits = 0;
const a = createGroundHit();
const b = createGroundHit();
for (let i = 0; i < 4000; i++) {
  const smp = track.getSampleAtDistance((i / 4000) * track.totalLengthM);
  const lat = ((i * 37) % 61) - 30;
  const x = smp.position.x + smp.binormal.x * lat;
  const z = smp.position.z + smp.binormal.z * lat;
  const y = smp.position.y + 2;
  const ha = ground.query(x, z, y, a);
  const hb = ground2.query(x, z, y, b);
  asked++;
  if (ha) hits++;
  if (ha === hb && (!ha || (a.height === b.height && a.nx === b.nx && a.ny === b.ny && a.nz === b.nz && a.surface === b.surface && a.grip === b.grip && a.source === b.source))) same++;
}
check('4000 ground queries: identical height, normal, surface and grip', same === asked && hits > 3000, `${same} / ${asked} identical, ${hits} on the mesh`);

// Walls: the segments near points along both edges
let wallSame = 0;
let wallAsked = 0;
let found = 0;
const outA = new Int32Array(64);
const outB = new Int32Array(64);
for (let i = 0; i < 1500; i++) {
  const smp = track.getSampleAtDistance((i / 1500) * track.totalLengthM);
  const lat = (i % 2 ? 1 : -1) * (smp.width / 2 + 3);
  const x = smp.position.x + smp.binormal.x * lat;
  const z = smp.position.z + smp.binormal.z * lat;
  const na = walls.near(x, z, 8, outA);
  const nb = walls2.near(x, z, 8, outB);
  wallAsked++;
  found += na;
  if (na === nb && outA.subarray(0, na).every((id, k) => id === outB[k])) wallSame++;
}
check('1500 wall queries: the same segments in the same order', wallSame === wallAsked && found > 0, `${wallSame} / ${wallAsked} identical, ${found} segments found`);

// Monza (event branch): its ground as the game builds it, scan ground included, through a structured clone
if (hasFile('public/tracks/monza/track_data.json') && hasFile('public/tracks/monza/monza.glb')) {
  setActiveTrack('monza', JSON.parse(readFileSync('public/tracks/monza/track_data.json', 'utf8')) as RawTrackJson);
  const monza = getActiveTrackData(1200);
  const mRoot = loadGlbGeometry(`public${monza.meshUrl}`);
  const mGround = trackColliders(mRoot).ground!;
  const mBuffers = structuredClone(mGround.toBuffers());
  const mGround2 = TrackColliderQuery.fromBuffers(mBuffers);
  check('Monza: the clone carries the scan ground', !!mBuffers.drawn && mBuffers.drawn.tris.length > 0 && mBuffers.drawn.tris.buffer !== mGround.toBuffers().drawn!.tris.buffer,
    `${((mBuffers.drawn?.tris.length ?? 0) / 9).toFixed(0)} drawn triangles`);
  const same = (p: GroundHit, q: GroundHit) => p.height === q.height && p.nx === q.nx && p.ny === q.ny && p.nz === q.nz && p.surface === q.surface && p.grip === q.grip && p.source === q.source;
  let mSame = 0;
  let mAsked = 0;
  let onScan = 0;
  const outsA = Array.from({ length: 5 }, createGroundHit);
  const outsB = Array.from({ length: 5 }, createGroundHit);
  const xs = new Float64Array(5);
  const zs = new Float64Array(5);
  for (let i = 0; i < 4000; i++) {
    const smp = monza.getSampleAtDistance((i / 4000) * monza.totalLengthM);
    const lat = ((i * 37) % 121) - 60;
    const x = smp.position.x + smp.binormal.x * lat;
    const z = smp.position.z + smp.binormal.z * lat;
    const y = smp.position.y + 2;
    const ha = mGround.query(x, z, y, a);
    const hb = mGround2.query(x, z, y, b);
    mAsked++;
    if (ha && a.source.startsWith('Track_Model:')) onScan++;
    if (ha === hb && (!ha || same(a, b))) mSame++;
    // A contact patch's worth of points around it, through queryMany
    for (let k = 0; k < 5; k++) {
      xs[k] = x + 0.07 * (k - 2);
      zs[k] = z + 0.05 * ((k * 3) % 5 - 2);
    }
    const ma = mGround.queryMany(xs, zs, 5, y, outsA, 3);
    const mb = mGround2.queryMany(xs, zs, 5, y, outsB, 3);
    mAsked++;
    if (ma === mb && outsA.every((o, k) => !((ma >> k) & 1) || (k < 3 ? same(o, outsB[k]) : o.height === outsB[k].height))) mSame++;
  }
  check('Monza: 4000 queries and contact patches out to 60 m, identical', mSame === mAsked && onScan > 1000, `${mSame} / ${mAsked} identical, ${onScan} on the scan ground`);

  // In the browser the scan's ground is found by its materials' own names (GLTFLoader builds them; the headless reader
  // only notes them in userData): the same meshes give the same drawn ground
  const bRoot = loadGlbGeometry(`public${monza.meshUrl}`);
  bRoot.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || typeof o.userData.materialName !== 'string') return;
    o.material = new THREE.MeshStandardMaterial({ name: o.userData.materialName });
    delete o.userData.materialName;
  });
  const bDrawn = trackColliders(bRoot).ground!.toBuffers().drawn;
  const mDrawn = mGround.toBuffers().drawn!;
  const sameArray = (p: ArrayLike<number>, q: ArrayLike<number>) => p.length === q.length && Array.prototype.every.call(p, (x: number, k: number) => x === q[k]);
  check('Monza: the scan ground found by material names alone is the same', !!bDrawn && sameArray(bDrawn.tris, mDrawn.tris) && sameArray(bDrawn.triLayer, mDrawn.triLayer) && sameArray(bDrawn.cellTris, mDrawn.cellTris),
    `${((bDrawn?.tris.length ?? 0) / 9).toFixed(0)} drawn triangles`);
} else {
  noteSkip("Monza's colliders through a structured clone", 'public/tracks/monza');
}

console.log(failures.length ? `\n${failures.length} check(s) failed: ${failures.join(', ')}` : '\nAll collider buffer checks passed.');
if (failures.length) process.exitCode = 1;
