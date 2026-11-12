/**
 * Kiosk mode (event branch event/gaming-week-2026): the shapes shared by the game, the admin page and the kiosk
 * server (kiosk/server.mjs keeps a plain-JS copy of the same rules: keep the two in step).
 */

import type { AssistPreset } from "@/types/f1";

/** How a player's session ends: after a number of laps, or after a number of minutes */
export type KioskLimitMode = "laps" | "time";

/** What happens to a lap that left the track limits */
export type KioskInvalidLapRule = "penalty" | "exclude";

/** The circuits a kiosk can run: the ones the repository carries (src/lib/hosted-content.ts) */
export const KIOSK_TRACKS = [
  { id: "rwanda_official_short", label: "Circuito corto" },
  { id: "rwanda_official", label: "Circuito Grand Prix" },
] as const;
export type KioskTrackId = (typeof KIOSK_TRACKS)[number]["id"];

/** The car every player drives: the 2026 Prototype (CC BY body by Qvist Designs), in the event livery */
export const KIOSK_CAR_ID = "vf26";
export const KIOSK_LIVERY_ID = "huawei_mgw";

export const KIOSK_DIFFICULTIES: readonly { id: AssistPreset; label: string; hint: string }[] = [
  { id: "assisted", label: "Facile", hint: "Tutti gli aiuti attivi" },
  { id: "semi_pro", label: "Media", hint: "Aiuti ridotti" },
  { id: "pro", label: "Difficile", hint: "Nessun aiuto" },
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
  difficulty: AssistPreset;
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
  /** ISO time of the last save (server-set) */
  updatedAt?: string;
}

export const DEFAULT_KIOSK_CONFIG: KioskConfig = {
  limitMode: "time",
  laps: 3,
  minutes: 5,
  maxMinutes: 10,
  trackId: "rwanda_official_short",
  difficulty: "assisted",
  invalidLaps: "penalty",
  penaltyS: 5,
  racingLine: true,
  countdownS: 3,
  resultsHoldS: 30,
};

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
  const difficulty = KIOSK_DIFFICULTIES.some((x) => x.id === r.difficulty) ? (r.difficulty as AssistPreset) : d.difficulty;
  return {
    limitMode: r.limitMode === "laps" || r.limitMode === "time" ? r.limitMode : d.limitMode,
    laps: num(r.laps, 1, 20, d.laps),
    minutes: num(r.minutes, 0.5, 60, d.minutes, 0.5),
    maxMinutes: num(r.maxMinutes, 0, 120, d.maxMinutes, 0.5),
    trackId,
    difficulty,
    invalidLaps: r.invalidLaps === "exclude" || r.invalidLaps === "penalty" ? r.invalidLaps : d.invalidLaps,
    penaltyS: num(r.penaltyS, 0, 60, d.penaltyS, 0.5),
    racingLine: typeof r.racingLine === "boolean" ? r.racingLine : d.racingLine,
    countdownS: num(r.countdownS, 0, 10, d.countdownS),
    resultsHoldS: num(r.resultsHoldS, 5, 300, d.resultsHoldS),
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
