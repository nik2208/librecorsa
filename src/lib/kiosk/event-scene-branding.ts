/**
 * Dresses RISE Motordrome for the event: its trackside banners, big screens, start gantry, flags and flag-coloured
 * kerbs (Rwanda's, from scripts/rwanda-official) take the sponsor's and the event's colours and names.
 *
 * The banners show the logos the staff turned on (src/lib/kiosk/kiosk-logos.ts), each on its own board: its picture
 * from the kiosk server, else its name drawn here. RISE's model itself is not changed, only its materials once loaded; a
 * circuit without RISE's banners (a converted scan such as Monza) gets a group of boards along its straights
 * (addTracksideBoards). When the staff change the logos the boards change with them, mid-race: only their pictures are
 * swapped, nothing of the scene is rebuilt.
 */

import * as THREE from "three";
import { withBasePath } from "@/lib/base-path";
import { BRAND_FILES, EVENT_BRAND, EVENT_BRANDING_ON, WINDTRE_BRAND } from "@/lib/kiosk/event-brand";
import { fetchLeaderboard, loadKioskConfig } from "@/lib/kiosk/kiosk-api";
import { challengeName, getLogosSnapshot, logoAssetUrl, shownLogos, subscribeLogos, type KioskLogo, type LogoGround } from "@/lib/kiosk/kiosk-logos";
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

const paintWindtreBanner: Painter = (ctx, w, h, f) => {
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = WINDTRE_BRAND.orange;
  ctx.fillRect(0, 0, 36, h);
  ctx.fillRect(w - 36, 0, 36, h);
  fitText(ctx, WINDTRE_BRAND.name, w / 2, h / 2 + 3, w - 160, 84, `900 {size} ${f.display}`, WINDTRE_BRAND.orange, 14);
};

/** A board with a logo's name, for an uploaded logo whose picture can't be loaded */
const paintNameBanner =
  (name: string, ground: LogoGround): Painter =>
  (ctx, w, h, f) => {
    ctx.fillStyle = ground === "light" ? "#F7F7F5" : EVENT_BRAND.black;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = ground === "light" ? "#1C1C22" : "#34343C";
    ctx.fillRect(0, 0, 28, h);
    ctx.fillRect(w - 28, 0, 28, h);
    fitText(ctx, name.toUpperCase(), w / 2, h / 2 + 3, w - 120, 72, `900 {size} ${f.display}`, ground === "light" ? EVENT_BRAND.black : EVENT_BRAND.white, 6);
  };

/** The board of each built-in logo while (or when) its picture isn't there */
const BUILTIN_BANNERS: Record<string, Painter> = {
  huawei: paintSponsorBanner,
  mgw: paintEventBanner,
  windtre: paintWindtreBanner,
};
const bannerPainter = (logo: KioskLogo): Painter => BUILTIN_BANNERS[logo.id] ?? paintNameBanner(logo.name, logo.ground);

interface ScreenRow {
  rank: number;
  name: string;
  time: string;
}

/**
 * The screens' card: `title` names the logos shown, and the leaderboard's first rows when there are any; the game's name
 * (`challenge`); the event's name, dates and venue only while its logo is shown (`eventShown`)
 */
