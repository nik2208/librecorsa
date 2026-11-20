/**
 * Kiosk mode (event branch event/gaming-week-2026): the shapes shared by the game, the admin page and the kiosk
 * server (kiosk/server.mjs keeps a plain-JS copy of the same rules: keep the two in step).
 */

import type { AssistPreset } from "@/types/f1";
import { carListed, trackListed } from "@/lib/hosted-content";

/** How a player's session ends: after a number of laps, or after a number of minutes */
export type KioskLimitMode = "laps" | "time";

/** What happens to a lap that left the track limits */
export type KioskInvalidLapRule = "penalty" | "exclude";

/**
 * The circuits a kiosk can run: Monza (the event's circuit, committed on this branch) and RISE Motordrome's two
 * layouts. A build can leave Monza out (NEXT_PUBLIC_EXTRA_CONTENT, src/lib/hosted-content.ts)
 */
export const KIOSK_TRACKS = [
  { id: "monza", label: "Monza", extra: true },
  { id: "rwanda_official_short", label: "RISE corto", extra: false },
  { id: "rwanda_official", label: "RISE Grand Prix", extra: false },
] as const;
export type KioskTrackId = (typeof KIOSK_TRACKS)[number]["id"];

/** The 2026 Prototype (CC BY body by Qvist Designs), in the event livery: the car of a build without the extras */
export const KIOSK_CAR_ID = "vf26";
export const KIOSK_LIVERY_ID = "huawei_mgw";
/** The livery while the sponsor's logo is off: Applikat's, the stand's own (src/lib/kiosk/applikat-livery.ts) */
export const KIOSK_NEUTRAL_LIVERY_ID = "applikat";
/** RISE Motordrome's short layout: the circuit of a build without the extras */
export const KIOSK_FALLBACK_TRACK_ID = "rwanda_official_short";

/**
 * The car a kiosk runs: LibreCorsa's 2026 Prototype, in Applikat's livery (the sponsor's with its logo on). The Ferrari
 * SF-26 it ran before is gone: the event can't use it. A config that names it runs this one; a result saved with it
 * stays on its own board (carId "sf26"), which no screen shows
 */
export const KIOSK_CARS = [
  { id: "vf26", label: "Monoposto 2026", extra: false },
  // The one a kiosk build fetches from librecorsa.org (scripts/kiosk/fetch-kiosk-cars.mjs): listed only when it has it
  { id: "mtr-496r", label: "Prototipo V8", extra: true },
] as const;
export type KioskCarId = (typeof KIOSK_CARS)[number]["id"];

/** The circuits and cars this build can actually run */
export const listedKioskTracks = () => KIOSK_TRACKS.filter((t) => trackListed(t.id));
export const listedKioskCars = () => KIOSK_CARS.filter((c) => carListed(c.id));

/** The config's circuit and car when this build has them, else the ones every build has */
export const runnableTrackId = (id: KioskTrackId): KioskTrackId => (trackListed(id) ? id : KIOSK_FALLBACK_TRACK_ID);
export const runnableCarId = (id: KioskCarId): KioskCarId => (carListed(id) ? id : KIOSK_CAR_ID);

/** The levels a player picks before the start (the admin's choice is the one picked at first) */
export const KIOSK_DIFFICULTIES: readonly { id: AssistPreset; label: string; short: string; hint: string }[] = [
  { id: "assisted", label: "Facile", short: "F", hint: "Tutti gli aiuti: frenata, trazione, cambio automatico" },
  { id: "semi_pro", label: "Medio", short: "M", hint: "Aiuti ridotti, cambio automatico" },
  { id: "pro", label: "Difficile", short: "D", hint: "Nessun aiuto" },
];
export const difficultyLabel = (id: string | null | undefined): string | null => KIOSK_DIFFICULTIES.find((d) => d.id === id)?.label ?? null;

/** What the visitors drive with: set once by the staff (the kiosk ignores what the full game saved) */
export type KioskInputDevice = "controller" | "wheel" | "keyboard";
export const KIOSK_DEVICES: readonly { id: KioskInputDevice; label: string; hint: string }[] = [
  { id: "controller", label: "Controller USB", hint: "Gamepad standard (Xbox, PlayStation…): RT accelera, LT frena, levetta sinistra sterza" },
  { id: "wheel", label: "Volante", hint: "Volante e pedaliera: vanno abbinati una volta in «Configura volante»" },
  { id: "keyboard", label: "Tastiera", hint: "Frecce per guidare (per le prove)" },
];

