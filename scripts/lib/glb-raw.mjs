/**
 * Byte-level GLB reading and writing for the circuit tools: reads a GLB's JSON and binary chunk, decodes its
 * EXT_meshopt_compression buffer views, and writes a GLB from a JSON document and a list of binary blocks. Nothing is
 * re-encoded unless a caller asks for it, so a tool that copies buffer views keeps their bytes exactly.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export const MESHOPT = "EXT_meshopt_compression";

/** Bytes per component, by glTF component type */
export const COMPONENT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
/** Components per element, by accessor type */
export const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

export const ready = Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);

export const md5 = (buf) => createHash("md5").update(buf).digest("hex");
export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** A GLB's JSON and its binary chunk (buffer 0) */
export function readGlb(path) {
  const buf = readFileSync(path);
  return parseGlb(buf, path);
}

export function parseGlb(buf, label = "GLB") {
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${label}: not a GLB`);
  let offset = 12;
  let json;
  let bin = Buffer.alloc(0);
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(data.toString("utf8"));
    else if (type === CHUNK_BIN) bin = data;
    offset += 8 + len;
  }
  if (!json) throw new Error(`${label}: no JSON chunk`);
  return { json, bin, bytes: buf };
}

/** The meshopt record of a buffer view, or undefined for a plain one */
export const meshoptOf = (bv) => bv.extensions?.[MESHOPT];

/** Whether a buffer is meshopt's fallback (no bytes of its own in the GLB) */
export const isFallbackBuffer = (b) => Boolean(b?.extensions?.[MESHOPT]?.fallback);

/**
 * A buffer view's bytes as the GPU sees them (decoded). `filter: false` leaves a meshopt filter (octahedral normals,
 * quaternions, exponents) undone: the stored form, which encodes back to the same bytes.
 */
export function viewBytes(glb, bvIndex, { filter = true } = {}) {
  const bv = glb.json.bufferViews[bvIndex];
  const ext = meshoptOf(bv);
  if (!ext) {
    if (bv.buffer !== 0) throw new Error(`buffer view ${bvIndex}: data outside the GLB's binary chunk`);
    return glb.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  }
  if (ext.buffer !== 0) throw new Error(`buffer view ${bvIndex}: compressed data outside the GLB's binary chunk`);
  const source = glb.bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength);
  const target = new Uint8Array(ext.count * ext.byteStride);
  MeshoptDecoder.decodeGltfBuffer(target, ext.count, ext.byteStride, source, ext.mode, filter ? ext.filter : undefined);
  return Buffer.from(target.buffer, target.byteOffset, target.byteLength);
}

/** The compressed bytes of a meshopt buffer view */
export function compressedBytes(glb, bvIndex) {
  const ext = meshoptOf(glb.json.bufferViews[bvIndex]);
  return glb.bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength);
}

/** Element size in bytes of an accessor */
export const elementSize = (acc) => COMPONENT_SIZE[acc.componentType] * TYPE_SIZE[acc.type];

/**
 * An accessor's elements, tightly packed (stride removed), from its decoded view. `views` caches decoded views by
 * index (pass a Map to share it between calls)
 */
export function accessorBytes(glb, accIndex, { filter = true, views } = {}) {
  const acc = glb.json.accessors[accIndex];
  if (acc.sparse) throw new Error(`accessor ${accIndex}: sparse accessors are not supported`);
  if (acc.bufferView === undefined) throw new Error(`accessor ${accIndex}: no buffer view`);
  const key = `${acc.bufferView}:${filter ? 1 : 0}`;
  let data = views?.get(key);
  if (!data) {
    data = viewBytes(glb, acc.bufferView, { filter });
    views?.set(key, data);
  }
  const bv = glb.json.bufferViews[acc.bufferView];
  const size = elementSize(acc);
  const stride = bv.byteStride ?? size;
  const base = acc.byteOffset ?? 0;
  if (stride === size) return data.subarray(base, base + size * acc.count);
  const out = Buffer.alloc(size * acc.count);
  for (let i = 0; i < acc.count; i++) data.copy(out, i * size, base + i * stride, base + i * stride + size);
  return out;
}

/** Encodes a buffer view's stored (unfiltered) bytes with meshopt, in the mode it had */
export function encodeView(stored, count, byteStride, mode, version) {
  const src = new Uint8Array(stored.buffer, stored.byteOffset, stored.byteLength);
  const out = MeshoptEncoder.encodeGltfBuffer(src, count, byteStride, mode, mode === "ATTRIBUTES" ? version : undefined);
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

/** The vertex codec version a compressed attribute stream was written with (its first byte is 0xa0 | version) */
export const attributeCodecVersion = (compressed) => compressed[0] & 0x0f;

const pad4 = (n) => (n + 3) & ~3;

/**
 * Writes a GLB. `blocks` are the binary chunk's pieces in order; each starts on a 4-byte boundary and the JSON must
 * already hold their offsets (see `BinWriter`).
 */
export function writeGlbBytes(json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  const jsonLen = pad4(jsonBuf.length);
  const binLen = pad4(bin.length);
  const total = 12 + 8 + jsonLen + (bin.length ? 8 + binLen : 0);
  const out = Buffer.alloc(total);
  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonLen, 12);
  out.writeUInt32LE(CHUNK_JSON, 16);
  jsonBuf.copy(out, 20);
  out.fill(0x20, 20 + jsonBuf.length, 20 + jsonLen);
  if (bin.length) {
    const o = 20 + jsonLen;
    out.writeUInt32LE(binLen, o);
    out.writeUInt32LE(CHUNK_BIN, o + 4);
    bin.copy(out, o + 8);
  }
  return out;
}

/** Collects the binary chunk (buffer 0) and meshopt's fallback buffer space while a GLB is assembled */
export class BinWriter {
  constructor() {
    this.parts = [];
    this.length = 0;
    this.fallbackLength = 0;
  }
  /** Appends bytes on a 4-byte boundary; returns their offset */
  add(bytes) {
    const at = pad4(this.length);
    if (at > this.length) this.parts.push(Buffer.alloc(at - this.length));
    this.parts.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    this.length = at + bytes.byteLength;
    return at;
  }
  /** Reserves decoded space in the fallback buffer; returns its offset */
  reserveFallback(byteLength) {
    const at = pad4(this.fallbackLength);
    this.fallbackLength = at + byteLength;
    return at;
  }
  bin() {
    return Buffer.concat(this.parts, this.length);
  }
}
