/**
 * Dresses RISE Motordrome for the event: its trackside banners, big screens, start gantry, flags and flag-coloured
 * kerbs (Rwanda's, from scripts/rwanda-official) take the sponsor's and the event's colours and names.
 *
 * The banners and screens are drawn here as text placeholders unless the official artwork is in public/kiosk/brand/
 * (event-brand.ts BRAND_FILES). RISE's model itself is not changed, only its materials once loaded; a circuit without
 * RISE's banners (a converted scan such as Monza) gets a group of boards along its straights (addTracksideBoards).
 */

import * as THREE from "three";
import { withBasePath } from "@/lib/base-path";
import { BRAND_FILES, EVENT_BRAND, EVENT_BRANDING_ON } from "@/lib/kiosk/event-brand";
import { fetchLeaderboard, loadKioskConfig } from "@/lib/kiosk/kiosk-api";
import { rankingModeFor, runnableCarId } from "@/lib/kiosk/kiosk-types";
import { formatLapTime } from "@/lib/kiosk/kiosk-score";
import type { BuiltTrackData } from "@/lib/track-data";
import { trackColliders } from "@/lib/sim/track-colliders";
import { createGroundHit } from "@/lib/sim/f12026-car/TrackColliderQuery";
import { SegmentOccluder } from "@/lib/render/segment-occluder";

interface Fonts {
  display: string;
  text: string;
  mono: string;
}

/** A web font the page loaded (next/font sets its family on a CSS variable), then the fallbacks */
function cssFont(variable: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
    return v ? `${v}, ${fallback}` : fallback;
  } catch {
    return fallback;
  }
}

const pageFonts = (): Fonts => ({
  display: cssFont("--font-orbitron", "'Arial Black', Arial, sans-serif"),
  text: cssFont("--font-chakra", "Arial, sans-serif"),
  mono: cssFont("--font-geist-mono", "ui-monospace, monospace"),
});

type Ctx = CanvasRenderingContext2D & { letterSpacing?: string };

