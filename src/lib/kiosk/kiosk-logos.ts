/**
 * The logos the kiosk shows (kiosk/logos.mjs): the built-in three (HUAWEI, Milan Games Week, WINDTRE) and the staff's
 * uploads, each shown or hidden from the admin page, in the staff's order. The kiosk's screens (the header) and the
 * circuit (its trackside boards) show the ones turned on.
 *
 * The list is read again every few seconds while anything shows it, so a change reaches the boards in the middle of a
 * race. Until the server has answered nothing is shown (a logo the staff turned off must never flash up); without a
 * kiosk server (a static host) it is the list read last in this browser, else the built-in three.
 */

import { withBasePath } from "@/lib/base-path";
import { BRAND_FILES, EVENT_BRAND } from "@/lib/kiosk/event-brand";
import { KioskApiError, kioskApiUrl, kioskRequest } from "@/lib/kiosk/kiosk-api";

/** The ground a logo shows on: "light" (dark colours: a white card behind it on the dark screens) or "dark" */
export type LogoGround = "light" | "dark";
/** An upload's board: its ground worked out from its colours, or the staff's choice */
export type LogoGroundMode = "auto" | LogoGround;

export interface KioskLogo {
  id: string;
  name: string;
  /** HUAWEI, Milan Games Week, WINDTRE: hidden, never deleted */
  builtin: boolean;
  enabled: boolean;
  ground: LogoGround;
  /** A picture with a background of its own (no transparency): shown as it is */
  boxed: boolean;
  groundMode: LogoGroundMode;
  /** The server's paths of its picture for the screens and its 1024 × 128 trackside board; null: its name is drawn */
  logo: string | null;
  banner: string | null;
}

const builtin = (id: string, name: string, logo: string, banner: string): KioskLogo => ({
  id,
  name,
  builtin: true,
  enabled: true,
  ground: "dark",
  boxed: false,
  groundMode: "auto",
  logo,
  banner,
});

/** What a kiosk without a server shows: the three built-in logos, from the build's /kiosk/brand/ when they are there */
const BUILTIN_DEFAULTS: readonly KioskLogo[] = [
  builtin("huawei", "HUAWEI", BRAND_FILES.sponsorLogo, BRAND_FILES.bannerSponsor),
  builtin("mgw", "MILAN GAMES WEEK", BRAND_FILES.eventLogo, BRAND_FILES.bannerEvent),
  builtin("windtre", "WINDTRE", BRAND_FILES.windtreLogo, BRAND_FILES.bannerWindtre),
];

/** A picture's address for the browser: an upload's through the kiosk server, a built-in's under the site's base path */
export const logoAssetUrl = (path: string): string =>
  path.startsWith("/api/kiosk/") ? kioskApiUrl(path.slice("/api/kiosk".length)) : withBasePath(path);

/** The logos turned on, in the staff's order */
export const shownLogos = (list: readonly KioskLogo[] | null): KioskLogo[] => (list ?? []).filter((l) => l.enabled);

/**
 * The game's name as the screens show it: the sponsor's in it while its logo is shown, a plain one when the staff hid
 * it (and until the list is known, so a hidden sponsor never flashes up)
 */
export const challengeName = (list: readonly KioskLogo[] | null): string =>
  shownLogos(list).some((l) => l.id === "huawei") ? EVENT_BRAND.challenge : EVENT_BRAND.challengeNeutral;

/** The server's answer, made safe to draw from (null when it isn't a list) */
function sanitizeList(raw: unknown): KioskLogo[] | null {
  const list = typeof raw === "object" && raw !== null ? (raw as { logos?: unknown }).logos : null;
  if (!Array.isArray(list)) return null;
  const path = (v: unknown): string | null => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : null);
  const out: KioskLogo[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(o.id) || out.some((l) => l.id === o.id)) continue;
    out.push({
      id: o.id,
      name: typeof o.name === "string" && o.name.trim() ? o.name.slice(0, 40) : o.id,
      builtin: o.builtin === true,
      enabled: o.enabled !== false,
      ground: o.ground === "light" ? "light" : "dark",
      boxed: o.boxed === true,
      groundMode: o.groundMode === "light" || o.groundMode === "dark" ? o.groundMode : "auto",
      logo: path(o.logo),
      banner: path(o.banner),
    });
  }
  return out;
}

// ---- The list, read from the server while something shows it

/** How often the list is read again (a change shows within this, mid-race too) */
const POLL_MS = 5000;
/** Without a kiosk server (a static host) it is asked for less often */
const RETRY_MS = 30_000;
/** A first answer that is slow to come is asked for again this often, this many times, before the built-in logos stand in */
const FIRST_RETRY_MS = 1500;
const FIRST_TRIES = 4;
const CACHE_KEY = "kiosk.logos.v1";

let snapshot: KioskLogo[] | null = null;
let snapshotKey = "";
/** The list shown came from the kiosk server (not the cache or the built-in defaults) */
let fromServer = false;
/** Reads in a row that got no list */
let misses = 0;
/** Everyone told of a change; `reads`: those that keep the list being read (the others only follow it) */
const subscribers = new Set<{ listener: () => void; reads: boolean }>();
let timer: number | null = null;
let polling = false;

