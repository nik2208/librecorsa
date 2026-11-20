// Edits the pictures inside a GLB for the event kiosk: other companies' marks off, Applikat's on, with the same artwork
// the kiosk's car wears (public/cars/f12026/liveries/applikat/decals.png). Used by unbrand-monza.mjs (the circuit) and
// fetch-kiosk-cars.mjs (the extra cars).
//
// Only the pictures change: each edited picture is re-encoded in its own format and written over its own bytes in the
// GLB's binary chunk; every other byte range (geometry, meshopt streams, the untouched pictures) keeps its bytes. A
// picture that no longer fits its old room pushes what follows by a multiple of 16 bytes, offsets updated.
import { readFileSync, writeFileSync } from 'node:fs';

// sharp is loaded when a picture is first edited, not on import: a caller that must not fail (the kiosk's car fetch,
// run before every build) then gets sharp's failure inside its own try
let sharpModule = null;
const loadSharp = async () => (sharpModule ??= (await import('sharp')).default);

// ---- Applikat's artwork: pieces of the car's decal sheet, [x, y, w, h]
const SHEET = 'public/cars/f12026/liveries/applikat/decals.png';
const PIECES = {
  /** The cat sticker (white outline, black cat, "AK") */
  sticker: [44, 48, 228, 220],
  /** "APPLIKAT" with its orange underline */
  name: [316, 84, 780, 164],
  /** "APPLIKAT" without the underline */
  letters: [316, 84, 780, 132],
  /** "applikat.it" */
  site: [44, 332, 1012, 168],
};
// The livery's colours (src/lib/kiosk/applikat-livery.ts)
export const CARBON = [15, 14, 12];
export const CREAM = [239, 233, 218];
export const RIBBON = [255, 75, 43];
/** Faded wall paint, for a painted advert */
export const PAINT = { paint: [222, 216, 202], opacity: 0.55 };

/** A piece `size` px tall before rotation. tone: "light" as on the car (cream, dark outline), "dark" all carbon (for
 * light backgrounds; the underline stays orange), or { paint, opacity }. rotate: 90 = reads top to bottom, 180 = upside
 * down, 270 = bottom to top */
export const item = (piece, size, tone = 'light', rotate = 0) => ({ piece, size, tone, rotate });
export const STICKER = (size, rotate = 0) => ({ piece: 'sticker', size, tone: 'light', rotate });
export const SPACE = (size) => ({ piece: 'space', size });

/** Fill a rectangle with the colour of pixel (sx, sy), or with `rgb` */
export const fill = (x, y, w, h, from) => ({ op: 'fill', x, y, w, h, from });
/** Copy the rectangle at (sx, sy) of the target's size over (x, y) */
export const clone = (x, y, w, h, sx, sy) => ({ op: 'clone', x, y, w, h, sx, sy });
/** Applikat artwork in a rectangle: optional background, then the items in a row or a column, scaled down to fit inside
 * `pad` and centred (align "start": from the left, `inset` px in). over: true for a decal sheet, where the artwork also
 * makes transparent pixels opaque */
export const art = (x, y, w, h, design) => ({ op: 'art', x, y, w, h, ...design });
/** Make a rectangle transparent (a decal sheet's sticker taken off) */
export const clear = (x, y, w, h) => ({ op: 'clear', x, y, w, h });
/** Fill a disc with the colour of pixel (sx, sy), or with `rgb` */
export const disc = (cx, cy, r, from) => ({ op: 'disc', cx, cy, r, from });
/** A tyre's sidewall: every pixel of the ring between r0 and r1 around (cx, cy), outside `keep` ([x, y, w, h], the
 * tread, where the rubber's grain is taken from), takes the ring's median colour at its radius plus that grain. Takes
 * off lettering and logos all round, on a colour picture or a normal map (whose median is the plain sidewall's slope) */
export const sidewall = (cx, cy, r0, r1, keep) => {
  if (!Array.isArray(keep) || keep.length !== 4) throw new Error('sidewall needs the tread rectangle (keep)');
  return { op: 'sidewall', cx, cy, r0, r1, keep };
};
/** A ring with a repeating pattern (a brake disc's bell, its bolts every 30°): every pixel between r0 and r1 at an angle
 * from a0 to a1 (degrees, 0 = +x, clockwise on the picture) takes the pixel `delta` degrees on, so lettering there gives
 * way to the ring's own pattern; with delta a multiple of the pattern's step the bolts line up */
export const ringClone = (cx, cy, r0, r1, a0, a1, delta) => ({ op: 'ringClone', cx, cy, r0, r1, a0, a1, delta });