function paintScreen(rows: readonly ScreenRow[], title: string, eventShown = true, challenge: string = EVENT_BRAND.challengeNeutral): Painter {
  return (ctx, w, h, f) => {
    ctx.fillStyle = EVENT_BRAND.black;
    ctx.fillRect(0, 0, w, h);
    // Header: the event, and a LIVE badge as on a broadcast
    ctx.fillStyle = "#16161C";
    ctx.fillRect(0, 0, w, 44);
    ctx.fillStyle = EVENT_BRAND.red;
    ctx.fillRect(0, 0, 8, 44);
    fitText(ctx, title, 20, 23, w - 130, 22, `800 {size} ${f.display}`, EVENT_BRAND.white, 1, "left");
    ctx.fillStyle = EVENT_BRAND.red;
    ctx.fillRect(w - 92, 9, 80, 26);
    fitText(ctx, "LIVE", w - 52, 23, 70, 18, `900 {size} ${f.display}`, EVENT_BRAND.white, 2);
    if (rows.length > 0) {
      fitText(ctx, "CLASSIFICA · " + challenge, 20, 64, w - 40, 15, `700 {size} ${f.text}`, "#FF3B30", 2, "left");
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
      fitText(ctx, challenge, w / 2, 118, w - 50, 30, `900 {size} ${f.display}`, EVENT_BRAND.white, 2);
      fitText(ctx, "SFIDA IL CRONOMETRO!", w / 2, 162, w - 60, 22, `700 {size} ${f.text}`, "#FF3B30", 4);
      if (eventShown) fitText(ctx, EVENT_BRAND.event, w / 2, 206, w - 60, 17, `700 {size} ${f.text}`, "#C9C9CF", 2);
    }
    ctx.fillStyle = "#16161C";
    ctx.fillRect(0, h - 30, w, 30);
    if (eventShown) fitText(ctx, `${EVENT_BRAND.dates} · ${EVENT_BRAND.venue}`, w / 2, h - 15, w - 30, 14, `700 {size} ${f.text}`, "#BDBDC4", 2);
  };
}

interface BrandTexture {
  texture: THREE.CanvasTexture;
  setPainter: (paint: Painter) => void;
  /** Its picture is drawn, or there is none to wait for (none given, it failed, or it took too long) */
  ready: () => boolean;
  /** Calls `fn` once it is ready (at once when it is) */
  whenReady: (fn: () => void) => void;
  /** Frees it (a logo taken off the boards); a picture still on its way is then ignored */
  dispose: () => void;
}

/** A picture that hasn't loaded after this long gives way to the drawn text (ms) */
const PICTURE_WAIT_MS = 4000;

/**
 * A canvas texture the glTF way round (no flip), painted now and again once the web fonts have loaded, then covered by
 * its picture (`artworkUrl`, an address for the browser) once that has loaded
 */
function brandTexture(width: number, height: number, paint: Painter, artworkUrl: string | null): BrandTexture {
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
  let disposed = false;
  const draw = () => {
    if (!ctx || disposed) return;
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
  // The picture, when the kiosk server has one (an upload comes from the server's API: another origin under `next dev`)
  let ready = !artworkUrl;
  const waiting: (() => void)[] = [];
  const settle = () => {
    if (ready || disposed) return;
    ready = true;
    for (const fn of waiting.splice(0)) fn();
  };
  if (artworkUrl) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (disposed) return;
      artwork = img;
      draw();
      settle();
    };
    img.onerror = settle;
    window.setTimeout(settle, PICTURE_WAIT_MS);
    img.src = artworkUrl;
  }
  return {
    texture,
    setPainter: (next) => {
      painter = next;
      if (!artwork) draw();
    },
    ready: () => ready,
    whenReady: (fn) => {
      if (ready) fn();
      else waiting.push(fn);
    },
    dispose: () => {
      disposed = true;
      waiting.length = 0;
      texture.dispose();
    },
  };
}

/** RISE Motordrome's three banner materials, in the order the logos are dealt to them */
const RISE_BANNERS = ["Banner_Rwanda", "Banner_Bugesera", "Banner_Kigali"] as const;

/**
 * The boards' pictures, one per logo shown (a logo's new picture is a new texture), kept while it is shown (logos
 * taking turns come back to theirs) and freed once nothing shows it
 */
class LogoTextures {
  private readonly byKey = new Map<string, BrandTexture>();

  get(logo: KioskLogo): BrandTexture {
    const key = `${logo.id}|${logo.banner ?? ""}|${logo.name}|${logo.ground}`;
    let tex = this.byKey.get(key);
    if (!tex) {
      tex = brandTexture(1024, 128, bannerPainter(logo), logo.banner ? logoAssetUrl(logo.banner) : null);
      this.byKey.set(key, tex);
    }
    return tex;
  }

  /** The logo a texture is the picture of (one just hidden too, while it is still up somewhere) */
  idOf(texture: THREE.Texture | null): string | null {
    if (!texture) return null;
    for (const [key, tex] of this.byKey) if (tex.texture === texture) return key.slice(0, key.indexOf("|"));
    return null;
  }

