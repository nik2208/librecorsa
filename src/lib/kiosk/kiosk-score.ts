/**
 * Kiosk scoring: what a session's laps are worth on the leaderboard. kiosk/server.mjs applies the same rules to what
 * it stores (keep the two in step); the game uses these to show the result before the server answers.
 */

import type { KioskInvalidLapRule, KioskLap, KioskLimitMode } from "@/lib/kiosk/kiosk-types";

export interface KioskScore {
  /** Best lap for the ranking, penalty included; null without one that counts */
  bestLapMs: number | null;
  bestLapPenalised: boolean;
  /** "laps" sessions with every lap driven: their sum plus the penalties (null with "exclude" and an invalid lap) */
  totalTimeMs: number | null;
  validLaps: number;
}

export interface KioskScoreRules {
  limitMode: KioskLimitMode;
  limitLaps: number;
  invalidLaps: KioskInvalidLapRule;
  penaltyS: number;
}

/** A lap's time for the ranking: as driven when valid, with the penalty (or not at all) when it left the track */
export function lapScoreMs(lap: KioskLap, rules: Pick<KioskScoreRules, "invalidLaps" | "penaltyS">): number | null {
  if (lap.valid) return lap.lapMs;
  return rules.invalidLaps === "penalty" ? lap.lapMs + Math.round(rules.penaltyS * 1000) : null;
}

export function scoreSession(laps: readonly KioskLap[], rules: KioskScoreRules): KioskScore {
  let bestLapMs: number | null = null;
  let bestLapPenalised = false;
  for (const lap of laps) {
    const score = lapScoreMs(lap, rules);
    if (score === null) continue;
    if (bestLapMs === null || score < bestLapMs) {
      bestLapMs = score;
      bestLapPenalised = !lap.valid;
    }
  }
  let totalTimeMs: number | null = null;
  if (rules.limitMode === "laps" && laps.length >= rules.limitLaps) {
    let sum = 0;
    for (const lap of laps.slice(0, rules.limitLaps)) {
      const score = lapScoreMs(lap, rules);
      if (score === null) {
        sum = NaN;
        break;
      }
      sum += score;
    }
    totalTimeMs = Number.isFinite(sum) ? sum : null;
  }
  return { bestLapMs, bestLapPenalised, totalTimeMs, validLaps: laps.filter((l) => l.valid).length };
}

/** 1:52.341 (or 52.341 under a minute) */
export function formatLapTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "--:--.---";
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  const s = `${String(seconds).padStart(minutes > 0 ? 2 : 1, "0")}.${String(millis).padStart(3, "0")}`;
  return minutes > 0 ? `${minutes}:${s}` : s;
}

/** A countdown or elapsed clock: 4:59 (rounded up for a countdown, so 0:00 is shown only at the end) */
export function formatClock(ms: number, roundUp = false): string {
  const totalS = Math.max(0, roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
