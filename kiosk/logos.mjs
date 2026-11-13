/**
 * The logos the kiosk shows (event branch): which ones, in what order, and the staff's own.
 *
 * Three are built in: HUAWEI, Milan Games Week and WINDTRE, whose pictures kiosk/brand.mjs makes at start into the
 * served build (/kiosk/brand/). They can be hidden, not deleted. The staff can add more from the admin page while the
 * kiosk runs: each upload is drawn at once (drawUploadedLogo: its picture for the screens and its trackside board) and
 * the game, which reads this list every few seconds, puts it on the boards in the middle of a race.
 *
 * Stored in KIOSK_DATA_DIR: logos.json (the list) and logos/ (each upload's file and its two pictures). Only the drawn
 * PNGs are ever served, never an uploaded file (an SVG could carry scripts).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { BRAND_CODE_HASH, MAX_PICTURE_PIXELS, cleanSvg, drawUploadedLogo, embeddedPixels, loadSharp, sniffImage } from "./brand.mjs";

/** The built-in logos: their pictures in the served /kiosk/brand/ (made by kiosk/brand.mjs) */
export const BUILTIN_LOGOS = [
  { id: "huawei", name: "HUAWEI", logo: "huawei-logo.png", banner: "banner-huawei.png" },
  { id: "mgw", name: "MILAN GAMES WEEK", logo: "mgw-logo.png", banner: "banner-mgw.png" },
  { id: "windtre", name: "WINDTRE", logo: "windtre-logo.png", banner: "banner-windtre.png" },
];
const BUILTIN_IDS = new Set(BUILTIN_LOGOS.map((l) => l.id));

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_UPLOADS = 24;
const UPLOAD_ID_RE = /^u-[a-z0-9]{8}$/;
const GROUND_MODES = ["auto", "light", "dark"];
const PICTURES = ["logo", "banner"];

const httpError = (status, message) => Object.assign(new Error(message), { status });
const TOO_BIG = `Immagine troppo grande: al massimo ${Math.round(MAX_PICTURE_PIXELS / 1e6)} megapixel`;
const tooBig = (err) => /pixel limit/i.test(String(err?.message));