  /** Frees every texture not in `keep` */
  keepOnly(keep: ReadonlySet<THREE.Texture>): void {
    for (const [key, tex] of this.byKey) {
      if (keep.has(tex.texture)) continue;
      tex.dispose();
      this.byKey.delete(key);
    }
  }
}

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
function followLeaderboard(screen: BrandTexture, trackId: string | undefined, onRows: (rows: ScreenRow[]) => void): void {
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
      onRows(
        board.rows.map((r) => ({
          rank: r.rank,
          name: r.name,
          time: formatLapTime(board.mode === "total" ? r.totalTimeMs : r.bestLapMs),
        }))
      );
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

/**
 * Places for pictures on the boards: the boards take one of these in turn along the lap, and each place shows one of the
 * logos turned on. Twelve deal 1, 2, 3, 4 or 6 logos out evenly; with more logos than places they take turns
 */
const BOARD_PLACES = 12;
/** With more logos than places, the boards move on to the next logos this often (ms) */
const ROTATE_MS = 20_000;

interface TracksideBoards {
  group: THREE.Group;
  /** The boards' front of each place, in order along the lap (the places with boards: fewer on a short circuit) */
  faces: THREE.MeshStandardMaterial[];
  /** The dark picture they show until a logo's is in */
  blank: THREE.Texture;
  count: number;
}

/** A dark picture the boards start with, before the logos are known (a texture from the start: no shader change later) */
function blankTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 4;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#18181c";
    ctx.fillRect(0, 0, 4, 4);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The boards: one instanced mesh per place (front face textured), one for all the posts */
function addTracksideBoards(root: THREE.Object3D, track: BuiltTrackData, blank: THREE.Texture): TracksideBoards | null {
  const { spots, dropped } = boardSpots(root, track, BOARD_PLACES, solidSceneryOccluder(root));
  if (dropped > 0) console.info(`[event] ${dropped} board spots skipped (walls, stands or no line of sight)`);
  // Test builds only (compiled out otherwise): an end-to-end test drives up to the boards to look at them
  if (process.env.NEXT_PUBLIC_KIOSK_TEST_HOOKS === "1") {
    (window as Window & { __kioskBoardSpots?: unknown }).__kioskBoardSpots = spots.map((b) => ({
      s: b.s,
      side: b.side,
      ground: b.ground,
      place: b.kind,
      x: b.position.x,
      y: b.position.y,
      z: b.position.z,
    }));
  }
  if (spots.length === 0) return null;
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
  // Two draws a place, not six: the box's five plain sides in one group, its front (+z, the picture) in the other
  const index = boardGeo.getIndex();
  if (index && boardGeo.groups.length === 6) {
    const side = (g: THREE.GeometryGroup) => Array.from(index.array.slice(g.start, g.start + g.count));
    const plain = [0, 1, 2, 3, 5].flatMap((f) => side(boardGeo.groups[f]));
    const front = side(boardGeo.groups[4]);
    boardGeo.setIndex([...plain, ...front]);
    boardGeo.clearGroups();
    boardGeo.addGroup(0, plain.length, 0);
    boardGeo.addGroup(plain.length, front.length, 1);
  }
  const back = new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.8, metalness: 0.1 });
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const unit = new THREE.Vector3(debugScale, debugScale, debugScale);
  const centre = new THREE.Vector3();
  const faces: THREE.MeshStandardMaterial[] = [];
  for (let place = 0; place < BOARD_PLACES; place++) {
    const mine = spots.filter((s) => s.kind === place);
    if (mine.length === 0) continue;
    const front = new THREE.MeshStandardMaterial({ map: blank, roughness: 0.6, metalness: 0 });
    faces.push(front);
    const boards = new THREE.InstancedMesh(boardGeo, [back, front], mine.length);
    mine.forEach((spot, i) => {
      quat.setFromAxisAngle(up, spot.yaw);
      centre.copy(spot.position).setY(spot.position.y + BOARD_LIFT_M + (BOARD_H * debugScale) / 2 + debugLift);
      boards.setMatrixAt(i, matrix.compose(centre, quat, unit));
    });
    boards.instanceMatrix.needsUpdate = true;
    boards.computeBoundingSphere();
    boards.computeBoundingBox();
    boards.receiveShadow = true;
    boards.name = `Event_Boards_${place}`;
    group.add(boards);
  }
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
  return { group, faces, blank, count: spots.length };
}

