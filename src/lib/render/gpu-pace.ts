/**
 * Loading work handed to the GPU in pieces it can finish, with a wait for each before the next (issue #123). One task
 * that uploaded every texture of the circuit and then drew the whole of it was the load's biggest GPU submission: on a
 * software renderer 7.7 s in one go, and on a weak integrated GPU the kind of job a driver's hang check resets.
 */

/** A texture as far as its upload size goes (three's Texture, CompressedTexture, DataTexture and cube textures) */
interface TextureLike {
  isCompressedTexture?: boolean;
  mipmaps?: ArrayLike<{ data?: { byteLength: number } } | unknown> | null;
  generateMipmaps?: boolean;
  image?: unknown;
  source?: { data?: unknown };
}

function imageBytes(img: unknown): number {
  if (!img || typeof img !== "object") return 0;
  if (Array.isArray(img)) return img.reduce((sum: number, face) => sum + imageBytes(face), 0);
  const o = img as { data?: { byteLength?: number }; width?: number; height?: number; depth?: number };
  if (o.data && typeof o.data.byteLength === "number") return o.data.byteLength;
  if (typeof o.width === "number" && typeof o.height === "number") return o.width * o.height * Math.max(1, o.depth ?? 1) * 4;
  return 0;
}

/** About how many bytes a texture puts on the GPU when uploaded (its mipmaps included) */
export function textureBytes(tex: TextureLike): number {
  const mips = tex.mipmaps;
  if (tex.isCompressedTexture && mips && mips.length > 0) {
    let sum = 0;
    for (let i = 0; i < mips.length; i++) {
      const data = (mips[i] as { data?: { byteLength?: number } } | undefined)?.data;
      sum += typeof data?.byteLength === "number" ? data.byteLength : 0;
    }
    return sum;
  }
  const base = imageBytes(tex.source?.data ?? tex.image);
  // A generated mip chain adds a third
  return tex.generateMipmaps === false ? base : Math.round((base * 4) / 3);
}

/** `items` in order, cut into runs of at most `budget` bytes each (an item bigger than that alone in its run) */
export function slicesByBytes<T>(items: readonly T[], bytesOf: (item: T) => number, budget: number): T[][] {
  const out: T[][] = [];
  let run: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const b = Math.max(0, bytesOf(item));
    if (run.length > 0 && bytes + b > budget) {
      out.push(run);
      run = [];
      bytes = 0;
    }
    run.push(item);
    bytes += b;
  }
  if (run.length > 0) out.push(run);
  return out;
}

/**
 * `items` in order, cut into runs that each bring at most `maxNew` keys not met in an earlier run (an item with more
 * alone in its run). Drawing a scene's objects run by run this way puts at most `maxNew` first uses of a material
 * (its shader specialised, its textures bound the first time: the costly part of a first frame) in any one go.
 */
export function partsByNewKeys<T, K>(items: readonly T[], keysOf: (item: T) => readonly K[], maxNew: number): T[][] {
  const out: T[][] = [];
  const seen = new Set<K>();
  let run: T[] = [];
  let fresh = new Set<K>();
  for (const item of items) {
    const keys = keysOf(item).filter((k) => !seen.has(k) && !fresh.has(k));
    if (run.length > 0 && fresh.size + new Set(keys).size > maxNew) {
      out.push(run);
      for (const k of fresh) seen.add(k);
      run = [];
      fresh = new Set<K>();
    }
    run.push(item);
    for (const k of keys) fresh.add(k);
  }
  if (run.length > 0) out.push(run);
  return out;
}

/** The page is in a background tab, whose timers the browser slows to about one a second */
const pageHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/**
 * Resolves once the GPU has finished everything asked of it so far (a fence, polled between tasks: WebGL updates a
 * fence's status only then), or after `timeoutMs`, or at once with the context lost. In a hidden page it only flushes:
 * a poll a second there would stretch a load of dozens of waits past a minute, and nothing is on screen to keep
 * smooth. Never rejects.
 */
export function gpuFinished(
  context: WebGLRenderingContext | WebGL2RenderingContext,
  timeoutMs = 4000,
  hidden: () => boolean = pageHidden
): Promise<void> {
  if (context.isContextLost()) return Promise.resolve();
  context.flush();
  if (hidden()) return Promise.resolve();
  // WebGL 1 has no fences: a frame's wait instead
  if (!("fenceSync" in context)) return new Promise((resolve) => setTimeout(resolve, 16));
  const gl = context;
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  if (!sync) return new Promise((resolve) => setTimeout(resolve, 16));
  const start = performance.now();
  return new Promise((resolve) => {
    const poll = () => {
      const lost = gl.isContextLost();
      const status = lost ? gl.WAIT_FAILED : gl.clientWaitSync(sync, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED && performance.now() - start < timeoutMs) {
        setTimeout(poll, 4);
        return;
      }
      if (!lost) gl.deleteSync(sync);
      resolve();
    };
    setTimeout(poll, 0);
  });
}
