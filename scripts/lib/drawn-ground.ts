/**
 * The ground a circuit draws, for the scripts that hold its physics to it (ground-gaps.ts, verify-offroad-ground.ts):
 * the up-facing triangles of the visible ground meshes on a uniform XZ grid, asked for the drawn floor under a point.
 *
 * On a converted scan (a `Track_Model` node) it is the scan's opaque meshes whose material reads as ground on screen
 * (asphalt, painted lines, kerbs, grass, sand, terrain), named by `SCAN_GROUND_MATERIAL`, less the materials the scene
 * leaves out (`metadata.mesh.cutMaterials`). Monza's blended overlays (rubber marks `groove*`, the grass edging
 * `grs_brd`) are left out: they float 1-5 cm (at most 21 cm) over the floor they are drawn on. On a circuit built with
 * its own meshes it is the visible tagged surfaces plus its `Terrain*` / `Ground_*` meshes. Hidden nodes (colliders,
 * the physics' own surfaces) are never part of it.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

/** Scan materials that draw the floor (Monza's Assetto Corsa / Sketchfab names) */
export const SCAN_GROUND_MATERIAL = /^(apsh-|asph-|curb-|grass-shader|sand\.|whiteline|top_)/i;
/** A circuit's own meshes that draw ground besides its tagged surfaces */
const OWN_GROUND = /^(Terrain|Ground_)/;

export interface DrawnGround {
  /** Labels of the triangles (scan material, or mesh name) */
  labels: string[];
  triangleCount: number;
  /**
   * The drawn floor at (x, z) next to height `nearY`: the highest drawn surface no more than `maxStepM` from it (a line
   * painted over the asphalt is the floor, not the asphalt a centimetre under it). False when there is none.
   */
  floor(x: number, z: number, nearY: number, maxStepM: number, out: { y: number; label: number }): boolean;
  /** Every drawn surface at (x, z), highest first */
  hits(x: number, z: number): { y: number; label: number }[];
}

/** Material name per glTF node, for the headless reader's single-primitive meshes (it keeps their node extras only) */
export function nodeMaterialNames(glbPath: string): Map<string, string> {
  const buf = readFileSync(glbPath);
  const gltf = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as {
    nodes: { name?: string; mesh?: number }[];
    meshes: { primitives: { material?: number }[] }[];
    materials?: { name?: string }[];
  };
  const out = new Map<string, string>();
  for (const n of gltf.nodes) {
    if (n.mesh === undefined || !n.name) continue;
    const p = gltf.meshes[n.mesh].primitives;
    if (p.length === 1 && p[0].material !== undefined) out.set(n.name, gltf.materials?.[p[0].material]?.name ?? '');
  }
  return out;
}

export function buildDrawnGround(
  root: THREE.Object3D,
  opts: { materialOf: (mesh: THREE.Mesh) => string; cutMaterials?: readonly string[]; bounds?: { minX: number; minZ: number; maxX: number; maxZ: number } }
): DrawnGround {
  root.updateMatrixWorld(true);
  const isHidden = (o: THREE.Object3D) => {
    for (let n: THREE.Object3D | null = o; n && n !== root; n = n.parent) if (n.userData?.hidden || n.userData?.collider) return true;
    return false;
  };
  const topOf = (o: THREE.Object3D) => {
    let n = o;
    while (n.parent && n.parent !== root) n = n.parent;
    return n;
  };
  const hasScan = !!root.getObjectByName('Track_Model');
  const cut = new Set(opts.cutMaterials ?? []);
  const labels: string[] = [];
  const tri: number[] = [];
  const triLabel: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || isHidden(o)) return;
    const top = topOf(o);
    let label: string;
    if (hasScan) {
      if (top.name !== 'Track_Model') return;
      const mat = opts.materialOf(o);
      if (!SCAN_GROUND_MATERIAL.test(mat) || cut.has(mat)) return;
      label = mat;
    } else {
      if (!top.userData?.surface && !o.userData?.surface && !OWN_GROUND.test(top.name)) return;
      label = top.name;
    }
    let li = labels.indexOf(label);
    if (li < 0) li = labels.push(label) - 1;
    const g = o.geometry as THREE.BufferGeometry;
    const pos = g.getAttribute('position');
    const idx = g.getIndex();
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(o.matrixWorld);
      const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z;
      const e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
      const ny = e1z * e2x - e1x * e2z;
      const len = Math.hypot(e1y * e2z - e1z * e2y, ny, e1x * e2y - e1y * e2x);
      if (len < 1e-9 || Math.abs(ny) / len < 0.5) continue;
      tri.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      triLabel.push(li);
    }
  });

  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  if (opts.bounds) ({ minX, minZ, maxX, maxZ } = opts.bounds);
  else {
    for (let i = 0; i < tri.length; i += 3) {
      minX = Math.min(minX, tri[i]); maxX = Math.max(maxX, tri[i]);
      minZ = Math.min(minZ, tri[i + 2]); maxZ = Math.max(maxZ, tri[i + 2]);
    }
  }
  const CELL = 4;
  const nx = Math.max(1, Math.ceil((maxX - minX) / CELL));
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / CELL));
  const cells: number[][] = Array.from({ length: nx * nz }, () => []);
  for (let t = 0; t < triLabel.length; t++) {
    const o = t * 9;
    const x0 = Math.max(0, Math.floor((Math.min(tri[o], tri[o + 3], tri[o + 6]) - minX) / CELL));
    const x1 = Math.min(nx - 1, Math.floor((Math.max(tri[o], tri[o + 3], tri[o + 6]) - minX) / CELL));
    const z0 = Math.max(0, Math.floor((Math.min(tri[o + 2], tri[o + 5], tri[o + 8]) - minZ) / CELL));
    const z1 = Math.min(nz - 1, Math.floor((Math.max(tri[o + 2], tri[o + 5], tri[o + 8]) - minZ) / CELL));
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) cells[cz * nx + cx].push(t);
  }

  const forEachHit = (x: number, z: number, fn: (y: number, label: number) => void) => {
    const cx = Math.floor((x - minX) / CELL);
    const cz = Math.floor((z - minZ) / CELL);
    if (cx < 0 || cz < 0 || cx >= nx || cz >= nz) return;
    for (const t of cells[cz * nx + cx]) {
      const o = t * 9;
      const ax = tri[o], az = tri[o + 2];
      const v0x = tri[o + 3] - ax, v0z = tri[o + 5] - az;
      const v1x = tri[o + 6] - ax, v1z = tri[o + 8] - az;
      const den = v0x * v1z - v1x * v0z;
      if (Math.abs(den) < 1e-12) continue;
      const px = x - ax, pz = z - az;
      const u = (px * v1z - v1x * pz) / den;
      const v = (v0x * pz - px * v0z) / den;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      fn(tri[o + 1] + u * (tri[o + 4] - tri[o + 1]) + v * (tri[o + 7] - tri[o + 1]), triLabel[t]);
    }
  };

  return {
    labels,
    triangleCount: triLabel.length,
    floor(x, z, nearY, maxStepM, out) {
      let found = false;
      forEachHit(x, z, (y, label) => {
        if (Math.abs(y - nearY) > maxStepM) return;
        if (!found || y > out.y) {
          out.y = y;
          out.label = label;
          found = true;
        }
      });
      return found;
    },
    hits(x, z) {
      const out: { y: number; label: number }[] = [];
      forEachHit(x, z, (y, label) => out.push({ y, label }));
      return out.sort((p, q) => q.y - p.y);
    },
  };
}
