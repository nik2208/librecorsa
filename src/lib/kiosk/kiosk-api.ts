/**
 * The kiosk's side of kiosk/server.mjs: the admin's config, the results and the leaderboard.
 *
 * NEXT_PUBLIC_KIOSK_API is the server's address when the game is not served by it (`next dev`:
 * http://localhost:8787); empty, the game asks the site it came from. The kiosk keeps working when the server can't be
 * reached: the last config it read is kept in this browser, and results wait in a queue that is sent later.
 */

import {
  DEFAULT_KIOSK_CONFIG,
  sanitizeKioskConfig,
  type KioskConfig,
  type KioskLeaderboard,
  type KioskRankingMode,
  type KioskResult,
  type KioskResultInput,
  type KioskSubmitResponse,
} from "@/lib/kiosk/kiosk-types";

const API_BASE = (process.env.NEXT_PUBLIC_KIOSK_API || "").trim().replace(/\/+$/, "");
const TIMEOUT_MS = 6000;
// v2: the kiosk opens on the Ferrari SF-26 at Monza (a v1 copy would bring back the earlier circuit and car)
const CONFIG_CACHE_KEY = "kiosk.config.v2";
const QUEUE_KEY = "kiosk.queue.v1";
const PIN_KEY = "kiosk.pin";

export const kioskApiUrl = (path: string): string => `${API_BASE}/api/kiosk${path}`;

