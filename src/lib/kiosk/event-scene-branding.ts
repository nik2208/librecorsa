/**
 * Dresses RISE Motordrome for the event: its trackside banners, big screens, start gantry, flags and flag-coloured
 * kerbs (Rwanda's, from scripts/rwanda-official) take the sponsor's and the event's colours and names.
 *
 * The banners and screens are drawn here as text placeholders unless the official artwork is in public/kiosk/brand/
 * (event-brand.ts BRAND_FILES). The circuit's model itself is not changed: only its materials, once loaded.
 */

import * as THREE from "three";
import { withBasePath } from "@/lib/base-path";
import { BRAND_FILES, EVENT_BRAND, EVENT_BRANDING_ON } from "@/lib/kiosk/event-brand";
import { fetchLeaderboard } from "@/lib/kiosk/kiosk-api";
import { formatLapTime } from "@/lib/kiosk/kiosk-score";
import type { BuiltTrackData } from "@/lib/track-data";
import { trackColliders } from "@/lib/sim/track-colliders";
import { createGroundHit } from "@/lib/sim/f12026-car/TrackColliderQuery";

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

/** Keeps the circuit's screens on the kiosk's leaderboard, when a kiosk server answers */
function followLeaderboard(screen: BrandTexture): void {
  if (screenTimer !== null) window.clearInterval(screenTimer);
  const refresh = async () => {
    try {
      const board = await fetchLeaderboard({ limit: 8 });
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

/** A board: 8 × 1 m, the banners' 8:1, on two posts */
const BOARD_W = 8;
const BOARD_H = 1;
const BOARD_DEPTH = 0.08;
/** Gap between the ground and the board's lower edge, and how far the posts reach into the ground (m) */
const BOARD_LIFT_M = 0.35;
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
}

/** Ground height beside a sample: the outermost point of its lateral profile on that side (±12 m), else the road's */
function edgeHeight(sample: BuiltTrackData["samples"][number], side: 1 | -1): number {
  const prof = sample.yProf;
  if (prof && prof.length > 0) return side > 0 ? prof[prof.length - 1] : prof[0];
  return sample.position.y;
}

/** Where the boards go: outside the barrier line on straights, sides taking turns, never over another part of the lap */
function boardSpots(root: THREE.Object3D, track: BuiltTrackData, kinds: number): BoardSpot[] {
  const spots: BoardSpot[] = [];
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
    nextS = sample.s + BOARD_SPACING_M;
    right.set(sample.binormal.x, 0, sample.binormal.z);
    if (right.lengthSq() < 1e-6) continue;
    right.normalize();
    const wall = side > 0 ? sample.wallRightM : sample.wallLeftM;
    const lateral = Math.max(wall ?? sample.width / 2 + 3, sample.width / 2 + 1) + BOARD_CLEARANCE_M;
    const position = sample.position.clone().addScaledVector(right, side * lateral);
    // Not on (or right beside) another part of the lap: a hairpin's other leg, a parallel straight
    const near = track.projectWorldToTrack(position.x, position.z, sample.s);
    const lapGap = Math.min(Math.abs(near.s - sample.s), track.totalLengthM - Math.abs(near.s - sample.s));
    if (lapGap > 30 && Math.abs(near.lateralOffset) < near.sample.width / 2 + BOARD_CLEARANCE_M + 2) {
      side = side > 0 ? -1 : 1;
      continue;
    }
    // Its foot on the ground: the physics ground where it reaches, else the edge of the lateral profile
    const guess = edgeHeight(sample, side);
    position.y = ground && ground.query(position.x, position.z, guess + 20, hit) && Math.abs(hit.height - guess) < 4 ? hit.height : guess;
    // Facing the track, turned a little towards the cars coming
    along.set(sample.tangent.x, 0, sample.tangent.z).normalize();
    face.copy(right).multiplyScalar(-side * Math.cos(toe)).addScaledVector(along, -Math.sin(toe)).normalize();
    spots.push({ position, yaw: Math.atan2(face.x, face.z), kind: spots.length % kinds });
    side = side > 0 ? -1 : 1;
  }
  return spots;
}

/** The boards: one instanced mesh per picture (front face textured), one for all the posts */
function addTracksideBoards(root: THREE.Object3D, track: BuiltTrackData): number {
  const pictures = [
    brandTexture(1024, 128, paintSponsorBanner, BRAND_FILES.bannerSponsor),
    brandTexture(1024, 128, paintEventBanner, BRAND_FILES.bannerEvent),
    brandTexture(1024, 128, paintComboBanner, BRAND_FILES.bannerCombo),
  ];
  const spots = boardSpots(root, track, pictures.length);
  if (spots.length === 0) return 0;
  const group = new THREE.Group();
  group.name = "Event_TracksideBoards";
  const boardGeo = new THREE.BoxGeometry(BOARD_W, BOARD_H, BOARD_DEPTH);
  // The banner pictures are drawn the glTF way round (no flip): turn the box's UVs to match
  const uv = boardGeo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  const back = new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.8, metalness: 0.1 });
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const unit = new THREE.Vector3(1, 1, 1);
  const centre = new THREE.Vector3();
  pictures.forEach((picture, kind) => {
    const mine = spots.filter((s) => s.kind === kind);
    if (mine.length === 0) return;
    const front = new THREE.MeshStandardMaterial({ map: picture.texture, roughness: 0.6, metalness: 0 });
    // BoxGeometry's groups: +x, -x, +y, -y, +z (the face), -z
    const boards = new THREE.InstancedMesh(boardGeo, [back, back, back, back, front, back], mine.length);
    mine.forEach((spot, i) => {
      quat.setFromAxisAngle(up, spot.yaw);
      centre.copy(spot.position).setY(spot.position.y + BOARD_LIFT_M + BOARD_H / 2);
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
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, postH, 0.1), back, spots.length * 2);
  const offset = new THREE.Vector3();
  spots.forEach((spot, i) => {
    quat.setFromAxisAngle(up, spot.yaw);
    for (const end of [-1, 1]) {
      offset.set((end * (BOARD_W / 2 - 0.4)), 0, -BOARD_DEPTH).applyQuaternion(quat);
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
  if (screen) followLeaderboard(screen);
  if (banners.size === 0 && track) {
    const boards = addTracksideBoards(root, track);
    if (boards > 0) console.info(`[event] ${boards} trackside boards placed`);
  }
}
