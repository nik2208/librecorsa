"use client";

/**
 * The kiosk's screens over the game: name entry and the leaderboard while the car waits on the grid, the countdown,
 * the session clock (laps or minutes, as the admin set), the pause screen, and the result once the limit is reached.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { nameProblem } from "@/lib/net/name-filter";
import { sanitizeDriverName } from "@/lib/settings/player-settings";
import type { KioskSimApi } from "@/lib/kiosk/kiosk-bridge";
import type { LapSummaryData } from "@/lib/sim/lap-types";
import { fetchLeaderboard, newClientId, submitKioskResult, type ConfigSource } from "@/lib/kiosk/kiosk-api";
import { formatClock, formatLapTime, formatMinutes, lapScoreMs, scoreSession, type KioskScore } from "@/lib/kiosk/kiosk-score";
import { rankingModeFor, type KioskConfig, type KioskLap, type KioskLeaderboard, type KioskResultInput } from "@/lib/kiosk/kiosk-types";
import { EVENT_BRAND } from "@/lib/kiosk/event-brand";
import { BrandHeader, KioskButton, KioskCredits, LeaderboardTable, OnScreenKeyboard, PinDialog, useGamepadPress, useStaffGesture } from "@/components/kiosk/kiosk-ui";

type Stage = "boot" | "entry" | "countdown" | "running" | "finished";
type EndReason = "time" | "laps" | "cap" | "staff";

interface Run {
  name: string;
  clientId: string;
  /** The config the session started with (a change made meanwhile counts from the next player) */
  config: KioskConfig;
  laps: KioskLap[];
  /** Time on track, pauses left out (ms) */
  drivenMs: number;
  lastTick: number | null;
}

interface Outcome {
  reason: EndReason;
  input: KioskResultInput;
  score: KioskScore;
  status: "sending" | "saved" | "queued" | "error";
  rank: number | null;
  board: KioskLeaderboard | null;
  resultId: string | null;
  error: string | null;
}

const LEADERBOARD_REFRESH_MS = 20_000;
/** On the name screen the admin's config is read again this often, so a change reaches an idle kiosk */
const CONFIG_REFRESH_MS = 60_000;
/** Pad presses on the result screen count only after this long (a button held over the line must not skip it) */
const RESULT_INPUT_DELAY_MS = 3000;

const END_TITLES: Record<EndReason, string> = {
  time: "Tempo scaduto!",
  laps: "Traguardo!",
  cap: "Tempo massimo raggiunto",
  staff: "Sessione terminata",
};

const rulesText = (c: KioskConfig): { headline: string; detail: string } =>
  c.limitMode === "time"
    ? {
        headline: `${formatMinutes(c.minutes)} per il giro più veloce`,
        detail: "Vince il miglior tempo sul giro. Il passaggio dalla griglia al traguardo non conta: il cronometro parte sulla linea.",
      }
    : {
        headline: `${c.laps} ${c.laps === 1 ? "giro" : "giri"}: vince il tempo totale`,
        detail: `Somma dei tempi sul giro${c.maxMinutes > 0 ? `, entro ${formatMinutes(c.maxMinutes)} al massimo` : ""}. Il cronometro parte sulla linea del traguardo.`,
      };


export interface KioskOverlayProps {
  api: KioskSimApi;
  config: KioskConfig;
  configSource: ConfigSource;
  /** Reads the admin's config again (between players, and now and then while idle) */
  onRefreshConfig: () => void;
  /** The staff gave the PIN: leave the game for the admin page */
  onStaffExit: () => void;
}

