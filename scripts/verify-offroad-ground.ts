/**
 * Cars that leave the road stay on the ground they are drawn on. At each corner a car (the f12026-car, the SF-26's
 * physics) comes down the straight, misses its braking point and goes straight on, or turns in too far and runs out
 * the other side, onto the run-off, grass, gravel and beyond. A car that falls through the ground (into the lost-car
 * rescue, 15 m down) fails, and so does a tyre hanging over drawn ground with nothing under it. Past the verge (more
 * than VERGE_M beyond the road's edge) every tyre is held to the drawn ground under it (scripts/lib/drawn-ground.ts):
 * its contact may not sit more than SINK_TOL_M under it. Tyres on the road and kerbs, and on the verge (where the
 * circuit keeps its own swept surfaces: TrackColliderQuery.ts), are reported, not judged. So is a rescue of a car that
 * was on the ground when it came (it also fires when the car's track position jumps to a stretch of the lap 15 m
 * higher, as it can for a car pinned on a barrier beside one).
 *
 *   node --import tsx scripts/verify-offroad-ground.ts [--track monza] [--verbose]
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { getActiveTrackData, getActiveTrackMetadata, setActiveTrack, type RawTrackJson } from '../src/lib/track-data';
import { F12026CarSim } from '../src/lib/sim/f12026-car/F12026CarSim';
import { loadGlbGeometry } from './lib/glb-geometry';
import { buildDrawnGround, nodeMaterialNames } from './lib/drawn-ground';
import { skipSuiteWithout } from './lib/hosted-files';

const argv = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const trackId = opt('track', 'monza');
const verbose = argv.includes('--verbose');
// Monza is on the event branch only; elsewhere the default circuit's files may be missing
skipSuiteWithout(`public/tracks/${trackId}/track_data.json`);
/** A tyre's contact this far under the drawn floor is sinking into it (m): the drawn mesh itself is within a few cm */
const SINK_TOL_M = 0.06;
/** The verge: the road collider's band past the road's edge (1.6 m), with some slack for its outline (m) */
const VERGE_M = 2;
const FPS = 60;

setActiveTrack(trackId, JSON.parse(readFileSync(`public/tracks/${trackId}/track_data.json`, 'utf8')) as RawTrackJson);
const track = getActiveTrackData(1200);
const glbPath = `public${track.meshUrl}`;
const root = loadGlbGeometry(glbPath);
const mats = nodeMaterialNames(glbPath);
const sim = new F12026CarSim(track, root);
// The drawn ground is read after the car is built: a fitted circuit moves its surfaces while its colliders are built
const drawn = buildDrawnGround(root, {
  materialOf: (m) => (m.userData.materialName as string | undefined) || mats.get(m.name) || '',
  cutMaterials: getActiveTrackMetadata().mesh?.cutMaterials,
});
sim.assistPreset = 'semi_pro';
const v = sim.vehicle;
const L = track.totalLengthM;

interface Scenario {
  label: string;
  /** Where the car starts, how fast, and how far off the centreline (m, + right) */
  s: number;
  kmh: number;
  lateral: number;
  /** Heading off the track's at the start (deg, + right) */
  yawDeg: number;
  /** Driver inputs held throughout */
  brake: number;
  steer: number;
  seconds: number;
}

/** Turns of the active circuit with their distance, from its track data */
const turns = (track.samples as { s: number; turnNumber: number; turnName: string }[]).reduce<{ n: number; s: number; name: string }[]>((acc, smp) => {
  if (smp.turnNumber && !acc.some((t) => t.n === smp.turnNumber)) acc.push({ n: smp.turnNumber, s: smp.s, name: smp.turnName });
  return acc;
}, []);

const scenarios: Scenario[] = [];
for (const t of turns) {
  const s0 = (t.s - 90 + L) % L;
  const smp = track.getSampleAtDistance(t.s);
  const kmh = Math.min(260, Math.max(120, (smp.optimalSpeedKmh || 150) * 1.6));
  // Straight on at the turn, on a light brake, from either side of the road
  for (const lateral of [-3, 0, 3]) {
    scenarios.push({ label: `T${t.n} straight on (from ${lateral > 0 ? '+' : ''}${lateral} m)`, s: s0, kmh, lateral, yawDeg: 0, brake: 0.25, steer: 0, seconds: 7 });
  }
  // Turned in too far: off on the inside, and spun out across it
  const dir = smp.curvature < 0 ? -1 : 1;
  scenarios.push({ label: `T${t.n} turned in too far`, s: s0, kmh: kmh * 0.8, lateral: 0, yawDeg: 0, brake: 0.2, steer: 0.6 * dir, seconds: 7 });
  scenarios.push({ label: `T${t.n} off the outside at an angle`, s: (t.s - 30 + L) % L, kmh: kmh * 0.7, lateral: 0, yawDeg: -20 * dir, brake: 0.3, steer: 0, seconds: 6 });
}

