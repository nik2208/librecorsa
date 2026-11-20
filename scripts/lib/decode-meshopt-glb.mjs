/**
 * Writes a copy of a meshopt-compressed GLB without EXT_meshopt_compression (KHR_mesh_quantization data is
 * kept), so glb-geometry.ts can read it synchronously:  node scripts/lib/decode-meshopt-glb.mjs <in.glb> <out.glb>
 *
 * Works on the bytes (glb-raw.mjs): every buffer view is written decoded into one buffer and the rest of the JSON is
 * left as it is, so extensions this tooling doesn't know (a venue layout file's LC_venue_shared) come through.
 */
import { writeFileSync } from "node:fs";
import { BinWriter, MESHOPT, meshoptOf, readGlb, ready, viewBytes, writeGlbBytes } from "./glb-raw.mjs";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node scripts/lib/decode-meshopt-glb.mjs <in.glb> <out.glb>");
  process.exit(1);
}

await ready;
const glb = readGlb(input);
const json = structuredClone(glb.json);
const bin = new BinWriter();
json.bufferViews = glb.json.bufferViews.map((bv, i) => {
  const data = viewBytes(glb, i);
  const { extensions, ...rest } = bv;
  const out = { ...rest, buffer: 0, byteOffset: bin.add(data), byteLength: data.length };
  if (meshoptOf(bv)) {
    const others = { ...extensions };
    delete others[MESHOPT];
    if (Object.keys(others).length) out.extensions = others;
  } else if (extensions) out.extensions = extensions;
  return out;
});
const data = bin.bin();
json.buffers = [{ byteLength: data.length }];
for (const key of ["extensionsUsed", "extensionsRequired"]) {
  if (!json[key]) continue;
  json[key] = json[key].filter((e) => e !== MESHOPT);
  if (!json[key].length) delete json[key];
}
writeFileSync(output, writeGlbBytes(json, data));