/** Graphics quality on the kiosk: lower on a PC without a strong graphics card (high can stall the loading there) */
export type KioskGraphics = "low" | "medium" | "high";
export const KIOSK_GRAPHICS: readonly { id: KioskGraphics; label: string }[] = [
  { id: "low", label: "Bassa" },
  { id: "medium", label: "Media" },
  { id: "high", label: "Alta" },
];

/** The admin's settings for every session on the kiosk */
export interface KioskConfig {
  limitMode: KioskLimitMode;
  /** Laps per session in "laps" mode (1..20) */
  laps: number;
  /** Minutes per session in "time" mode (0.5..60) */
  minutes: number;
  /** "laps" mode: the session ends anyway after this many minutes (0 = no cap) */
  maxMinutes: number;
  trackId: KioskTrackId;
  carId: KioskCarId;
  /** The level picked at first on the start screen (each player can change it) */
  difficulty: AssistPreset;
  /**
   * Guida semplice: the energy store always full and Straight Mode (the flaps) opening by itself, so there is no energy
   * to manage and no button to learn. For every player at every level (the levels keep their aids and gearbox), so one
   * board per circuit and car stays fair. On by default, also for a config saved before it existed
   */
  simpleDrive: boolean;
  /** What the visitors drive with */
  device: KioskInputDevice;
  graphics: KioskGraphics;
  /** Laps outside the track limits: timed with a penalty, or not counted for the ranking */
  invalidLaps: KioskInvalidLapRule;
  /** Seconds added to a lap that left the track limits ("penalty") */
  penaltyS: number;
  /** The braking line on the road (helps first-time players) */
  racingLine: boolean;
  /** "3, 2, 1, VIA!" before the car is released (0 = none) */
  countdownS: number;
  /** How long the results stay on screen before the next player (s) */
  resultsHoldS: number;
  /** The line under the game's name on the menu, the leaderboard and the circuit's screens (empty: none) */
  motto: string;
  /** ISO time of the last save (server-set) */
  updatedAt?: string;
}

export const DEFAULT_KIOSK_CONFIG: KioskConfig = {
  limitMode: "time",
  laps: 3,
  minutes: 5,
  maxMinutes: 10,
  trackId: "monza",
  carId: "vf26",
  difficulty: "assisted",
  simpleDrive: true,
  device: "controller",
  graphics: "medium",
  invalidLaps: "penalty",
  penaltyS: 5,
  racingLine: true,
  countdownS: 3,
  resultsHoldS: 30,
  motto: "Sfida il cronometro! Sei tu il più veloce?",
};

/** The motto's longest length */
export const KIOSK_MOTTO_MAX = 80;
/** One line of text for the screens: no control characters or angle brackets, spaces collapsed, KIOSK_MOTTO_MAX at most */
export const cleanMotto = (v: unknown): string =>
  (typeof v === "string" ? v : "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, KIOSK_MOTTO_MAX);

const num = (v: unknown, min: number, max: number, fallback: number, step = 1): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const snapped = Math.round(n / step) * step;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(3))));
};