const floor = { y: 0, label: 0 };
let failures = 0;
let worstSink = 0;
let worstAt = '';
for (const sc of scenarios) {
  const smp = track.getSampleAtDistance(sc.s);
  const b = smp.binormal;
  const bl = Math.hypot(b.x, b.z) || 1;
  const x = smp.position.x + (b.x / bl) * sc.lateral;
  const z = smp.position.z + (b.z / bl) * sc.lateral;
  const yaw = Math.atan2(smp.tangent.x, smp.tangent.z) - (sc.yawDeg * Math.PI) / 180;
  sim.teleportToDistance(sc.s, sc.kmh / 3.6, sc.lateral);
  v.reset(x, z, yaw, sc.kmh / 3.6);
  let maxSink = 0;
  let sinkWhere = '';
  let maxRoadSink = 0;
  let maxVergeSink = 0;
  let unsupported = 0;
  let lost = false;
  let rescued = false;
  /** Consecutive frames with no tyre on the ground */
  let airborne = 0;
  let offRoadFrames = 0;
  let maxLat = 0;
  const prev = new THREE.Vector3().copy(v.position);
  for (let f = 0; f < sc.seconds * FPS; f++) {
    sim.step(1 / FPS, { throttle: 0, brake: sc.brake, analogSteer: sc.steer });
    // The lost-car rescue teleports the car back to the road: a jump no car makes in a frame
    if (v.position.distanceTo(prev) > 12) {
      // Through the ground: it had been falling with no tyre on anything
      if (airborne >= 6) lost = true;
      else rescued = true;
      break;
    }
    airborne = v.wheels.some((w) => w.grounded) ? 0 : airborne + 1;
    prev.copy(v.position);
    const pr = track.projectWorldToTrack(v.position.x, v.position.z);
    maxLat = Math.max(maxLat, Math.abs(pr.lateralOffset));
    let onRoad = true;
    for (const w of v.wheels) {
      const p = w.hardpointWorld;
      // The drawn floor the tyre stands on: the one nearest its hub's bottom
      const tyreBottom = w.hubY - w.loadedRadius;
      if (!drawn.floor(p.x, p.z, tyreBottom, 0.6, floor)) continue;
      const contact = w.grounded ? w.contactY : null;
      if (contact === null) {
        // Hanging with the drawn floor right under the tyre: nothing holds it up
        if (tyreBottom - floor.y < 0.02) unsupported++;
        continue;
      }
      const sink = floor.y - contact;
      // On the circuit's own road and kerbs (not the drawn ground, which names itself `Track_Model:…`)
      const ownRoad = ['road', 'kerb', 'sausage', 'pitlane'].includes(w.ground.surface) && !w.ground.source.startsWith('Track_Model:');
      if (ownRoad) {
        maxRoadSink = Math.max(maxRoadSink, sink);
        continue;
      }
      onRoad = false;
      const tyre = track.projectWorldToTrack(p.x, p.z, pr.s);
      if (Math.abs(tyre.lateralOffset) - tyre.sample.width / 2 <= VERGE_M) {
        maxVergeSink = Math.max(maxVergeSink, sink);
        continue;
      }
      if (sink > maxSink) {
        maxSink = sink;
        sinkWhere = `s ${pr.s.toFixed(0)} lat ${pr.lateralOffset.toFixed(1)} on ${drawn.labels[floor.label]} (physics ${w.ground.source})`;
      }
    }
    if (!onRoad) offRoadFrames++;
  }
  const ok = !lost && maxSink <= SINK_TOL_M && unsupported === 0;
  if (!ok) failures++;
  if (maxSink > worstSink) {
    worstSink = maxSink;
    worstAt = `${sc.label}: ${sinkWhere}`;
  }
  if (verbose || !ok || rescued) {
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${sc.label.padEnd(36)} ${sc.kmh.toFixed(0).padStart(3)} km/h  off-road ${(offRoadFrames / FPS).toFixed(1)} s, out to ${maxLat.toFixed(0)} m` +
        `  deepest tyre past the verge ${(maxSink * 100).toFixed(0)} cm under the drawn floor${maxSink > SINK_TOL_M ? ` (${sinkWhere})` : ''} (on the verge ${(maxVergeSink * 100).toFixed(0)} cm, on the road ${(maxRoadSink * 100).toFixed(0)} cm)` +
        `${unsupported ? `, ${unsupported} tyre-frames over it with no ground` : ''}${lost ? ', FELL THROUGH (lost-car rescue)' : ''}${rescued ? ', note: lost-car rescue while on the ground (not a fall)' : ''}`
    );
  }
}
console.log(`\n${trackId}: ${scenarios.length - failures} / ${scenarios.length} off-road runs on the drawn ground; deepest tyre past the verge ${(worstSink * 100).toFixed(0)} cm under it${worstAt ? ` (${worstAt})` : ''}`);
process.exitCode = failures ? 1 : 0;