/** Storage that may be missing or throw (private windows, blocked site data) */
function store(kind: "local" | "session"): Storage | null {
  try {
    return typeof window === "undefined" ? null : kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function readJson<T>(kind: "local" | "session", key: string): T | null {
  try {
    const raw = store(kind)?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(kind: "local" | "session", key: string, value: unknown): void {
  try {
    store(kind)?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: nothing to keep
  }
}

export class KioskApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { pin?: string | null } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (init.pin) headers.set("X-Kiosk-Pin", init.pin);
  try {
    const res = await fetch(kioskApiUrl(path), { ...init, headers, signal: controller.signal, cache: "no-store" });
    const text = await res.text();
    const body = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const error = typeof body === "object" && body !== null && "error" in body ? String((body as { error: unknown }).error) : res.statusText;
      throw new KioskApiError(error || `HTTP ${res.status}`, res.status);
    }
    return body as T;
  } catch (err) {
    if (err instanceof KioskApiError) throw err;
    throw new KioskApiError("Server del kiosk non raggiungibile", 0);
  } finally {
    window.clearTimeout(timer);
  }
}

// ---- Config

export type ConfigSource = "server" | "cache" | "default";

/** The admin's config: the server's, else the last one read here, else the defaults */
export async function loadKioskConfig(): Promise<{ config: KioskConfig; source: ConfigSource }> {
  try {
    const config = sanitizeKioskConfig(await request<unknown>("/config"));
    writeJson("local", CONFIG_CACHE_KEY, config);
    return { config, source: "server" };
  } catch {
    const cached = readJson<unknown>("local", CONFIG_CACHE_KEY);
    if (cached) return { config: sanitizeKioskConfig(cached), source: "cache" };
    return { config: { ...DEFAULT_KIOSK_CONFIG }, source: "default" };
  }
}

export async function saveKioskConfig(config: KioskConfig, pin: string): Promise<KioskConfig> {
  const saved = sanitizeKioskConfig(await request<unknown>("/config", { method: "PUT", body: JSON.stringify(config), pin }));
  writeJson("local", CONFIG_CACHE_KEY, saved);
  return saved;
}

// ---- Admin PIN (kept for this browser tab only)

export const storedPin = (): string | null => {
  try {
    return store("session")?.getItem(PIN_KEY) ?? null;
  } catch {
    return null;
  }
};
export const rememberPin = (pin: string | null): void => {
  try {
    const s = store("session");
    if (!s) return;
    if (pin) s.setItem(PIN_KEY, pin);
    else s.removeItem(PIN_KEY);
  } catch {
    // Nothing to remember it in
  }
};

/** Whether the server takes this PIN for the admin's actions */
export async function checkPin(pin: string): Promise<boolean> {
  try {
    await request<{ ok: boolean }>("/auth", { method: "POST", body: "{}", pin });
    return true;
  } catch (err) {
    if (err instanceof KioskApiError && err.status === 401) return false;
    throw err;
  }
}

// ---- Results

/** Results that could not be sent yet, oldest first */
const queued = (): KioskResultInput[] => readJson<KioskResultInput[]>("local", QUEUE_KEY) ?? [];

export const queuedResultCount = (): number => queued().length;

/** Posts a finished session; when the server can't be reached it waits in this browser for `flushResultQueue` */
export async function submitKioskResult(input: KioskResultInput): Promise<KioskSubmitResponse & { queued?: boolean }> {
  try {
    const res = await request<KioskSubmitResponse>("/results", { method: "POST", body: JSON.stringify(input) });
    void flushResultQueue();
    return res;
  } catch (err) {
    // The server said no (a bad name, a malformed result): sending it again would not help
    if (err instanceof KioskApiError && err.status >= 400 && err.status < 500) {
      return { ok: false, rank: null, error: err.message };
    }
    const queue = queued().filter((q) => q.clientId !== input.clientId);
    queue.push(input);
    writeJson("local", QUEUE_KEY, queue.slice(-500));
    return { ok: false, rank: null, queued: true, error: "Server non raggiungibile: risultato salvato, verrà inviato appena possibile" };
  }
}

let flushing: Promise<number> | null = null;
/** Sends the results waiting in this browser; how many are still waiting afterwards */
export function flushResultQueue(): Promise<number> {
  flushing ??= (async () => {
    try {
      let queue = queued();
      while (queue.length > 0) {
        try {
          await request<KioskSubmitResponse>("/results", { method: "POST", body: JSON.stringify(queue[0]) });
        } catch (err) {
          // Unreachable: try again later. Refused: drop it (it would be refused every time)
          if (!(err instanceof KioskApiError && err.status >= 400 && err.status < 500)) break;
        }
        queue = queue.slice(1);
        writeJson("local", QUEUE_KEY, queue);
      }
      return queue.length;
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

// ---- Leaderboard

export interface LeaderboardQuery {
  mode?: KioskRankingMode;
  trackId?: string;
  carId?: string;
  laps?: number;
  limit?: number;
}

export function leaderboardPath(q: LeaderboardQuery = {}): string {
  const p = new URLSearchParams();
  if (q.mode) p.set("mode", q.mode);
  if (q.trackId) p.set("track", q.trackId);
  if (q.carId) p.set("car", q.carId);
  if (q.laps) p.set("laps", String(q.laps));
  if (q.limit) p.set("limit", String(q.limit));
  const s = p.toString();
  return `/leaderboard${s ? `?${s}` : ""}`;
}

export const fetchLeaderboard = (q: LeaderboardQuery = {}): Promise<KioskLeaderboard> => request<KioskLeaderboard>(leaderboardPath(q));

// ---- Network

/** One address the kiosk server is reached at (`iface` names the network card, or the setting it came from) */
export interface KioskServerUrl {
  url: string;
  iface: string;
  /** A virtual bridge (Docker, VPN…): usually not the address other screens can reach */
  virtual: boolean;
}

export interface KioskNetworkInfo {
  port: number;
  urls: KioskServerUrl[];
  paths: { leaderboardPage: string; leaderboardApi: string };
}

/** The server's addresses on the local network, for the leaderboard's link on the admin page */
export const fetchNetworkInfo = (): Promise<KioskNetworkInfo> => request<KioskNetworkInfo>("/network");

// ---- Admin: results

export const listResults = (pin: string): Promise<{ results: KioskResult[] }> => request("/results", { pin });

export const deleteResult = (id: string, pin: string): Promise<{ ok: boolean }> =>
  request(`/results/${encodeURIComponent(id)}`, { method: "DELETE", pin });

/** Clears the leaderboard (the server keeps a backup copy of what it held) */
export const resetResults = (pin: string): Promise<{ ok: boolean; backup?: string }> => request("/results", { method: "DELETE", pin });

/** Every result as CSV, saved through a link (an admin browser; the kiosk's own may refuse downloads) */
export async function downloadResultsCsv(pin: string): Promise<void> {
  const res = await fetch(kioskApiUrl("/results.csv"), { headers: { "X-Kiosk-Pin": pin }, cache: "no-store" });
  if (!res.ok) throw new KioskApiError(res.status === 401 ? "PIN non valido" : `HTTP ${res.status}`, res.status);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `classifica-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** A unique id for a result (also on browsers without crypto.randomUUID, e.g. plain-HTTP LAN addresses) */
export function newClientId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // Not a secure context: fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}