/** One line of text centred on (x, y), shrunk until it fits `maxW` */
function fitText(ctx: Ctx, text: string, x: number, y: number, maxW: number, sizePx: number, font: string, color: string, spacingPx = 0, align: CanvasTextAlign = "center"): void {
  let size = sizePx;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  for (;;) {
    ctx.font = font.replace("{size}", `${size}px`);
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${Math.round(spacingPx * (size / sizePx))}px`;
    if (ctx.measureText(text).width <= maxW || size <= 8) break;
    size -= 2;
  }
  ctx.fillText(text, x, y);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
}

type Painter = (ctx: Ctx, w: number, h: number, f: Fonts) => void;

const paintSponsorBanner: Painter = (ctx, w, h, f) => {
  ctx.fillStyle = "#F4F4F2";
  ctx.fillRect(0, 0, w, h);
  for (const x of [0, w - 40]) {
    ctx.fillStyle = EVENT_BRAND.red;
    ctx.fillRect(x, 0, 40, h);
  }
  ctx.fillStyle = EVENT_BRAND.black;
  ctx.fillRect(40, 0, 10, h);
  ctx.fillRect(w - 50, 0, 10, h);
  fitText(ctx, EVENT_BRAND.sponsor, w / 2, h / 2 + 3, w - 200, 84, `900 {size} ${f.display}`, EVENT_BRAND.red, 14);
};

const paintEventBanner: Painter = (ctx, w, h, f) => {
  ctx.fillStyle = EVENT_BRAND.black;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = EVENT_BRAND.red;
  ctx.fillRect(0, 0, 36, h);
  ctx.fillRect(w - 36, 0, 36, h);
  ctx.fillStyle = EVENT_BRAND.white;
  ctx.fillRect(36, 0, 6, h);
  ctx.fillRect(w - 42, 0, 6, h);
  fitText(ctx, EVENT_BRAND.event, w / 2, h * 0.37, w - 140, 46, `800 {size} ${f.display}`, EVENT_BRAND.white, 3);
  fitText(ctx, `${EVENT_BRAND.dates} · ${EVENT_BRAND.venue}`, w / 2, h * 0.77, w - 160, 30, `700 {size} ${f.text}`, "#FF3B30", 4);
};

const paintComboBanner: Painter = (ctx, w, h, f) => {
  ctx.fillStyle = EVENT_BRAND.red;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = EVENT_BRAND.white;
  ctx.fillRect(0, 10, w, 4);
  ctx.fillRect(0, h - 14, w, 4);
  fitText(ctx, `${EVENT_BRAND.sponsor}  ×  ${EVENT_BRAND.eventShort} ${EVENT_BRAND.year}`, w / 2, h / 2 + 2, w - 90, 56, `900 {size} ${f.display}`, EVENT_BRAND.white, 4);
};

interface ScreenRow {
  rank: number;
  name: string;
  time: string;
}

function paintScreen(rows: readonly ScreenRow[]): Painter {
  return (ctx, w, h, f) => {
    ctx.fillStyle = EVENT_BRAND.black;
    ctx.fillRect(0, 0, w, h);
    // Header: the event, and a LIVE badge as on a broadcast
    ctx.fillStyle = "#16161C";
    ctx.fillRect(0, 0, w, 44);
    ctx.fillStyle = EVENT_BRAND.red;
    ctx.fillRect(0, 0, 8, 44);
    fitText(ctx, `${EVENT_BRAND.sponsor} × ${EVENT_BRAND.eventShort}`, 20, 23, w - 130, 22, `800 {size} ${f.display}`, EVENT_BRAND.white, 1, "left");
    ctx.fillStyle = EVENT_BRAND.red;
    ctx.fillRect(w - 92, 9, 80, 26);
    fitText(ctx, "LIVE", w - 52, 23, 70, 18, `900 {size} ${f.display}`, EVENT_BRAND.white, 2);
    if (rows.length > 0) {
      fitText(ctx, "CLASSIFICA · " + EVENT_BRAND.challenge, 20, 64, w - 40, 15, `700 {size} ${f.text}`, "#FF3B30", 2, "left");
      rows.slice(0, 8).forEach((r, i) => {
        const y = 92 + i * 24;
        ctx.fillStyle = i % 2 === 0 ? "#15151B" : "#101015";
        ctx.fillRect(14, y - 11, w - 28, 22);
        ctx.fillStyle = i === 0 ? EVENT_BRAND.red : "#2A2A33";
        ctx.fillRect(14, y - 11, 30, 22);
        fitText(ctx, String(r.rank), 29, y + 1, 26, 15, `800 {size} ${f.mono}`, EVENT_BRAND.white);
        fitText(ctx, r.name.toUpperCase(), 56, y + 1, w - 210, 16, `700 {size} ${f.text}`, EVENT_BRAND.white, 1, "left");
        fitText(ctx, r.time, w - 24, y + 1, 140, 16, `700 {size} ${f.mono}`, "#E8E8EA", 0, "right");
      });
    } else {
      fitText(ctx, EVENT_BRAND.challenge, w / 2, 118, w - 50, 30, `900 {size} ${f.display}`, EVENT_BRAND.white, 2);
      fitText(ctx, "SFIDA IL CRONOMETRO!", w / 2, 162, w - 60, 22, `700 {size} ${f.text}`, "#FF3B30", 4);
      fitText(ctx, EVENT_BRAND.event, w / 2, 206, w - 60, 17, `700 {size} ${f.text}`, "#C9C9CF", 2);
    }
    ctx.fillStyle = "#16161C";
    ctx.fillRect(0, h - 30, w, 30);
    fitText(ctx, `${EVENT_BRAND.dates} · ${EVENT_BRAND.venue}`, w / 2, h - 15, w - 30, 14, `700 {size} ${f.text}`, "#BDBDC4", 2);
  };
}

interface BrandTexture {
  texture: THREE.CanvasTexture;
  setPainter: (paint: Painter) => void;
}

/** A canvas texture the glTF way round (no flip), painted now and again once the web fonts have loaded */
function brandTexture(width: number, height: number, paint: Painter, artworkUrl: string): BrandTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d") as Ctx | null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  let painter = paint;
  let artwork: HTMLImageElement | null = null;
  const draw = () => {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (artwork) ctx.drawImage(artwork, 0, 0, width, height);
    else painter(ctx, width, height, pageFonts());
    texture.needsUpdate = true;
  };
  draw();
  // The display fonts may still be on their way: paint again once they are in
  const f = pageFonts();
  if (typeof document !== "undefined" && document.fonts) {
    void Promise.allSettled([document.fonts.load(`900 40px ${f.display}`), document.fonts.load(`700 40px ${f.text}`)]).then(() => {
      if (!artwork) draw();
    });
  }
  // The official artwork, when it has been put in public/kiosk/brand/
  const img = new Image();
  img.onload = () => {
    artwork = img;
    draw();
  };
  img.src = withBasePath(artworkUrl);
  return {
    texture,
    setPainter: (next) => {
      painter = next;
      if (!artwork) draw();
    },
  };
}

const BANNERS: Record<string, { paint: Painter; artwork: string }> = {
  Banner_Rwanda: { paint: paintSponsorBanner, artwork: BRAND_FILES.bannerSponsor },
  Banner_Bugesera: { paint: paintEventBanner, artwork: BRAND_FILES.bannerEvent },
  Banner_Kigali: { paint: paintComboBanner, artwork: BRAND_FILES.bannerCombo },
};

/** Linear-space colours for the flags' three bands (vertex colours are linear in glTF) */
const FLAG_BANDS = {
  top: new THREE.Color(EVENT_BRAND.red),
  middle: new THREE.Color(EVENT_BRAND.white),
  bottom: new THREE.Color(EVENT_BRAND.black),
};

/** Rwanda's blue, yellow and green bands become the sponsor's red, white and black */
function recolourFlags(geometry: THREE.BufferGeometry): void {
  const colour = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (!colour) return;
  for (let i = 0; i < colour.count; i++) {
    const r = colour.getX(i);
    const g = colour.getY(i);
    const b = colour.getZ(i);
    const band = b > r && b > g ? FLAG_BANDS.top : r > 0.3 && g > 0.3 ? FLAG_BANDS.middle : FLAG_BANDS.bottom;
    colour.setXYZ(i, band.r, band.g, band.b);
  }
  colour.needsUpdate = true;
}

/** The screens' leaderboard is read again this often (ms) */
const SCREEN_REFRESH_MS = 60_000;
let screenTimer: number | null = null;

/**
 * Keeps the circuit's screens on the kiosk's leaderboard, when a kiosk server answers: the board of this circuit (the
 * one loaded, whatever the stored config names) and of the car the kiosk runs
 */
function followLeaderboard(screen: BrandTexture, trackId: string | undefined): void {
  if (screenTimer !== null) window.clearInterval(screenTimer);
  const refresh = async () => {
    try {
      const { config } = await loadKioskConfig();
      const board = await fetchLeaderboard({
        mode: rankingModeFor(config),
        trackId: trackId ?? config.trackId,
        carId: runnableCarId(config.carId),
        laps: config.laps,
        limit: 8,
      });
      const rows = board.rows.map((r) => ({
        rank: r.rank,
        name: r.name,
        time: formatLapTime(board.mode === "total" ? r.totalTimeMs : r.bestLapMs),
      }));
      screen.setPainter(paintScreen(rows));
    } catch {
      // No kiosk server (the plain game): the screens keep the event's card
    }
  };
  void refresh();
  const timer = window.setInterval(() => void refresh(), SCREEN_REFRESH_MS);
  screenTimer = timer;
  // The scene this screen belongs to is gone once its texture is disposed (a circuit switch)
  screen.texture.addEventListener("dispose", () => {
    window.clearInterval(timer);
    if (screenTimer === timer) screenTimer = null;
  });
}

const materialsOf = (mesh: THREE.Mesh): THREE.Material[] => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]);

// ---- Trackside boards for circuits with no banners of their own (every circuit but RISE Motordrome)

/** A board: 12 × 1.5 m, the banners' 8:1, on two posts */
const BOARD_W = 12;
const BOARD_H = 1.5;
const BOARD_DEPTH = 0.1;
/**
 * Gap between the ground and the board's lower edge, and how far the posts reach into the ground (m). Raised clear of
 * the barriers: a converted circuit's walls and fences hid boards standing on the ground (checked at Monza)
 */
const BOARD_LIFT_M = 2.2;
const POST_SINK_M = 0.6;
/** One board this often along the lap (m), sides taking turns */
const BOARD_SPACING_M = 55;
/** Beyond the barrier line (m) */
const BOARD_CLEARANCE_M = 2;
/** Straights and gentle bends only: a board on the outside of a corner sits where cars run wide */
const STRAIGHT_MAX_CURVATURE = 1 / 250;
/** The start-finish straight and the pit lane beside it stay clear: this far after the line, and before it (m) */
const START_CLEAR_AFTER_M = 300;
const START_CLEAR_BEFORE_M = 500;
/** Boards turn this far towards the oncoming cars (deg) */
const BOARD_TOE_DEG = 15;

interface BoardSpot {
  position: THREE.Vector3;
  yaw: number;
  kind: number;
  /** Lap distance and side (+1 right) it stands beside, and where its ground height came from */
  s: number;
  side: 1 | -1;
  ground: "collider" | "profile";
}

/** Ground height beside a sample: the outermost point of its lateral profile on that side (±12 m), else the road's */
function edgeHeight(sample: BuiltTrackData["samples"][number], side: 1 | -1): number {
  const prof = sample.yProf;
  if (prof && prof.length > 0) return side > 0 ? prof[prof.length - 1] : prof[0];
  return sample.position.y;
}

/** Where the boards go: outside the barrier line on straights, sides taking turns, never over another part of the lap */
/** Further out each board may go when the scan blocks it where the barrier line puts it (m, tried in turn) */
const BOARD_RETRY_OUT_M = [0, 3, 6];
/** Where a visitor sees a board from: the centreline this far before it, at a driver's eye height (m) */
const BOARD_VIEW_BACK_M = 60;
const BOARD_VIEW_HEIGHT_M = 1.2;

/**
 * The circuit's solid scenery (walls, stands, buildings, terrain) indexed for sight lines (segment-occluder.ts): no
 * hidden collider, nothing see-through (fences, foliage) and none of the boards themselves
 */
function solidSceneryOccluder(root: THREE.Object3D): SegmentOccluder {
  const meshes: THREE.Object3D[] = [];
  root.traverseVisible((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.every((m) => !m.transparent && m.alphaTest === 0 && !m.alphaHash)) meshes.push(mesh);
  });
  const occluder = new SegmentOccluder();
  const build = occluder.build(meshes);
  while (!build.next().done) {
    // Built at once: the circuit is still behind its loading screen
  }
  return occluder;
}

/** Whether the segment a → b crosses the solid scenery */
function segmentBlocked(occluder: SegmentOccluder, a: THREE.Vector3, b: THREE.Vector3, dir: THREE.Vector3, marginM: number): boolean {
  dir.subVectors(b, a);
  const length = dir.length();
  if (length <= marginM) return false;
  return occluder.blocked(a, dir.divideScalar(length), length - marginM);
}

/**
 * Whether a board stands clear: its outline and diagonals cross no wall, stand or building, and a driver coming down
 * the track sees at least two of its centre and ends
 */
function boardClear(occluder: SegmentOccluder, track: BuiltTrackData, s: number, foot: THREE.Vector3, yaw: number): boolean {
  const across = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const bottom = foot.y + BOARD_LIFT_M;
  const corner = (u: number, v: number) =>
    foot.clone().addScaledVector(across, (u * BOARD_W) / 2).setY(bottom + v * BOARD_H);
  const [bl, br, tl, tr] = [corner(-1, 0), corner(1, 0), corner(-1, 1), corner(1, 1)];
  const dir = new THREE.Vector3();
  for (const [a, b] of [[bl, br], [tl, tr], [bl, tl], [br, tr], [bl, tr], [br, tl]] as const) {
    if (segmentBlocked(occluder, a, b, dir, 0)) return false;
  }
  const back = track.getSampleAtDistance((((s - BOARD_VIEW_BACK_M) % track.totalLengthM) + track.totalLengthM) % track.totalLengthM);
  const eye = back.position.clone().setY(back.position.y + BOARD_VIEW_HEIGHT_M);
  const targets = [corner(0, 0.5), corner(-0.8, 0.5), corner(0.8, 0.5)];
  const hidden = targets.filter((t) => segmentBlocked(occluder, eye, t, dir, 0.3)).length;
  return hidden < 2;
}

/**
 * Where the boards go: outside the barrier line on straights, sides taking turns, never over another part of the lap,
 * and (with the scan's solid scenery to check against) never through a wall or stand or out of a driver's sight
 */
function boardSpots(root: THREE.Object3D, track: BuiltTrackData, kinds: number, occluder: SegmentOccluder | null): { spots: BoardSpot[]; dropped: number } {
  const spots: BoardSpot[] = [];
  let dropped = 0;
  const ground = trackColliders(root).ground;
  const hit = createGroundHit();
  const right = new THREE.Vector3();
  const along = new THREE.Vector3();
  const face = new THREE.Vector3();
  const toe = THREE.MathUtils.degToRad(BOARD_TOE_DEG);
  let side: 1 | -1 = 1;
  let nextS = START_CLEAR_AFTER_M;
  for (const sample of track.samples) {
    if (sample.s < nextS || sample.s > track.totalLengthM - START_CLEAR_BEFORE_M) continue;
    if (Math.abs(sample.curvature) > STRAIGHT_MAX_CURVATURE) continue;
    right.set(sample.binormal.x, 0, sample.binormal.z);
    if (right.lengthSq() < 1e-6) continue;
    right.normalize();
    const wall = side > 0 ? sample.wallRightM : sample.wallLeftM;
    const base = Math.max(wall ?? sample.width / 2 + 3, sample.width / 2 + 1) + BOARD_CLEARANCE_M;
    along.set(sample.tangent.x, 0, sample.tangent.z).normalize();
    face.copy(right).multiplyScalar(-side * Math.cos(toe)).addScaledVector(along, -Math.sin(toe)).normalize();
    const yaw = Math.atan2(face.x, face.z);
    let placed: BoardSpot | null = null;
    for (const out of BOARD_RETRY_OUT_M) {
      const position = sample.position.clone().addScaledVector(right, side * (base + out));
      // Not on (or right beside) another part of the lap: a hairpin's other leg, a parallel straight. Searched over
      // the whole lap (a hint would keep the search near this sample, where the board's own stretch always wins)
      const near = track.projectWorldToTrack(position.x, position.z);
      const lapGap = Math.min(Math.abs(near.s - sample.s), track.totalLengthM - Math.abs(near.s - sample.s));
      if (lapGap > 30 && Math.abs(near.lateralOffset) < near.sample.width / 2 + BOARD_CLEARANCE_M + 2) break;
      // Its foot on the ground: the physics ground where it reaches, else the edge of the lateral profile
      const guess = edgeHeight(sample, side);
      const onCollider = !!ground && ground.query(position.x, position.z, guess + 20, hit) && Math.abs(hit.height - guess) < 4;
      position.y = onCollider ? hit.height : guess;
      if (occluder && !boardClear(occluder, track, sample.s, position, yaw)) continue;
      placed = { position, yaw, kind: spots.length % kinds, s: sample.s, side, ground: onCollider ? "collider" : "profile" };
      break;
    }
    if (placed) {
      spots.push(placed);
      nextS = sample.s + BOARD_SPACING_M;
      side = side > 0 ? -1 : 1;
    } else {
      // Blocked here: try a little further on (the other side's turn stays the same)
      dropped++;
      nextS = sample.s + 15;
    }
  }
  return { spots, dropped };
}

/** The boards: one instanced mesh per picture (front face textured), one for all the posts */
function addTracksideBoards(root: THREE.Object3D, track: BuiltTrackData): number {
  const pictures = [
    brandTexture(1024, 128, paintSponsorBanner, BRAND_FILES.bannerSponsor),
    brandTexture(1024, 128, paintEventBanner, BRAND_FILES.bannerEvent),
    brandTexture(1024, 128, paintComboBanner, BRAND_FILES.bannerCombo),
  ];
  const { spots, dropped } = boardSpots(root, track, pictures.length, solidSceneryOccluder(root));
  if (dropped > 0) console.info(`[event] ${dropped} board spots skipped (walls, stands or no line of sight)`);
  // Test builds only (compiled out otherwise): an end-to-end test drives up to the boards to look at them
  if (process.env.NEXT_PUBLIC_KIOSK_TEST_HOOKS === "1") {
    (window as Window & { __kioskBoardSpots?: unknown }).__kioskBoardSpots = spots.map((b) => ({
      s: b.s,
      side: b.side,
      ground: b.ground,
      x: b.position.x,
      y: b.position.y,
      z: b.position.z,
    }));
  }
  if (spots.length === 0) return 0;
  const group = new THREE.Group();
  group.name = "Event_TracksideBoards";
  // Test builds only: a debug switch draws the boards huge and high, to tell a placement problem from a drawing one
  let debugScale = 1;
  let debugLift = 0;
  if (process.env.NEXT_PUBLIC_KIOSK_TEST_HOOKS === "1") {
    try {
      if (localStorage.getItem("kiosk.debugBoards") === "1") {
        debugScale = 4;
        debugLift = 6;
      }
    } catch {
      // No storage: normal boards
    }
    (window as Window & { __kioskBoardsGroup?: THREE.Group }).__kioskBoardsGroup = group;
  }
  const boardGeo = new THREE.BoxGeometry(BOARD_W, BOARD_H, BOARD_DEPTH);
  // The banner pictures are drawn the glTF way round (no flip): turn the box's UVs to match
  const uv = boardGeo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  const back = new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.8, metalness: 0.1 });
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const unit = new THREE.Vector3(debugScale, debugScale, debugScale);
  const centre = new THREE.Vector3();
  pictures.forEach((picture, kind) => {
    const mine = spots.filter((s) => s.kind === kind);
    if (mine.length === 0) return;
    const front = new THREE.MeshStandardMaterial({ map: picture.texture, roughness: 0.6, metalness: 0 });
    // BoxGeometry's groups: +x, -x, +y, -y, +z (the face), -z
    const boards = new THREE.InstancedMesh(boardGeo, [back, back, back, back, front, back], mine.length);
    mine.forEach((spot, i) => {
      quat.setFromAxisAngle(up, spot.yaw);
      centre.copy(spot.position).setY(spot.position.y + BOARD_LIFT_M + (BOARD_H * debugScale) / 2 + debugLift);
      boards.setMatrixAt(i, matrix.compose(centre, quat, unit));
    });
    boards.instanceMatrix.needsUpdate = true;
    boards.computeBoundingSphere();
    boards.computeBoundingBox();
    boards.receiveShadow = true;
    boards.name = `Event_Boards_${kind}`;
    group.add(boards);
  });
  const postH = BOARD_LIFT_M + POST_SINK_M + BOARD_H * 0.5;
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, postH, 0.14), back, spots.length * 2);
  const offset = new THREE.Vector3();
  spots.forEach((spot, i) => {
    quat.setFromAxisAngle(up, spot.yaw);
    for (const end of [-1, 1]) {
      offset.set(end * (BOARD_W / 2 - 0.6), 0, -BOARD_DEPTH).applyQuaternion(quat);
      centre.copy(spot.position).add(offset).setY(spot.position.y - POST_SINK_M + postH / 2);
      posts.setMatrixAt(i * 2 + (end > 0 ? 1 : 0), matrix.compose(centre, quat, unit));
    }
  });
  posts.instanceMatrix.needsUpdate = true;
  posts.computeBoundingSphere();
  posts.computeBoundingBox();
  posts.name = "Event_BoardPosts";
  group.add(posts);
  root.add(group);
  return spots.length;
}

/**
 * Puts the event's dressing on a loaded circuit: RISE Motordrome's own banners, screens, gantry, flags and kerbs take
 * the event's pictures and colours; a circuit without such banners (a converted scan) gets boards along its straights
 */
export function applyEventBranding(root: THREE.Object3D, track?: BuiltTrackData): void {
  if (!EVENT_BRANDING_ON || typeof document === "undefined") return;
  // A new circuit: the last one's screens stop asking for the leaderboard (their textures are never disposed when the
  // game switches circuit in place), and the test handles let go of the last circuit's boards
  if (screenTimer !== null) {
    window.clearInterval(screenTimer);
    screenTimer = null;
  }
  if (process.env.NEXT_PUBLIC_KIOSK_TEST_HOOKS === "1") {
    const w = window as Window & { __kioskBoardSpots?: unknown; __kioskBoardsGroup?: unknown };
    delete w.__kioskBoardSpots;
    delete w.__kioskBoardsGroup;
  }
  const banners = new Map<string, BrandTexture>();
  let screen: BrandTexture | null = null;
  let redWhiteKerb: THREE.Texture | null = null;
  const flagKerbs: THREE.MeshStandardMaterial[] = [];
  const recoloured = new Set<THREE.BufferGeometry>();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of materialsOf(mesh)) {
      const m = material as THREE.MeshStandardMaterial;
      if (!m.isMeshStandardMaterial) continue;
      const banner = BANNERS[m.name];
      if (banner) {
        let tex = banners.get(m.name);
        if (!tex) {
          tex = brandTexture(1024, 128, banner.paint, banner.artwork);
          banners.set(m.name, tex);
        }
        m.map = tex.texture;
        m.needsUpdate = true;
      } else if (m.name === "Screen_Live") {
        screen ??= brandTexture(512, 288, paintScreen([]), BRAND_FILES.screen);
        m.map = screen.texture;
        m.emissiveMap = screen.texture;
        m.needsUpdate = true;
      } else if (m.name === "Gantry_Blue") {
        m.color.set(EVENT_BRAND.red);
      } else if (m.name === "Flag_Cloth") {
        if (!recoloured.has(mesh.geometry)) {
          recolourFlags(mesh.geometry);
          recoloured.add(mesh.geometry);
        }
      } else if (m.name === "Kerb_RedWhite" && m.map) {
        redWhiteKerb = m.map;
      } else if (m.name === "Kerb_Rwanda") {
        flagKerbs.push(m);
      }
    }
  });
  // The kerbs painted in Rwanda's colours take the circuit's own red and white
  if (redWhiteKerb) {
    for (const m of flagKerbs) {
      m.map = redWhiteKerb;
      m.needsUpdate = true;
    }
  }
  if (screen) followLeaderboard(screen, track?.id);
  if (banners.size === 0 && track) {
    const boards = addTracksideBoards(root, track);
    if (boards > 0) console.info(`[event] ${boards} trackside boards placed`);
  }
}