/** Any stored or posted config, made whole and in range (unknown fields dropped) */
export function sanitizeKioskConfig(raw: unknown): KioskConfig {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_KIOSK_CONFIG;
  const trackId = KIOSK_TRACKS.some((t) => t.id === r.trackId) ? (r.trackId as KioskTrackId) : d.trackId;
  // The same car is "lc26" on the kiosk built from upstream's newer game: a config it saved keeps it here
  const carId = r.carId === "lc26" ? "vf26" : KIOSK_CARS.some((c) => c.id === r.carId) ? (r.carId as KioskCarId) : d.carId;
  const difficulty = KIOSK_DIFFICULTIES.some((x) => x.id === r.difficulty) ? (r.difficulty as AssistPreset) : d.difficulty;
  const device = KIOSK_DEVICES.some((x) => x.id === r.device) ? (r.device as KioskInputDevice) : d.device;
  const graphics = KIOSK_GRAPHICS.some((x) => x.id === r.graphics) ? (r.graphics as KioskGraphics) : d.graphics;
  return {
    limitMode: r.limitMode === "laps" || r.limitMode === "time" ? r.limitMode : d.limitMode,
    laps: num(r.laps, 1, 20, d.laps),
    minutes: num(r.minutes, 0.5, 60, d.minutes, 0.5),
    maxMinutes: num(r.maxMinutes, 0, 120, d.maxMinutes, 0.5),
    trackId,
    carId,
    difficulty,
    simpleDrive: typeof r.simpleDrive === "boolean" ? r.simpleDrive : d.simpleDrive,
    device,
    graphics,
    invalidLaps: r.invalidLaps === "exclude" || r.invalidLaps === "penalty" ? r.invalidLaps : d.invalidLaps,
    penaltyS: num(r.penaltyS, 0, 60, d.penaltyS, 0.5),
    racingLine: typeof r.racingLine === "boolean" ? r.racingLine : d.racingLine,
    countdownS: num(r.countdownS, 0, 10, d.countdownS),
    resultsHoldS: num(r.resultsHoldS, 5, 300, d.resultsHoldS),
    motto: typeof r.motto === "string" ? cleanMotto(r.motto) : d.motto,
    ...(typeof r.updatedAt === "string" ? { updatedAt: r.updatedAt } : {}),
  };
}

/** One completed lap of a session */
export interface KioskLap {
  lapMs: number;
  valid: boolean;
}

/** A finished session, as the game posts it */
export interface KioskResultInput {
  /** Made by the game: the same result posted twice (a retry) is stored once */
  clientId: string;
  name: string;
  trackId: string;
  carId: string;
  /** The level the player picked */
  difficulty?: AssistPreset;
  limitMode: KioskLimitMode;
  /** The limit the session ran to (the config at its start) */
  limitLaps: number;
  limitMinutes: number;
  invalidLaps: KioskInvalidLapRule;
  penaltyS: number;
  laps: KioskLap[];
  /** "laps" mode: all the laps were driven; "time" mode: the time ran out (not stopped by the staff) */
  finished: boolean;
  /** Time on track, pauses left out (ms) */
  drivenMs: number;
}

/** A stored result: the input plus what the server worked out from it */
export interface KioskResult extends KioskResultInput {
  id: string;
  createdAt: string;
  /** Best lap for the ranking (penalty included), null without one that counts */
  bestLapMs: number | null;
  /** The best lap was outside the track limits (its time carries the penalty) */
  bestLapPenalised: boolean;
  /** "laps" mode, all laps driven: their sum plus the penalties; else null */
  totalTimeMs: number | null;
  validLaps: number;
}

/** Ranking: best lap (any session on the circuit) or total time of a "laps" session of that length */
export type KioskRankingMode = "best" | "total";

export interface KioskLeaderboardRow {
  rank: number;
  id: string;
  name: string;
  /** The level the player picked (null for results from before the choice existed) */
  difficulty: AssistPreset | null;
  bestLapMs: number | null;
  bestLapPenalised: boolean;
  totalTimeMs: number | null;
  lapsCompleted: number;
  validLaps: number;
  createdAt: string;
}

export interface KioskLeaderboard {
  mode: KioskRankingMode;
  trackId: string;
  carId: string;
  /** "total" ranking: the session length it compares */
  laps: number | null;
  rows: KioskLeaderboardRow[];
  /** Ranked drivers in all (rows holds the first `limit`) */
  total: number;
  generatedAt: string;
}

/** What the server answers a posted result with */
export interface KioskSubmitResponse {
  ok: boolean;
  result?: KioskResult;
  /** Place of this result on its ranking (null when it doesn't rank: no lap that counts) */
  rank: number | null;
  leaderboard?: KioskLeaderboard;
  error?: string;
}

/** The ranking a config shows: total time for "laps" sessions, best lap for "time" sessions */
export const rankingModeFor = (c: Pick<KioskConfig, "limitMode">): KioskRankingMode => (c.limitMode === "laps" ? "total" : "best");
