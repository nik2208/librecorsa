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

/** Puts the event's dressing on a loaded circuit (RISE Motordrome's materials; other circuits are left as they are) */
export function applyEventBranding(root: THREE.Object3D): void {
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
}