function publish(next: KioskLogo[], remember: boolean): void {
  const key = JSON.stringify(next);
  if (key === snapshotKey) return;
  snapshot = next;
  snapshotKey = key;
  if (remember) {
    try {
      window.localStorage.setItem(CACHE_KEY, key);
    } catch {
      // No storage: the next start without a server shows the built-in logos
    }
  }
  for (const s of [...subscribers]) s.listener();
}

function rememberedList(): KioskLogo[] | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? sanitizeList({ logos: JSON.parse(raw) }) : null;
  } catch {
    return null;
  }
}

/** Reads the list once; how long to wait before the next read */
async function poll(): Promise<number> {
  if (polling) return POLL_MS;
  polling = true;
  try {
    const list = sanitizeList(await kioskRequest<unknown>("/logos", { timeoutMs: 4000 }));
    if (!list) throw new Error("not a list of logos");
    fromServer = true;
    misses = 0;
    publish(list, true);
    return POLL_MS;
  } catch (err) {
    misses++;
    // A list from the server stays through a missed read (a busy moment), and is read again soon
    if (fromServer) return POLL_MS;
    // Nothing shown yet: a slow server is given a few quick tries (the built-in logos would show ones the staff hid),
    // unless the site plainly has no list to give (a static host's page, a kiosk server from before the logos)
    const noServer = err instanceof KioskApiError && (err.httpStatus !== null || err.status === 404);
    if (snapshot === null && !noServer && misses < FIRST_TRIES) return FIRST_RETRY_MS;
    // No kiosk server: the last list this browser read, else the built-in three (a list already shown stays)
    if (snapshot === null) publish(rememberedList() ?? BUILTIN_DEFAULTS.map((l) => ({ ...l })), false);
    return RETRY_MS;
  } finally {
    polling = false;
  }
}

const readers = () => [...subscribers].filter((s) => s.reads).length;

/** Reads the list now, then again every few seconds while anyone keeps it read */
async function tick(): Promise<void> {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  const wait = await poll();
  if (readers() > 0 && timer === null) timer = window.setTimeout(() => void tick(), wait);
}

/**
 * Calls `listener` whenever the list changes; the list is read from the server while anyone listens. A `passive`
 * listener only follows it (a mark in the full game's HUD: the kiosk's own screens keep it read)
 */
export function subscribeLogos(listener: () => void, { passive = false }: { passive?: boolean } = {}): () => void {
  const sub = { listener, reads: !passive };
  subscribers.add(sub);
  if (sub.reads && readers() === 1 && typeof window !== "undefined") void tick();
  return () => {
    subscribers.delete(sub);
    if (readers() === 0 && timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
}

/** For a mark that follows the logos without asking for them (see subscribeLogos) */
export const followLogos = (listener: () => void): (() => void) => subscribeLogos(listener, { passive: true });

/** The list as last read (null until the server, or the lack of one, has said) */
export const getLogosSnapshot = (): KioskLogo[] | null => snapshot;

// ---- The admin page's changes (PIN): each answers with the new list, shown at once

function adopt(raw: unknown): KioskLogo[] {
  const list = sanitizeList(raw);
  if (!list) throw new Error("Risposta del server non valida");
  publish(list, true);
  return list;
}

/** Shown or hidden, an upload's ground (`logos`: what changes), the order (`order`: the ids in the order wanted) */
export async function updateLogos(
  pin: string,
  change: { logos?: { id: string; enabled?: boolean; groundMode?: LogoGroundMode }[]; order?: string[] }
): Promise<KioskLogo[]> {
  // A new ground is drawn by the server before it answers (as an upload is); the rest may wait behind another's upload
  const redraws = change.logos?.some((l) => l.groundMode !== undefined) ?? false;
  return adopt(await kioskRequest<unknown>("/logos", { method: "PUT", body: JSON.stringify(change), pin, timeoutMs: redraws ? 120_000 : 30_000 }));
}

/** Uploads a logo (SVG, PNG, JPG, WebP or GIF, up to 10 MB); it shows at once, after the others */
export async function uploadLogo(pin: string, file: Blob, name: string): Promise<{ list: KioskLogo[]; added: KioskLogo | null }> {
  const body = await kioskRequest<{ logo?: { id?: string } }>(`/logos?name=${encodeURIComponent(name)}`, {
    method: "POST",
    body: file,
    pin,
    headers: { "Content-Type": file.type || "application/octet-stream" },
    // A big picture takes the server a while to draw on a small PC
    timeoutMs: 120_000,
  });
  const list = adopt(body);
  return { list, added: list.find((l) => l.id === body?.logo?.id) ?? null };
}

/** Deletes an uploaded logo (a built-in one can only be hidden); it may wait behind another's upload */
export async function deleteLogo(pin: string, id: string): Promise<KioskLogo[]> {
  return adopt(await kioskRequest<unknown>(`/logos/${encodeURIComponent(id)}`, { method: "DELETE", pin, timeoutMs: 30_000 }));
}

/** Tests only (scripts/verify-kiosk.ts): back to a page just opened, with nothing read and nobody following */
export function resetLogoStoreForTests(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  subscribers.clear();
  snapshot = null;
  snapshotKey = "";
  fromServer = false;
  misses = 0;
  polling = false;
}