let sheet = null;
/** One piece of the artwork, RGBA, `size` px tall before rotation */
async function renderPiece(it, size) {
  if (it.piece === 'space') return { data: null, w: size, h: size };
  const sharp = await loadSharp();
  sheet ??= await sharp(SHEET).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const [x, y, w, h] = PIECES[it.piece];
  const raw = { width: sheet.info.width, height: sheet.info.height, channels: 4 };
  const { data } = await sharp(sheet.data, { raw }).extract({ left: x, top: y, width: w, height: h }).raw().toBuffer({ resolveWithObject: true });
  if (it.tone !== 'light' && it.piece !== 'sticker') {
    const colour = it.tone === 'dark' ? CARBON : it.tone.paint;
    const opacity = it.tone === 'dark' ? 1 : it.tone.opacity;
    for (let i = 0; i < data.length; i += 4) {
      const underline = data[i] > 200 && data[i + 1] < 130 && data[i + 2] < 100;
      if (!(it.tone === 'dark' && underline)) [data[i], data[i + 1], data[i + 2]] = colour;
      data[i + 3] = Math.round(data[i + 3] * opacity);
    }
  }
  const height = Math.max(2, Math.round(size));
  const width = Math.max(2, Math.round((w * height) / h));
  let out = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).resize(width, height, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  if (it.rotate) {
    out = await sharp(out.data, { raw: { width: out.info.width, height: out.info.height, channels: 4 } }).rotate(it.rotate).raw().toBuffer({ resolveWithObject: true });
  }
  return { data: out.data, w: out.info.width, h: out.info.height };
}

/** The design's items laid out at scale k: [{data, w, h, x, y}], and the whole size */
async function layout(design, k) {
  const row = (design.dir ?? 'row') === 'row';
  const gap = (design.gap ?? 0) * k;
  const parts = [];
  for (const it of design.items) {
    const p = await renderPiece(it, it.size * k);
    // A spacer only takes room along the layout
    if (it.piece === 'space') (row ? (p.h = 0) : (p.w = 0));
    parts.push(p);
  }
  const W = row ? parts.reduce((s, p) => s + p.w, 0) + gap * (parts.length - 1) : Math.max(...parts.map((p) => p.w));
  const H = row ? Math.max(...parts.map((p) => p.h)) : parts.reduce((s, p) => s + p.h, 0) + gap * (parts.length - 1);
  let at = 0;
  for (const p of parts) {
    p.x = row ? at : (W - p.w) / 2;
    p.y = row ? (H - p.h) / 2 : at;
    at += (row ? p.w : p.h) + gap;
  }
  return { parts, W, H };
}

/** Alpha-blend an RGBA piece over the picture's pixels. Plain: a transparent pixel of the picture stays transparent
 * (a railing's gap). over: the usual "over" compositing, so the artwork shows on a transparent decal sheet too */
function blend(data, W, H, piece, ox, oy, over) {
  for (let y = 0; y < piece.h; y++) {
    const ty = oy + y;
    if (ty < 0 || ty >= H) continue;
    for (let x = 0; x < piece.w; x++) {
      const tx = ox + x;
      if (tx < 0 || tx >= W) continue;
      const s = (y * piece.w + x) * 4;
      const a = piece.data[s + 3] / 255;
      if (a === 0) continue;
      const d = (ty * W + tx) * 4;
      if (!over) {
        for (let c = 0; c < 3; c++) data[d + c] = Math.round(piece.data[s + c] * a + data[d + c] * (1 - a));
        continue;
      }
      const da = data[d + 3] / 255;
      const oa = a + da * (1 - a);
      for (let c = 0; c < 3; c++) data[d + c] = Math.round((piece.data[s + c] * a + data[d + c] * da * (1 - a)) / oa);
      data[d + 3] = Math.round(oa * 255);
    }
  }
}

/** Re-encode in the picture's own format: the first quality that fits the old room (nothing after it moves), else a
 * good one */
async function encode(raw, mime, channels, room) {
  const sharp = await loadSharp();
  const make = (quality) => {
    const img = sharp(Buffer.from(raw.data), { raw: { width: raw.W, height: raw.H, channels: 4 } });
    const pic = channels === 4 ? img : img.removeAlpha();
    if (mime === 'image/jpeg') return pic.jpeg({ quality, mozjpeg: true }).toBuffer();
    // Lossless: sharp's `effort` would turn on its 256-colour palette
    if (mime === 'image/png') return pic.png({ compressionLevel: 9, palette: false }).toBuffer();
    return pic.webp({ quality, alphaQuality: 100, effort: 6 }).toBuffer();
  };
  if (mime === 'image/png') return make(100);
  for (const quality of [92, 88, 85, 82]) {
    const out = await make(quality);
    if (out.length <= room) return out;
  }
  return make(90);
}