export const KioskOverlay: React.FC<KioskOverlayProps> = ({ api, config, configSource, onRefreshConfig, onStaffExit }) => {
  const [stage, setStageState] = useState<Stage>("boot");
  const stageRef = useRef<Stage>("boot");
  const setStage = useCallback((next: Stage) => {
    stageRef.current = next;
    setStageState(next);
  }, []);
  const apiRef = useRef(api);
  apiRef.current = api;
  const runRef = useRef<Run | null>(null);
  const [, setTick] = useState(0);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [lapToast, setLapToast] = useState<{ n: number; lap: KioskLap; best: boolean } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [resultShownAt, setResultShownAt] = useState(0);
  const [holdLeft, setHoldLeft] = useState(0);
  const [board, setBoard] = useState<KioskLeaderboard | null>(null);
  const [boardError, setBoardError] = useState(false);
  const [askPin, setAskPin] = useState(false);
  const [pausedAt, setPausedAt] = useState(0);

  // ---- Waiting for a player
  useEffect(() => {
    if (stage === "boot" && api.ready && api.phase === "title") setStage("entry");
  }, [stage, api.ready, api.phase, setStage]);

  // The leaderboard beside the name entry, kept fresh
  const rankingMode = rankingModeFor(config);
  const loadBoard = useCallback(async () => {
    try {
      setBoard(await fetchLeaderboard({ mode: rankingMode, trackId: config.trackId, carId: config.carId, laps: config.laps, limit: 10 }));
      setBoardError(false);
    } catch {
      setBoardError(true);
    }
  }, [rankingMode, config.trackId, config.carId, config.laps]);
  useEffect(() => {
    if (stage !== "entry") return;
    void loadBoard();
    const id = window.setInterval(() => void loadBoard(), LEADERBOARD_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [stage, loadBoard]);
  useEffect(() => {
    if (stage !== "entry") return;
    const id = window.setInterval(onRefreshConfig, CONFIG_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [stage, onRefreshConfig]);

  const nameOk = sanitizeDriverName(name) !== "" && name.trim().length >= 2;

  // ---- Start: out of the grid, held for the countdown
  const startRun = useCallback(() => {
    if (stageRef.current !== "entry" || !apiRef.current.ready) return;
    const clean = sanitizeDriverName(name);
    if (name.trim().length < 2) {
      setNameError("Inserisci il tuo nome (almeno 2 caratteri)");
      return;
    }
    const problem = nameProblem(clean);
    if (problem) {
      setNameError("Scegli un altro nome");
      return;
    }
    setNameError(null);
    const a = apiRef.current;
    a.start(clean);
    runRef.current = { name: clean, clientId: newClientId(), config: { ...config }, laps: [], drivenMs: 0, lastTick: null };
    setOutcome(null);
    setLapToast(null);
    if (config.countdownS > 0) {
      a.setFrozen(true);
      setCountdown(config.countdownS);
      setStage("countdown");
    } else {
      runRef.current.lastTick = performance.now();
      setStage("running");
    }
  }, [name, config, setStage]);

  // The countdown: 3, 2, 1, GO; the car is released on GO
  useEffect(() => {
    if (stage !== "countdown" || countdown === null) return;
    const id = window.setTimeout(() => {
      if (countdown > 0) {
        setCountdown(countdown - 1);
        return;
      }
      setCountdown(null);
      const run = runRef.current;
      if (run) run.lastTick = performance.now();
      apiRef.current.setFrozen(false);
      setStage("running");
    }, countdown > 0 ? 1000 : 700);
    return () => window.clearTimeout(id);
  }, [stage, countdown, setStage]);

  // Held means held: the pause key (which toggles) must not release the car during the countdown or the result
  useEffect(() => {
    if ((stage === "countdown" || stage === "finished") && !api.paused) api.setFrozen(true);
  }, [stage, api.paused, api]);

  // ---- The end of a session
  const finish = useCallback(
    (reason: EndReason) => {
      const run = runRef.current;
      if (!run || stageRef.current === "finished") return;
      setStage("finished");
      apiRef.current.setFrozen(true);
      const c = run.config;
      const completed = c.limitMode === "time" ? reason === "time" : reason === "laps";
      const input: KioskResultInput = {
        clientId: run.clientId,
        name: run.name,
        trackId: c.trackId,
        carId: c.carId,
        limitMode: c.limitMode,
        limitLaps: c.laps,
        limitMinutes: c.limitMode === "time" ? c.minutes : c.maxMinutes,
        invalidLaps: c.invalidLaps,
        penaltyS: c.penaltyS,
        laps: [...run.laps],
        finished: completed,
        drivenMs: Math.round(run.drivenMs),
      };
      const raw = scoreSession(run.laps, { limitMode: c.limitMode, limitLaps: c.laps, invalidLaps: c.invalidLaps, penaltyS: c.penaltyS });
      const score = completed ? raw : { ...raw, totalTimeMs: null };
      setOutcome({ reason, input, score, status: "sending", rank: null, board: null, resultId: null, error: null });
      setResultShownAt(Date.now());
      setHoldLeft(c.resultsHoldS);
      void submitKioskResult(input).then((res) =>
        setOutcome((o) =>
          o && o.input.clientId === input.clientId
            ? {
                ...o,
                status: res.ok ? "saved" : res.queued ? "queued" : "error",
                rank: res.rank,
                board: res.leaderboard ?? null,
                resultId: res.result?.id ?? null,
                error: res.ok ? null : (res.error ?? null),
              }
            : o
        )
      );
    },
    [setStage]
  );

  // Laps: each completed lap counts towards the limit; valid ones (or penalised ones) towards the ranking
  useEffect(() => {
    const onLap = (lap: Pick<LapSummaryData, "lapTimeMs" | "valid" | "autopilot">) => {
      const run = runRef.current;
      if (!run || stageRef.current !== "running") return;
      const entry: KioskLap = { lapMs: Math.round(lap.lapTimeMs), valid: lap.valid && !lap.autopilot };
      const before = scoreSession(run.laps, { limitMode: "time", limitLaps: 1, invalidLaps: run.config.invalidLaps, penaltyS: run.config.penaltyS }).bestLapMs;
      run.laps.push(entry);
      const score = lapScoreMs(entry, run.config);
      setLapToast({ n: run.laps.length, lap: entry, best: score !== null && (before === null || score < before) });
      if (run.config.limitMode === "laps" && run.laps.length >= run.config.laps) finish("laps");
    };
    const off = api.onLap(onLap);
    // Test builds only (NEXT_PUBLIC_KIOSK_TEST_HOOKS=1 at build time; a normal build drops this): an end-to-end test
    // feeds laps the way the game does, where software rendering is too slow to drive a whole one
    if (process.env.NEXT_PUBLIC_KIOSK_TEST_HOOKS === "1") {
      const w = window as Window & { __kioskInjectLap?: (lapMs: number, valid: boolean) => void };
      w.__kioskInjectLap = (lapMs, valid) => onLap({ lapTimeMs: lapMs, valid, autopilot: false });
      return () => {
        off();
        delete w.__kioskInjectLap;
      };
    }
    return off;
  }, [api.onLap, finish]);

  // The clock: time on track only (a pause stops it), checked against the limit
  useEffect(() => {
    if (stage !== "running") return;
    const id = window.setInterval(() => {
      const run = runRef.current;
      if (!run) return;
      const now = performance.now();
      if (!apiRef.current.paused && run.lastTick !== null) run.drivenMs += now - run.lastTick;
      run.lastTick = now;
      const c = run.config;
      if (c.limitMode === "time" && run.drivenMs >= c.minutes * 60_000) finish("time");
      else if (c.limitMode === "laps" && c.maxMinutes > 0 && run.drivenMs >= c.maxMinutes * 60_000) finish("cap");
      setTick((t) => (t + 1) % 1_000_000);
    }, 100);
    return () => window.clearInterval(id);
  }, [stage, finish]);

  // A lap's toast stays a few seconds
  useEffect(() => {
    if (!lapToast) return;
    const id = window.setTimeout(() => setLapToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [lapToast]);

  // ---- Next player
  const nextPlayer = useCallback(() => {
    if (stageRef.current !== "finished") return;
    runRef.current = null;
    setOutcome(null);
    setName("");
    setNameError(null);
    apiRef.current.stop();
    setStage("entry");
    onRefreshConfig();
  }, [onRefreshConfig, setStage]);
  useEffect(() => {
    if (stage !== "finished") return;
    const id = window.setInterval(() => setHoldLeft((left) => Math.max(0, left - 1)), 1000);
    return () => window.clearInterval(id);
  }, [stage]);
  useEffect(() => {
    if (stage === "finished" && holdLeft === 0 && Date.now() - resultShownAt > 1000) nextPlayer();
  }, [stage, holdLeft, resultShownAt, nextPlayer]);

  // ---- Pause (the pause key, the pad's pause button, a wheel unplugged)
  const showPause = stage === "running" && api.paused;
  useEffect(() => {
    if (showPause) setPausedAt(Date.now());
  }, [showPause]);
  const resume = useCallback(() => apiRef.current.setFrozen(false), []);

  // ---- Pad and wheel buttons: start, resume, next player
  useGamepadPress(
    (button) => {
      const s = stageRef.current;
      if (s === "entry" && nameOk && !askPin) startRun();
      else if (s === "running" && apiRef.current.paused && Date.now() - pausedAt > 600) resume();
      else if (s === "finished" && Date.now() - resultShownAt > RESULT_INPUT_DELAY_MS && button >= 0) nextPlayer();
    },
    stage === "entry" || stage === "finished" || showPause
  );

  // Physical keyboard on the name screen: Enter starts
  useEffect(() => {
    if (stage !== "entry" && stage !== "finished") return;
    const onKey = (e: KeyboardEvent) => {
      if (askPin || e.key !== "Enter") return;
      if (stageRef.current === "entry") startRun();
      else if (Date.now() - resultShownAt > RESULT_INPUT_DELAY_MS) nextPlayer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, startRun, nextPlayer, askPin, resultShownAt]);

  // ---- Staff: five taps in the top-left corner, or Ctrl+Shift+K, then the PIN
  const staffTap = useStaffGesture(() => setAskPin(true));
  const endByStaff = useCallback(() => finish("staff"), [finish]);

  // ---- Drawing
  const run = runRef.current;
  const c = run?.config ?? config;
  const rules = rulesText(c);
  const liveScore = run ? scoreSession(run.laps, { limitMode: c.limitMode, limitLaps: c.laps, invalidLaps: c.invalidLaps, penaltyS: c.penaltyS }) : null;
  const remainingMs = run && c.limitMode === "time" ? c.minutes * 60_000 - run.drivenMs : null;
  const capLeftMs = run && c.limitMode === "laps" && c.maxMinutes > 0 ? c.maxMinutes * 60_000 - run.drivenMs : null;

  return (
    <>
      {/* The staff's corner */}
      <button
        type="button"
        aria-label="Area staff"
        onClick={staffTap}
        className="fixed left-0 top-0 z-[85] h-16 w-16 cursor-default opacity-0"
        tabIndex={-1}
      />
      {askPin ? (
        <PinDialog
          title="Accesso staff"
          onSuccess={() => {
            setAskPin(false);
            onStaffExit();
          }}
          onCancel={() => setAskPin(false)}
        />
      ) : null}

      {stage === "boot" ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-black/70 px-5 py-2 font-f1-italic text-sm font-bold uppercase tracking-[0.2em] text-white/80">
          Preparazione del circuito…
        </div>
      ) : null}

      {stage === "entry" ? (
        <div className="fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-gradient-to-r from-black/90 via-black/75 to-black/40 px-[max(1.25rem,env(safe-area-inset-left))] py-6 text-white">
          <BrandHeader />
          <div className="mt-6 flex flex-1 flex-col gap-8 lg:flex-row lg:items-start">
            <section className="flex w-full max-w-3xl flex-col gap-5">
              <div>
                <h1 className="font-f1-display text-4xl font-black uppercase leading-tight tracking-[0.06em] sm:text-5xl">{EVENT_BRAND.challenge}</h1>
                <p className="mt-2 font-f1-italic text-2xl font-bold text-[#FF3B30]">{rules.headline}</p>
                <p className="mt-1 max-w-2xl font-f1-italic text-base text-white/70">{rules.detail}</p>
              </div>
              {/* Not wrapped in its label: the game rings a label round a focused input (globals.css), in its own lime */}
              <div className="flex flex-col gap-2">
                <label htmlFor="kiosk-player-name" className="font-f1-italic text-sm font-bold uppercase tracking-[0.25em] text-white/60">
                  Il tuo nome
                </label>
                <input
                  id="kiosk-player-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value.slice(0, 16));
                    setNameError(null);
                  }}
                  maxLength={16}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="NOME"
                  className="h-16 w-full max-w-xl rounded-xl border-2 border-white/20 bg-black/50 px-5 font-f1-display text-3xl font-bold uppercase tracking-[0.08em] text-white outline-none placeholder:text-white/25 focus:border-[#C7000B] focus-visible:outline-none"
                />
              </div>
              {nameError ? <p className="font-f1-italic text-lg font-bold text-[#FF6B60]">{nameError}</p> : null}
              <OnScreenKeyboard
                onKey={(k) => {
                  setName((n) => (n + k).replace(/^\s+/, "").slice(0, 16));
                  setNameError(null);
                }}
                onBackspace={() => setName((n) => n.slice(0, -1))}
              />
              <div className="flex flex-wrap items-center gap-4">
                <KioskButton big onClick={startRun} disabled={!nameOk || !api.ready}>
                  Gioca
                </KioskButton>
                <p className="max-w-md font-f1-italic text-sm text-white/60">
                  Acceleratore per partire · pulsante pausa o Esc per fermarti. Il nome comparirà nella classifica pubblica dell&apos;evento.
                </p>
              </div>
            </section>
            <aside className="w-full max-w-xl rounded-2xl border border-white/10 bg-black/55 p-5 backdrop-blur-sm">
              <LeaderboardTable board={board} limit={10} emptyText={boardError ? "Classifica non disponibile" : undefined} />
            </aside>
          </div>
          <div className="mt-6 flex items-end justify-between gap-4">
            <KioskCredits className="max-w-4xl" />
            {configSource !== "server" ? (
              <span className="shrink-0 rounded-full border border-[#FFB300]/50 px-3 py-1 font-f1-mono text-[11px] text-[#FFB300]">
                server offline · config {configSource === "cache" ? "in cache" : "predefinita"}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {stage === "countdown" && countdown !== null ? (
        <div className="pointer-events-none fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/30 text-white">
          <p className="mb-4 font-f1-italic text-2xl font-bold uppercase tracking-[0.3em] text-white/80">{run?.name}</p>
          <div key={countdown} className="font-f1-display text-[12rem] font-black leading-none text-white drop-shadow-[0_8px_40px_rgba(199,0,11,0.9)]">
            {countdown > 0 ? countdown : "VIA!"}
          </div>
        </div>
      ) : null}

      {(stage === "running" || stage === "countdown") && run ? (
        <div className="pointer-events-none fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-[65] -translate-x-1/2">
          <div className="flex items-stretch overflow-hidden rounded-xl border border-white/15 bg-black/75 text-white shadow-[0_10px_40px_rgba(0,0,0,0.5)] backdrop-blur-md">
            <div className="flex flex-col justify-center bg-[#C7000B] px-3 py-1 font-f1-display text-[10px] font-black uppercase leading-tight tracking-[0.15em]">
              <span>{EVENT_BRAND.sponsor}</span>
              <span className="opacity-80">MGW {EVENT_BRAND.year}</span>
            </div>
            <div className="flex flex-col items-center px-4 py-1">
              <span className="font-f1-italic text-[10px] font-bold uppercase tracking-[0.25em] text-white/60">
                {c.limitMode === "time" ? "Tempo rimasto" : "Tempo"}
              </span>
              <span
                className={`font-f1-mono text-3xl font-bold tabular-nums ${remainingMs !== null && remainingMs < 30_000 ? "animate-pulse text-[#FF3B30]" : ""}`}
              >
                {remainingMs !== null ? formatClock(remainingMs, true) : formatClock(run.drivenMs)}
              </span>
            </div>
            <div className="flex flex-col items-center border-l border-white/10 px-4 py-1">
              <span className="font-f1-italic text-[10px] font-bold uppercase tracking-[0.25em] text-white/60">{c.limitMode === "laps" ? "Giro" : "Giri"}</span>
              <span className="font-f1-mono text-3xl font-bold tabular-nums">
                {c.limitMode === "laps" ? `${Math.min(run.laps.length + 1, c.laps)}/${c.laps}` : run.laps.length}
              </span>
            </div>
            <div className="flex flex-col items-center border-l border-white/10 px-4 py-1">
              <span className="font-f1-italic text-[10px] font-bold uppercase tracking-[0.25em] text-white/60">Migliore</span>
              <span className="font-f1-mono text-2xl font-bold tabular-nums">
                {formatLapTime(liveScore?.bestLapMs)}
                {liveScore?.bestLapPenalised ? <span className="text-sm text-[#FFB300]">*</span> : null}
              </span>
              {api.telemetry.lapInvalid ? <span className="font-f1-italic text-[10px] font-bold uppercase text-[#FFB300]">giro non valido</span> : null}
            </div>
            {capLeftMs !== null ? (
              <div className="flex flex-col items-center border-l border-white/10 px-3 py-1">
                <span className="font-f1-italic text-[10px] font-bold uppercase tracking-[0.25em] text-white/60">Max</span>
                <span className={`font-f1-mono text-xl font-bold tabular-nums ${capLeftMs < 30_000 ? "text-[#FF3B30]" : "text-white/80"}`}>{formatClock(capLeftMs, true)}</span>
              </div>
            ) : null}
          </div>
          {c.limitMode === "laps" && run.laps.length === c.laps - 1 && stage === "running" ? (
            <p className="mt-2 text-center font-f1-display text-lg font-black uppercase tracking-[0.2em] text-[#FF3B30] drop-shadow">Ultimo giro!</p>
          ) : null}
          {remainingMs !== null && remainingMs < 60_000 && remainingMs > 0 && stage === "running" ? (
            <p className="mt-2 text-center font-f1-display text-lg font-black uppercase tracking-[0.2em] text-[#FF3B30] drop-shadow">Ultimo minuto!</p>
          ) : null}
        </div>
      ) : null}

      {lapToast && stage === "running" ? (
        <div className="pointer-events-none fixed left-1/2 top-28 z-[65] -translate-x-1/2 rounded-xl border border-white/15 bg-black/80 px-6 py-3 text-center text-white backdrop-blur-md">
          <p className="font-f1-italic text-xs font-bold uppercase tracking-[0.3em] text-white/60">Giro {lapToast.n}</p>
          <p className="font-f1-mono text-4xl font-bold tabular-nums">{formatLapTime(lapToast.lap.lapMs)}</p>
          <p className={`font-f1-italic text-sm font-bold uppercase ${lapToast.lap.valid ? "text-[#4ADE80]" : "text-[#FFB300]"}`}>
            {lapToast.lap.valid
              ? lapToast.best
                ? "Nuovo miglior giro!"
                : "Giro valido"
              : c.invalidLaps === "penalty"
                ? `Fuori dai limiti: +${c.penaltyS} s`
                : "Fuori dai limiti: non conta"}
          </p>
        </div>
      ) : null}

      {showPause ? (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/70 text-white backdrop-blur-sm">
          <div className="flex w-[min(92vw,34rem)] flex-col items-center gap-5 rounded-2xl border border-white/15 bg-[#111117] p-8 text-center">
            <h2 className="font-f1-display text-4xl font-black uppercase tracking-[0.15em]">Pausa</h2>
            {api.pauseNotice ? <p className="font-f1-italic text-lg font-bold text-[#FFB300]">{api.pauseNotice}</p> : null}
            <p className="font-f1-italic text-white/70">Il cronometro è fermo. Premi un pulsante del volante o del controller per riprendere.</p>
            <KioskButton big onClick={resume}>
              Riprendi
            </KioskButton>
            <KioskButton tone="danger" onClick={endByStaff}>
              Termina sessione
            </KioskButton>
          </div>
        </div>
      ) : null}

      {stage === "finished" && outcome ? (
        <div className="fixed inset-0 z-[75] flex flex-col overflow-y-auto bg-black/85 px-[max(1.25rem,env(safe-area-inset-left))] py-6 text-white backdrop-blur-sm">
          <BrandHeader compact />
          <div className="mt-6 flex flex-1 flex-col gap-8 lg:flex-row lg:items-start">
            <section className="flex w-full max-w-2xl flex-col gap-4">
              <p className="font-f1-italic text-lg font-bold uppercase tracking-[0.3em] text-[#FF3B30]">{END_TITLES[outcome.reason]}</p>
              <h2 className="font-f1-display text-5xl font-black uppercase tracking-[0.05em]">{outcome.input.name}</h2>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Miglior giro" value={formatLapTime(outcome.score.bestLapMs)} note={outcome.score.bestLapPenalised ? `con penalità +${outcome.input.penaltyS} s` : undefined} />
                {outcome.input.limitMode === "laps" ? (
                  <Stat label={`Tempo totale (${outcome.input.limitLaps} giri)`} value={formatLapTime(outcome.score.totalTimeMs)} note={outcome.score.totalTimeMs === null ? "giri non completati" : undefined} />
                ) : (
                  <Stat label="Tempo di guida" value={formatClock(outcome.input.drivenMs)} />
                )}
                <Stat label="Giri completati" value={String(outcome.input.laps.length)} />
                <Stat label="Giri validi" value={String(outcome.score.validLaps)} />
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-5 py-4">
                {outcome.status === "sending" ? (
                  <p className="font-f1-italic text-xl font-bold text-white/70">Invio del risultato…</p>
                ) : outcome.rank !== null ? (
                  <p className="font-f1-display text-3xl font-black uppercase">
                    Posizione <span className="text-[#FF3B30]">#{outcome.rank}</span>
                    {outcome.board ? <span className="ml-2 text-lg text-white/60">su {Math.max(outcome.board.total, outcome.rank)}</span> : null}
                  </p>
                ) : outcome.status === "saved" ? (
                  <p className="font-f1-italic text-xl font-bold text-white/80">Nessun giro completo valido: nessun tempo in classifica. Riprova!</p>
                ) : (
                  <p className="font-f1-italic text-lg font-bold text-[#FFB300]">{outcome.error ?? "Risultato non inviato"}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <KioskButton big onClick={nextPlayer}>
                  Prossimo giocatore
                </KioskButton>
                <span className="font-f1-mono text-lg text-white/60">tra {holdLeft} s</span>
              </div>
            </section>
            <aside className="w-full max-w-xl rounded-2xl border border-white/10 bg-black/55 p-5">
              <LeaderboardTable
                board={outcome.board}
                highlightId={outcome.resultId}
                highlightName={outcome.input.name}
                limit={10}
                emptyText={outcome.status === "sending" ? "…" : undefined}
              />
            </aside>
          </div>
        </div>
      ) : null}
    </>
  );
};

const Stat: React.FC<{ label: string; value: string; note?: string }> = ({ label, value, note }) => (
  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
    <p className="font-f1-italic text-xs font-bold uppercase tracking-[0.25em] text-white/60">{label}</p>
    <p className="font-f1-mono text-3xl font-bold tabular-nums">{value}</p>
    {note ? <p className="font-f1-italic text-xs font-bold text-[#FFB300]">{note}</p> : null}
  </div>
);