/** A name as the screens show it: no control characters or angle brackets, 40 characters at most */
const cleanName = (v) =>
  (typeof v === "string" ? v : "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);

/**
 * The logo list of a kiosk server. `servedBrandDir` is the served build's /kiosk/brand/ (where the built-in pictures
 * are); `dataDir` holds the list and the uploads.
 */
export function createLogoRegistry({ dataDir, servedBrandDir, log = console }) {
  const dir = path.join(dataDir, "logos");
  const listFile = path.join(dataDir, "logos.json");
  const pictureFile = (id, kind) => path.join(dir, `${id}-${kind}.png`);
  const sourceFile = (item) => path.join(dir, `${item.id}-src.${item.srcExt}`);

  /** Any stored list made whole: every built-in present (a new one joins at the end, shown), uploads with their files */
  function sanitize(raw) {
    const items = [];
    const seen = new Set();
    for (const r of Array.isArray(raw?.items) ? raw.items : []) {
      if (!r || typeof r !== "object" || typeof r.id !== "string" || seen.has(r.id)) continue;
      const enabled = r.enabled !== false;
      if (BUILTIN_IDS.has(r.id)) {
        items.push({ id: r.id, enabled });
      } else if (UPLOAD_ID_RE.test(r.id) && typeof r.srcExt === "string" && /^(svg|png|jpeg|gif|webp)$/.test(r.srcExt)) {
        items.push({
          id: r.id,
          enabled,
          name: cleanName(r.name) || "Logo",
          groundMode: GROUND_MODES.includes(r.groundMode) ? r.groundMode : "auto",
          srcExt: r.srcExt,
          createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(0).toISOString(),
          // What drawing made its pictures (none yet: they are drawn at start)
          boxed: r.boxed === true,
          ground: r.ground === "dark" ? "dark" : "light",
          rev: typeof r.rev === "string" ? r.rev : "",
          codeHash: typeof r.codeHash === "string" ? r.codeHash : "",
        });
      } else continue;
      seen.add(r.id);
    }
    for (const b of BUILTIN_LOGOS) if (!seen.has(b.id)) items.push({ id: b.id, enabled: true });
    return { items, updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : null };
  }

  let state = (() => {
    try {
      return sanitize(JSON.parse(fs.readFileSync(listFile, "utf8")));
    } catch (err) {
      if (err.code !== "ENOENT") log.error(`[kiosk] logos.json unreadable, starting from the built-in logos: ${err.message}`);
      return sanitize(null);
    }
  })();

  async function save() {
    state.updatedAt = new Date().toISOString();
    await fsp.mkdir(dataDir, { recursive: true });
    const tmp = `${listFile}.tmp-${process.pid}`;
    await fsp.writeFile(tmp, JSON.stringify(state, null, 1));
    await fsp.rename(tmp, listFile);
  }

  // One change at a time: an upload is drawn while other requests come in
  let chain = Promise.resolve();
  const exclusive = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };

  async function sharpOrFail() {
    const { sharp, problem } = await loadSharp();
    if (!sharp) throw httpError(503, `Impossibile elaborare le immagini sul server (${problem})`);
    return sharp;
  }

  /** Draws an upload's two pictures from its file (its ground as the staff chose) and notes what the drawing found */
  async function draw(item, raw, sharp) {
    const out = await drawUploadedLogo(sharp, raw, { ground: item.groundMode });
    await fsp.mkdir(dir, { recursive: true });
    for (const kind of PICTURES) {
      const dest = pictureFile(item.id, kind);
      await fsp.writeFile(`${dest}.tmp-${process.pid}`, out[kind]);
      await fsp.rename(`${dest}.tmp-${process.pid}`, dest);
    }
    item.boxed = out.boxed;
    item.ground = out.ground;
    item.rev = crypto.createHash("sha256").update(out.logo).update(out.banner).digest("hex").slice(0, 10);
    item.codeHash = BRAND_CODE_HASH;
  }

  /** A built-in picture's address when it has been made, with its date so a new one isn't taken from a cache */
  function servedPicture(name) {
    try {
      const stat = fs.statSync(path.join(servedBrandDir, name));
      return stat.isFile() ? `/kiosk/brand/${name}?v=${Math.round(stat.mtimeMs).toString(36)}` : null;
    } catch {
      return null;
    }
  }

  /** The list as the game and the admin page read it */
  function publicList() {
    return {
      updatedAt: state.updatedAt,
      logos: state.items.map((item) => {
        const builtin = BUILTIN_LOGOS.find((b) => b.id === item.id);
        if (builtin) {
          return {
            id: item.id,
            name: builtin.name,
            builtin: true,
            enabled: item.enabled,
            // Drawn for the kiosk's dark screens
            ground: "dark",
            boxed: false,
            groundMode: "auto",
            logo: servedPicture(builtin.logo),
            banner: servedPicture(builtin.banner),
          };
        }
        const ready = item.rev !== "";
        return {
          id: item.id,
          name: item.name,
          builtin: false,
          enabled: item.enabled,
          ground: item.ground,
          boxed: item.boxed,
          groundMode: item.groundMode,
          logo: ready ? `/api/kiosk/logos/${item.id}/logo.png?v=${item.rev}` : null,
          banner: ready ? `/api/kiosk/logos/${item.id}/banner.png?v=${item.rev}` : null,
        };
      }),
    };
  }

  return {
    publicList,

    /** Where an upload's picture is (null: no such logo or picture) */
    picturePath(id, kind) {
      if (!UPLOAD_ID_RE.test(id) || !PICTURES.includes(kind)) return null;
      const item = state.items.find((i) => i.id === id);
      return item && item.rev ? pictureFile(id, kind) : null;
    },

    /**
     * Shown or hidden, an upload's ground, the order: `logos` lists what changes ({ id, enabled?, groundMode? }), the
     * others stay as they are; `order` lists ids in the order wanted (those left out follow, in their order)
     */
    update({ logos: changes = [], order: wanted = null } = {}) {
      return exclusive(async () => {
        if (!Array.isArray(changes) || (wanted !== null && !Array.isArray(wanted))) throw httpError(400, "Richiesta non valida");
        const byId = new Map(state.items.map((i) => [i.id, i]));
        const redraw = [];
        for (const c of changes) {
          const item = c && typeof c === "object" ? byId.get(c.id) : undefined;
          if (!item) continue;
          if (typeof c.enabled === "boolean") item.enabled = c.enabled;
          if (!BUILTIN_IDS.has(item.id) && GROUND_MODES.includes(c.groundMode) && c.groundMode !== item.groundMode && !redraw.some((r) => r.item === item)) {
            redraw.push({ item, previous: item.groundMode });
            item.groundMode = c.groundMode;
          }
        }
        if (wanted) {
          const order = [];
          for (const id of wanted) {
            const item = byId.get(id);
            if (item && !order.includes(item)) order.push(item);
          }
          state.items = [...order, ...state.items.filter((i) => !order.includes(i))];
        }
        if (redraw.length > 0) {
          const { sharp, problem } = await loadSharp();
          for (const { item, previous } of redraw) {
            try {
              if (!sharp) throw new Error(problem);
              await draw(item, await fsp.readFile(sourceFile(item)), sharp);
            } catch (err) {
              // Its board stays as it was, and so does its choice
              item.groundMode = previous;
              log.warn(`[kiosk] logo ${item.name} (${item.id}) not drawn again: ${err.message}`);
            }
          }
        }
        await save();
        return publicList();
      });
    },

    /** A new logo from an uploaded file; it shows at once, after the others */
    add(raw, name) {
      return exclusive(async () => {
        if (state.items.filter((i) => !BUILTIN_IDS.has(i.id)).length >= MAX_UPLOADS) {
          throw httpError(409, `Al massimo ${MAX_UPLOADS} loghi caricati: eliminane uno prima`);
        }
        const kind = sniffImage(raw);
        if (!kind) throw httpError(415, "Formato non supportato: carica un file SVG, PNG, JPG, WebP o GIF");
        const sharp = await sharpOrFail();
        const source = kind === "svg" ? Buffer.from(cleanSvg(raw.toString("utf8"))) : raw;
        try {
          // An SVG's artboard can be any size (it is drawn at the size wanted); a bitmap's pixels are what it costs
          const meta = await sharp(source, kind === "svg" ? { density: 72, limitInputPixels: false } : { limitInputPixels: MAX_PICTURE_PIXELS }).metadata();
          if (!meta.width || !meta.height) throw new Error("no size");
        } catch (err) {
          throw tooBig(err) ? httpError(413, TOO_BIG) : httpError(415, "Immagine non leggibile");
        }
        // Pictures inside an SVG are decoded at their own size, whatever the SVG is drawn at
        if (kind === "svg") {
          const inside = await embeddedPixels(sharp, source.toString("utf8"));
          if (inside === Infinity) throw httpError(422, "SVG non utilizzabile: contiene troppe immagini incorporate (esportalo di nuovo o usa un PNG)");
          if (inside > MAX_PICTURE_PIXELS) throw httpError(413, `L'SVG contiene immagini troppo grandi: al massimo ${Math.round(MAX_PICTURE_PIXELS / 1e6)} megapixel in tutto`);
        }
        let id = "";
        while (!id || state.items.some((i) => i.id === id)) id = `u-${crypto.randomBytes(4).toString("hex")}`;
        const item = {
          id,
          enabled: true,
          name: cleanName(name) || "Logo",
          groundMode: "auto",
          srcExt: kind,
          createdAt: new Date().toISOString(),
          boxed: false,
          ground: "light",
          rev: "",
          codeHash: "",
        };
        try {
          await draw(item, source, sharp);
        } catch (err) {
          for (const k of PICTURES) await fsp.rm(pictureFile(id, k), { force: true });
          if (err.status) throw err;
          if (tooBig(err)) throw httpError(413, TOO_BIG);
          throw httpError(422, `Immagine non utilizzabile (${String(err.message).split("\n")[0]})`);
        }
        await fsp.writeFile(sourceFile(item), source);
        state.items.push(item);
        await save();
        log.log(`[kiosk] logo added: ${item.name} (${id}, ${kind}, ${item.boxed ? "with its own background" : `${item.ground} ground`})`);
        return { logo: publicList().logos.find((l) => l.id === id), ...publicList() };
      });
    },

    /** Deletes an uploaded logo and its files (a built-in one can only be hidden) */
    remove(id) {
      return exclusive(async () => {
        if (BUILTIN_IDS.has(id)) throw httpError(400, "I loghi predefiniti non si eliminano: puoi nasconderli");
        const item = state.items.find((i) => i.id === id);
        if (!item) throw httpError(404, "Logo non trovato");
        state.items = state.items.filter((i) => i !== item);
        await save();
        for (const k of PICTURES) await fsp.rm(pictureFile(id, k), { force: true });
        await fsp.rm(sourceFile(item), { force: true });
        log.log(`[kiosk] logo deleted: ${item.name} (${id})`);
        return publicList();
      });
    },

    /**
     * At start: uploads whose pictures are missing, or were drawn by another version of the drawing, are drawn again
     * from their files; an upload whose file is gone leaves the list
     */
    ensurePictures() {
      return exclusive(async () => {
        const uploads = state.items.filter((i) => !BUILTIN_IDS.has(i.id));
        let changed = false;
        let sharp = null;
        for (const item of uploads) {
          if (!fs.existsSync(sourceFile(item))) {
            log.warn(`[kiosk] logo ${item.name} (${item.id}): its file is gone, removed from the list`);
            state.items = state.items.filter((i) => i !== item);
            changed = true;
            continue;
          }
          const current = item.rev && item.codeHash === BRAND_CODE_HASH && PICTURES.every((k) => fs.existsSync(pictureFile(item.id, k)));
          if (current) continue;
          try {
            sharp ??= await sharpOrFail();
            await draw(item, await fsp.readFile(sourceFile(item)), sharp);
            changed = true;
          } catch (err) {
            log.warn(`[kiosk] logo ${item.name} (${item.id}) not drawn again: ${err.message}`);
          }
        }
        if (changed) await save();
        return uploads.length;
      });
    },
  };
}