async function editPicture(bytes, mime, edits) {
  const sharp = await loadSharp();
  const meta = await sharp(bytes).metadata();
  const channels = meta.hasAlpha ? 4 : 3;
  // A grey picture (one or two channels) is edited, and written back, in colour: every op works on RGBA
  const img = meta.channels < 3 ? sharp(bytes).toColourspace('srgb') : sharp(bytes);
  const { data } = await img.ensureAlpha(meta.hasAlpha ? undefined : 1).raw().toBuffer({ resolveWithObject: true });
  const W = meta.width;
  const H = meta.height;
  const px = (x, y) => (Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4;
  const colourOf = (from) => (Array.isArray(from) ? [...data.subarray(px(from[0], from[1]), px(from[0], from[1]) + 3)] : from.rgb);
  const paint = (x0, y0, w, h, c) => {
    for (let y = y0; y < Math.min(H, y0 + h); y++)
      for (let x = x0; x < Math.min(W, x0 + w); x++) {
        const o = px(x, y);
        data[o] = c[0];
        data[o + 1] = c[1];
        data[o + 2] = c[2];
        // A transparent pixel (a railing's gap) stays transparent: only the colour changes there
        if (channels === 4 && data[o + 3] > 0) data[o + 3] = 255;
      }
  };
  for (const e of edits) {
    if (e.op === 'fill') paint(e.x, e.y, e.w, e.h, colourOf(e.from));
    if (e.op === 'clone') {
      const src = Buffer.from(data);
      for (let y = 0; y < e.h; y++)
        for (let x = 0; x < e.w; x++) {
          if (e.x + x >= W || e.y + y >= H) continue;
          const o = px(e.x + x, e.y + y);
          const s = px(e.sx + x, e.sy + y);
          for (let k = 0; k < 4; k++) data[o + k] = src[s + k];
        }
    }
    if (e.op === 'clear') {
      // Colour too, not just alpha: the mark must not stay in the file, nor bleed into the edges a filter or mipmap blends
      for (let y = e.y; y < Math.min(H, e.y + e.h); y++) for (let x = e.x; x < Math.min(W, e.x + e.w); x++) data.fill(0, px(x, y), px(x, y) + 4);
    }
    if (e.op === 'ringClone') {
      const src = Buffer.from(data);
      const toRad = Math.PI / 180;
      for (let y = Math.max(0, Math.floor(e.cy - e.r1)); y <= Math.min(H - 1, Math.ceil(e.cy + e.r1)); y++)
        for (let x = Math.max(0, Math.floor(e.cx - e.r1)); x <= Math.min(W - 1, Math.ceil(e.cx + e.r1)); x++) {
          const dx = x - e.cx;
          const dy = y - e.cy;
          const r = Math.hypot(dx, dy);
          if (r < e.r0 || r > e.r1) continue;
          const a = Math.atan2(dy, dx) / toRad;
          const inside = (deg) => ((((deg - e.a0) % 360) + 360) % 360) <= ((((e.a1 - e.a0) % 360) + 360) % 360);
          if (!inside(a)) continue;
          // Bilinear sample of the untouched picture, delta degrees on
          const b = (a + e.delta) * toRad;
          const sx = e.cx + r * Math.cos(b);
          const sy = e.cy + r * Math.sin(b);
          const x0 = Math.floor(sx);
          const y0 = Math.floor(sy);
          const fx = sx - x0;
          const fy = sy - y0;
          const o = px(x, y);
          for (let c = 0; c < 4; c++) {
            const v =
              src[px(x0, y0) + c] * (1 - fx) * (1 - fy) +
              src[px(x0 + 1, y0) + c] * fx * (1 - fy) +
              src[px(x0, y0 + 1) + c] * (1 - fx) * fy +
              src[px(x0 + 1, y0 + 1) + c] * fx * fy;
            data[o + c] = Math.round(v);
          }
        }
    }
    if (e.op === 'disc') {
      const c = colourOf(e.from);
      for (let y = Math.floor(e.cy - e.r); y <= Math.ceil(e.cy + e.r); y++)
        for (let x = Math.floor(e.cx - e.r); x <= Math.ceil(e.cx + e.r); x++)
          if (x >= 0 && y >= 0 && x < W && y < H && Math.hypot(x - e.cx, y - e.cy) <= e.r) paint(x, y, 1, 1, c);
    }
    if (e.op === 'sidewall') {
      const inKeep = (x, y) => x >= e.keep[0] && y >= e.keep[1] && x < e.keep[0] + e.keep[2] && y < e.keep[1] + e.keep[3];
      const bins = new Map();
      const ring = [];
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const r = Math.round(Math.hypot(x - e.cx, y - e.cy));
          if (r < e.r0 || r > e.r1 || inKeep(x, y)) continue;
          const o = px(x, y);
          ring.push([o, r]);
          if (!bins.has(r)) bins.set(r, [[], [], []]);
          const b = bins.get(r);
          for (let c = 0; c < 3; c++) b[c].push(data[o + c]);
        }
      const median = (a) => a.sort((p, q) => p - q)[a.length >> 1];
      const profile = new Map([...bins].map(([r, b]) => [r, b.map(median)]));
      // The grain: a 32 px patch of plain rubber from the kept area (the tread), as each channel's difference from the
      // patch's own mean, tiled over the ring (on a normal map, the tread's own small bumps)
      const [gx0, gy0] = [e.keep[0] + 8, e.keep[1] + Math.floor(e.keep[3] / 2) - 16];
      const patchMean = [0, 0, 0];
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) for (let c = 0; c < 3; c++) patchMean[c] += data[px(gx0 + x, gy0 + y) + c] / 1024;
      for (const [o, r] of ring) {
        const p = profile.get(r);
        const pixel = o / 4;
        const g = px(gx0 + ((pixel % W) % 32), gy0 + (Math.floor(pixel / W) % 32));
        for (let c = 0; c < 3; c++) data[o + c] = Math.max(0, Math.min(255, Math.round(p[c] + Math.max(-6, Math.min(6, data[g + c] - patchMean[c])))));
      }
    }
    if (e.op === 'art') {
      if (e.bg) paint(e.x, e.y, e.w, e.h, e.bg);
      const pad = e.pad ?? 0;
      const first = await layout(e, 1);
      const k = Math.min(1, (e.w - 2 * pad) / first.W, (e.h - 2 * pad) / first.H);
      // Drawn again at the fitted size rather than shrunk afterwards, so thin outlines stay sharp
      const { parts, W: lw, H: lh } = k < 1 ? await layout(e, k) : first;
      const ox = e.align === 'start' ? e.x + pad + (e.inset ?? 0) : e.x + (e.w - lw) / 2;
      const oy = e.y + (e.h - lh) / 2;
      for (const p of parts) if (p.data) blend(data, W, H, p, Math.round(ox + p.x), Math.round(oy + p.y), e.over);
    }
  }
  return encode({ data, W, H }, mime, channels, bytes.length);
}