/** The last circuit's link to the logo list (its boards follow the staff's changes until another circuit loads) */
let stopFollowingLogos: (() => void) | null = null;

/**
 * Puts the event's dressing on a loaded circuit: RISE Motordrome's own banners, screens, gantry, flags and kerbs take
 * the event's pictures and colours; a circuit without such banners (a converted scan) gets boards along its straights.
 * The banners and boards then follow the logos the staff turn on and off, for as long as the circuit is loaded.
 */
export function applyEventBranding(root: THREE.Object3D, track?: BuiltTrackData): void {
  if (!EVENT_BRANDING_ON || typeof document === "undefined") return;
  // A new circuit: the last one's screens stop asking for the leaderboard and its boards stop following the logos
  // (their textures are never disposed when the game switches circuit in place), and the test handles let go of it
  if (screenTimer !== null) {
    window.clearInterval(screenTimer);
    screenTimer = null;
  }
  stopFollowingLogos?.();
  stopFollowingLogos = null;
  if (process.env.NEXT_PUBLIC_KIOSK_TEST_HOOKS === "1") {
    const w = window as Window & { __kioskBoardSpots?: unknown; __kioskBoardsGroup?: unknown; __kioskBrandState?: unknown };
    delete w.__kioskBoardSpots;
    delete w.__kioskBoardsGroup;
    delete w.__kioskBrandState;
  }
  /** RISE's banner materials, with the picture each came with (shown again when no logo is on) */
  const riseBanners: { material: THREE.MeshStandardMaterial; own: THREE.Texture | null; kind: number }[] = [];
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
      const kind = (RISE_BANNERS as readonly string[]).indexOf(m.name);
      if (kind >= 0) {
        if (!riseBanners.some((b) => b.material === m)) riseBanners.push({ material: m, own: m.map, kind });
      } else if (m.name === "Screen_Live") {
        screen ??= brandTexture(512, 288, paintScreen([], EVENT_BRAND.challengeNeutral), withBasePath(BRAND_FILES.screen));
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
  // The screens: the leaderboard under a title naming the logos shown
  const screenView = { rows: [] as ScreenRow[], title: EVENT_BRAND.challengeNeutral as string, eventShown: true, challenge: EVENT_BRAND.challengeNeutral as string };
  const paintedScreen = screen as BrandTexture | null;
  const repaintScreen = () => paintedScreen?.setPainter(paintScreen(screenView.rows, screenView.title, screenView.eventShown, screenView.challenge));
  if (paintedScreen) {
    followLeaderboard(paintedScreen, track?.id, (rows) => {
      screenView.rows = rows;
      repaintScreen();
    });
  }
  const boards = riseBanners.length === 0 && track ? addTracksideBoards(root, track, blankTexture()) : null;
  if (boards) console.info(`[event] ${boards.count} trackside boards placed`);
  if (!boards && riseBanners.length === 0 && !paintedScreen) return;

  // ---- The logos: each place on the boards and each RISE banner shows one of those turned on
  const textures = new LogoTextures();
  const places = Math.max(boards?.faces.length ?? 0, riseBanners.length > 0 ? RISE_BANNERS.length : 0);
  let offset = 0;
  let rotation: number | null = null;
  let showQueued = false;
  /** Another circuit has loaded: a picture coming in late must not deal anything (nor start turns nobody stops) */
  let stopped = false;
  /** The logos shown the last time, to tell one just turned on (an upload mid-race) */
  let lastShown: ReadonlySet<string> | null = null;
  const startTurns = () => {
    if (rotation !== null) window.clearInterval(rotation);
    if (stopped) return;
    rotation = window.setInterval(() => {
      offset = (offset + 1) % 100_000;
      show();
    }, ROTATE_MS);
  };
  // Once a picture still on its way is in
  const showSoon = () => {
    if (showQueued || stopped) return;
    showQueued = true;
    window.setTimeout(() => {
      showQueued = false;
      show();
    }, 0);
  };
  const show = () => {
    if (stopped) return;
    const list = getLogosSnapshot();
    const shown = shownLogos(list);
    // The turns settled first: logos back to their first places once they fit; with more logos than places, one just
    // turned on (an upload, mid-race) goes up at once in the first place (RISE's start gantry), its turn from there
    if (shown.length <= places) {
      if (rotation !== null) window.clearInterval(rotation);
      rotation = null;
      offset = 0;
    } else if (lastShown) {
      const seen = lastShown;
      let newest = -1;
      shown.forEach((l, i) => {
        if (!seen.has(l.id)) newest = i;
      });
      // (one already up on a surface stays where it is; offset only grows, so the place is taken modulo, never negative)
      const place = (((newest - offset) % shown.length) + shown.length) % shown.length;
      if (newest >= 0 && place >= places) {
        offset = newest;
        startTurns();
      }
    }
    if (list !== null) lastShown = new Set(shown.map((l) => l.id));
    // Every logo shown has its picture made (those waiting for their turn too), so a turn finds it loaded
    const own = shown.map((logo) => textures.get(logo));
    const keep = new Set<THREE.Texture>(own.map((t) => t.texture));
    /** The picture for surface `i`; until it is in, what the surface shows stays (a text placeholder never flashes up) */
    const pick = (i: number, current: THREE.Texture | null, blankUntil: THREE.Texture | null): THREE.Texture | null => {
      const t = own[(i + offset) % own.length];
      if (t.ready()) return t.texture;
      t.whenReady(showSoon);
      const stay = current ?? blankUntil;
      if (stay) keep.add(stay);
      return stay;
    };
    if (boards) {
      // Until the list is known no board shows (a logo turned off must never flash up), nor with every logo off; boards
      // coming back start from the dark picture, not from the logos they showed before
      const wasShown = boards.group.visible;
      boards.group.visible = shown.length > 0;
      if (shown.length > 0) {
        boards.faces.forEach((face, i) => {
          const tex = pick(i, wasShown ? face.map : boards.blank, boards.blank);
          if (tex && face.map !== tex) face.map = tex;
        });
      }
    }
    for (const b of riseBanners) {
      // RISE's own banners while no logo is on (or the list isn't known yet)
      const tex = shown.length > 0 ? pick(b.kind, b.material.map, b.own) : b.own;
      if (b.material.map !== tex) {
        b.material.map = tex;
        b.material.needsUpdate = true;
      }
    }
    textures.keepOnly(keep);
    const challenge = challengeName(list);
    const title = shown.length > 0 ? shown.map((l) => l.name).join(" × ") : challenge;
    // Until the list is known the event shows (as it always did); then only while its logo is on
    const eventShown = list === null || shown.some((l) => l.id === "mgw");
    if (title !== screenView.title || eventShown !== screenView.eventShown || challenge !== screenView.challenge) {
      screenView.title = title;
      screenView.eventShown = eventShown;
      screenView.challenge = challenge;
      repaintScreen();
    }
    // More logos than places: they take turns
    if (shown.length > places && rotation === null) startTurns();
    // Test builds only: which logo each place and banner shows (an end-to-end test changes them mid-race)
    if (process.env.NEXT_PUBLIC_KIOSK_TEST_HOOKS === "1") {
      const logoOf = (tex: THREE.Texture | null) => textures.idOf(tex);
      const banners = RISE_BANNERS.map((_, kind) => riseBanners.find((b) => b.kind === kind)?.material.map ?? null);
      (window as Window & { __kioskBrandState?: unknown }).__kioskBrandState = {
        known: list !== null,
        boards: boards ? (boards.group.visible ? boards.faces.map((f) => logoOf(f.map)) : []) : null,
        banners: riseBanners.length > 0 ? banners.map(logoOf) : null,
        title: screenView.title,
      };
    }
  };
  show();
  const unsubscribe = subscribeLogos(show);
  stopFollowingLogos = () => {
    stopped = true;
    unsubscribe();
    if (rotation !== null) window.clearInterval(rotation);
    rotation = null;
  };
}