function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binHeader = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binHeader);
  const bin = buf.subarray(binHeader + 8, binHeader + 8 + binLen);
  return { json, bin };
}

function writeGlb(json, bin) {
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + text.length + 8 + binPadded.length, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(text.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(binPadded.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jsonHead, text, binHead, binPadded]);
}

/** The texture slots an edit can name after the material ("tyre#normalTexture"); the base colour by default */
const SLOTS = {
  baseColorTexture: (m) => m.pbrMetallicRoughness?.baseColorTexture,
  metallicRoughnessTexture: (m) => m.pbrMetallicRoughness?.metallicRoughnessTexture,
  normalTexture: (m) => m.normalTexture,
  occlusionTexture: (m) => m.occlusionTexture,
  emissiveTexture: (m) => m.emissiveTexture,
};

/** The images a material's texture slot shows ("material" or "material#slot"): the EXT_texture_webp source and the
 * plain fallback source when it has both, so no copy of a mark stays in the file */
function imagesOf(json, key) {
  const [materialName, slot = 'baseColorTexture'] = key.split('#');
  const m = json.materials.find((x) => x.name === materialName);
  if (!m) throw new Error(`no material ${materialName}`);
  if (!SLOTS[slot]) throw new Error(`${key}: unknown texture slot ${slot}`);
  const tex = json.textures?.[SLOTS[slot](m)?.index];
  const images = [...new Set([tex?.extensions?.EXT_texture_webp?.source, tex?.source].filter((i) => i !== undefined))];
  if (!images.length) throw new Error(`${key}: no picture`);
  return images;
}

/** The mark an earlier run left in the GLB at `file`, or null */
export function markOf(file, key = 'unbrandedBy') {
  return parseGlb(readFileSync(file)).json.asset?.extras?.[key] ?? null;
}

/** An sRGB colour (0-255) as a glTF base colour factor (linear, alpha 1) */
export const linear = (rgb) => [...rgb.map((c) => ((c / 255 + 0.055) / 1.055) ** 2.4), 1];

/**
 * Applies `edits` ({ materialName: [ops] }) to the GLB at `file`, in place, and `colours` ({ materialName: factor })
 * to materials' base colour factors. `mark` goes in asset.extras[markKey]; `extras` are merged there too. A picture
 * shared by several materials is edited once (the first listed).
 */
export async function editGlb(file, edits, { mark, markKey = 'unbrandedBy', extras = {}, colours = {}, renames = {}, log = console.log } = {}) {
  const { json, bin } = parseGlb(readFileSync(file));
  // Node and scene names ({ oldName: newName }): names nothing loads by, such as an upload site's wrapper nodes
  for (const list of [json.nodes ?? [], json.scenes ?? []])
    for (const n of list)
      if (n.name && Object.prototype.hasOwnProperty.call(renames, n.name)) {
        log(`${n.name.padEnd(22)} renamed ${renames[n.name]}`);
        n.name = renames[n.name];
      }
  for (const [material, factor] of Object.entries(colours)) {
    const m = json.materials.find((x) => x.name === material);
    if (!m) throw new Error(`no material ${material}`);
    m.pbrMetallicRoughness = { ...(m.pbrMetallicRoughness ?? {}), baseColorFactor: factor };
    log(`${material.padEnd(22)} colour -> ${factor.map((c) => c.toFixed(3)).join(', ')}`);
  }
  const replace = new Map();
  for (const [material, ops] of Object.entries(edits))
    for (const image of imagesOf(json, material)) {
      const viewIndex = json.images[image].bufferView;
      if (replace.has(viewIndex)) continue;
      const view = json.bufferViews[viewIndex];
      if ((view.buffer ?? 0) !== 0) throw new Error(`${material}: picture outside the GLB's own buffer`);
      const old = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
      const next = await editPicture(old, json.images[image].mimeType ?? 'image/webp', ops);
      replace.set(viewIndex, next);
      log(`${material.padEnd(22)} picture ${image}: ${old.length} -> ${next.length} bytes`);
    }

  // Every byte range of buffer 0: plain buffer views, and the meshopt streams the compressed views point at
  const ranges = [];
  json.bufferViews.forEach((v, i) => {
    if ((v.buffer ?? 0) === 0) ranges.push({ kind: 'view', i, start: v.byteOffset ?? 0, len: v.byteLength });
    const m = v.extensions?.EXT_meshopt_compression;
    if (m && (m.buffer ?? 0) === 0) ranges.push({ kind: 'meshopt', i, start: m.byteOffset ?? 0, len: m.byteLength });
  });
  ranges.sort((a, b) => a.start - b.start);
  for (let k = 1; k < ranges.length; k++)
    if (ranges[k].start < ranges[k - 1].start + ranges[k - 1].len) throw new Error('overlapping byte ranges: not rebuilt');

  // Rebuilt binary chunk: a picture that fits keeps its room (no offset moves); one that does not pushes what follows
  // by a multiple of 16 bytes, so every later range keeps its alignment
  const parts = [];
  let cursor = 0;
  let shift = 0;
  for (const r of ranges) {
    parts.push(bin.subarray(cursor, r.start));
    const newStart = r.start + shift;
    const target = r.kind === 'view' ? json.bufferViews[r.i] : json.bufferViews[r.i].extensions.EXT_meshopt_compression;
    if (r.kind === 'view' && replace.has(r.i)) {
      const next = replace.get(r.i);
      const room = next.length <= r.len ? r.len : r.len + Math.ceil((next.length - r.len) / 16) * 16;
      parts.push(Buffer.concat([next, Buffer.alloc(room - next.length, 0)]));
      target.byteLength = next.length;
      shift += room - r.len;
    } else {
      parts.push(bin.subarray(r.start, r.start + r.len));
    }
    target.byteOffset = newStart;
    cursor = r.start + r.len;
  }
  parts.push(bin.subarray(cursor));
  const newBin = Buffer.concat(parts);
  json.buffers[0].byteLength = newBin.length;
  json.asset = { ...json.asset, extras: { ...(json.asset.extras ?? {}), [markKey]: mark, ...extras } };
  writeFileSync(file, writeGlb(json, newBin));
  log(`${file}: ${replace.size} pictures rewritten, binary chunk ${bin.length} -> ${newBin.length} bytes (shift ${shift})`);
  return { pictures: replace.size, shift };
}
