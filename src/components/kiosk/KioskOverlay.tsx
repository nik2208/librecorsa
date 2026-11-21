"use client";

/**
 * The kiosk's screens over the game: the loading screen, the menu (GIOCA, the leaderboard, the staff's settings), the
 * player's name and level, the countdown, the session clock (laps or minutes, as the admin set), the pause screen, and
 * the result once the limit is reached, which then goes back to the menu.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { nameProblem } from "@/lib/net/name-filter";
import { sanitizeDriverName } from "@/lib/settings/player-settings";
import type { KioskSimApi } from "@/lib/kiosk/kiosk-bridge";
import type { LapSummaryData } from "@/lib/sim/lap-types";
import type { AssistPreset } from "@/types/f1";
import { useAssetProgress, type AssetProgressSnapshot } from "@/lib/loading/asset-progress";
import { withBasePath } from "@/lib/base-path";
import { fetchLeaderboard, newClientId, submitKioskResult, type ConfigSource } from "@/lib/kiosk/kiosk-api";
import { formatClock, formatLapTime, formatMinutes, lapScoreMs, scoreSession, type KioskScore } from "@/lib/kiosk/kiosk-score";
import {
  KIOSK_CARS,
  KIOSK_DIFFICULTIES,
  KIOSK_TRACKS,
  difficultyLabel,
  rankingModeFor,
  type KioskConfig,
  type KioskLap,
  type KioskLeaderboard,
  type KioskResultInput,
} from "@/lib/kiosk/kiosk-types";
import { EVENT_BRAND } from "@/lib/kiosk/event-brand";
import { challengeName, shownLogos, type KioskLogo } from "@/lib/kiosk/kiosk-logos";
import { BrandHeader, KioskButton, LeaderboardTable, OnScreenKeyboard, PinDialog, useGamepadPress, useKioskLogos, useStaffGesture } from "@/components/kiosk/kiosk-ui";

type Stage = "boot" | "menu" | "entry" | "countdown" | "running" | "finished";
type EndReason = "time" | "laps" | "cap" | "staff";

/** The downloads the kiosk can't do without (no opponents on the kiosk; the shaders compile, they don't download) */
const KIOSK_DOWNLOADS: ReadonlySet<string> = new Set(["track", "car"]);

/** Standard-mapping pad buttons the start screen reads (any other button starts the session) */
const PAD_B = 1;
const PAD_UP = 12;
const PAD_DOWN = 13;
const PAD_LEFT = 14;
const PAD_RIGHT = 15;

interface Run {
  name: string;
  clientId: string;
  difficulty: AssistPreset;
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
/** The name screen goes back to the menu after this long with nobody touching anything */
const ENTRY_IDLE_MS = 90_000;
/** A load still going after this long offers to start again (a slow PC can take minutes: it is never cut short) */
const BOOT_SLOW_MS = 120_000;
/** A download that has received nothing for this long is stuck: the page starts again by itself */
const BOOT_STALL_MS = 90_000;

/** A logo's name in the race clock's badge (the event's, short) */
const badgeName = (logo: KioskLogo): string => (logo.id === "mgw" ? `MGW ${EVENT_BRAND.year}` : logo.name);

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
  /** The level the player picked (the game drives with its assists) */
  difficulty: AssistPreset;
  onDifficulty: (difficulty: AssistPreset) => void;
  /** Reads the admin's config again (between players, and now and then while idle) */
  onRefreshConfig: () => void;
  /** The staff gave the PIN: leave the game for the admin page */
  onStaffExit: () => void;
}

export const KioskOverlay: React.FC<KioskOverlayProps> = ({ api, config, configSource, difficulty, onDifficulty, onRefreshConfig, onStaffExit }) => {
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
  // The logos the staff turned on, for the race clock's badge (kept up to date mid-race), and the game's name with them
  const logoList = useKioskLogos();
  const brands = shownLogos(logoList);
  const challenge = challengeName(logoList);

  // ---- Loaded: the menu. A circuit or car that failed to download keeps the loading screen up, which starts the
  // page again (the game would otherwise go on without it)
  const progress = useAssetProgress();
  const downloadFailed = progress.tasks.some((t) => KIOSK_DOWNLOADS.has(t.id) && t.status === "failed");
  useEffect(() => {
    if (stage === "boot" && api.ready && api.phase === "title" && !downloadFailed) setStage("menu");
  }, [stage, api.ready, api.phase, downloadFailed, setStage]);

  // The circuit actually loaded: the config's, or the default when its files could not be loaded (results and boards
  // go with what visitors really drive)
  const activeTrackId = api.trackId;
  // The leaderboard beside the name entry, kept fresh
  /** Tilt steering on (the controller only): the name screen and the countdown say how to hold the pad */
  const gyroOn = config.device === "controller" && config.gyroSteer;
  const rankingMode = rankingModeFor(config);
  const loadBoard = useCallback(async () => {
    try {
      setBoard(await fetchLeaderboard({ mode: rankingMode, trackId: activeTrackId, carId: config.carId, laps: config.laps, limit: 10 }));
      setBoardError(false);
    } catch {
      setBoardError(true);
    }
  }, [rankingMode, activeTrackId, config.carId, config.laps]);
  const waiting = stage === "menu" || stage === "entry";
  useEffect(() => {
    if (!waiting) return;
    void loadBoard();
    const id = window.setInterval(() => void loadBoard(), LEADERBOARD_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [waiting, loadBoard]);
  useEffect(() => {
    if (stage !== "menu") return;
    const id = window.setInterval(onRefreshConfig, CONFIG_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [stage, onRefreshConfig]);

  const nameOk = sanitizeDriverName(name) !== "" && name.trim().length >= 2;

  // ---- Menu → the player's name and level, and back
  const lastInputRef = useRef(0);
  const markInput = useCallback(() => {
    lastInputRef.current = Date.now();
  }, []);
  const goToEntry = useCallback(() => {
    if (stageRef.current !== "menu" || !apiRef.current.ready) return;
    setName("");
    setNameError(null);
    // Each player starts from the admin's level
    onDifficulty(config.difficulty);
    apiRef.current.unlockAudio();
    markInput();
    setStage("entry");
  }, [config.difficulty, onDifficulty, markInput, setStage]);
  const cycleDifficulty = useCallback(
    (step: 1 | -1) => {
      const i = KIOSK_DIFFICULTIES.findIndex((d) => d.id === difficulty);
      const next = KIOSK_DIFFICULTIES[Math.min(KIOSK_DIFFICULTIES.length - 1, Math.max(0, (i < 0 ? 0 : i) + step))];
      onDifficulty(next.id);
    },
    [difficulty, onDifficulty]
  );

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
    runRef.current = {
      name: clean,
      clientId: newClientId(),
      difficulty,
      config: { ...config, trackId: a.trackId as KioskConfig["trackId"] },
      laps: [],
      drivenMs: 0,
      lastTick: null,
    };
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
  }, [name, config, difficulty, setStage]);

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
        difficulty: run.difficulty,
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

  // ---- Back to the menu: from the name screen, or after the result (the car goes back to the grid)
  const backToMenu = useCallback(() => {
    const s = stageRef.current;
    if (s === "finished") {
      runRef.current = null;
      setOutcome(null);
      apiRef.current.stop();
      onRefreshConfig();
    } else if (s !== "entry") return;
    setName("");
    setNameError(null);
    setStage("menu");
  }, [onRefreshConfig, setStage]);
  useEffect(() => {
    if (stage !== "finished") return;
    const id = window.setInterval(() => setHoldLeft((left) => Math.max(0, left - 1)), 1000);
    return () => window.clearInterval(id);
  }, [stage]);
  useEffect(() => {
    if (stage === "finished" && holdLeft === 0 && Date.now() - resultShownAt > 1000) backToMenu();
  }, [stage, holdLeft, resultShownAt, backToMenu]);

  // A name screen nobody touches goes back to the menu
  useEffect(() => {
    if (stage !== "entry") return;
    markInput();
    window.addEventListener("keydown", markInput);
    window.addEventListener("pointerdown", markInput);
    const id = window.setInterval(() => {
      if (Date.now() - lastInputRef.current > ENTRY_IDLE_MS) backToMenu();
    }, 2000);
    return () => {
      window.removeEventListener("keydown", markInput);
      window.removeEventListener("pointerdown", markInput);
      window.clearInterval(id);
    };
  }, [stage, markInput, backToMenu]);

  // ---- Pause (the pause key, the pad's pause button, a wheel unplugged)
  const showPause = stage === "running" && api.paused;
  useEffect(() => {
    if (showPause) setPausedAt(Date.now());
  }, [showPause]);
  const resume = useCallback(() => apiRef.current.setFrozen(false), []);

  // ---- Pad and wheel buttons: menu → name screen, the level (d-pad), start, back (B), resume, back to the menu
  useGamepadPress(
    (button) => {
      if (askPin) return;
      const s = stageRef.current;
      if (s === "menu") goToEntry();
      else if (s === "entry") {
        markInput();
        if (button === PAD_LEFT || button === PAD_UP) cycleDifficulty(-1);
        else if (button === PAD_RIGHT || button === PAD_DOWN) cycleDifficulty(1);
        else if (button === PAD_B) backToMenu();
        else if (nameOk) startRun();
      } else if (s === "running" && apiRef.current.paused && Date.now() - pausedAt > 600) resume();
      else if (s === "finished" && Date.now() - resultShownAt > RESULT_INPUT_DELAY_MS) backToMenu();
    },
    stage === "menu" || stage === "entry" || stage === "finished" || showPause
  );

  // Physical keyboard: Enter goes on (menu, start, result), Esc goes back from the name screen
  useEffect(() => {
    if (stage !== "menu" && stage !== "entry" && stage !== "finished") return;
    const onKey = (e: KeyboardEvent) => {
      if (askPin) return;
      const s = stageRef.current;
      if (e.key === "Escape" && s === "entry") backToMenu();
      if (e.key !== "Enter") return;
      if (s === "menu") goToEntry();
      else if (s === "entry") startRun();
      else if (Date.now() - resultShownAt > RESULT_INPUT_DELAY_MS) backToMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, startRun, goToEntry, backToMenu, askPin, resultShownAt]);

  // ---- Staff: five taps in the top-left corner, or Ctrl+Shift+K, then the PIN
  const staffTap = useStaffGesture(() => setAskPin(true));
  const endByStaff = useCallback(() => finish("staff"), [finish]);

  // ---- Drawing
  const run = runRef.current;
  const c = run?.config ?? config;
  const rules = rulesText(c);
  const carLabel = KIOSK_CARS.find((x) => x.id === config.carId)?.label ?? config.carId;
  const trackLabel = KIOSK_TRACKS.find((t) => t.id === activeTrackId)?.label ?? activeTrackId;
  const statusPills = (
    <div className="flex flex-col items-start gap-1">
      {activeTrackId !== config.trackId ? (
        <span className="rounded-full border border-[#FFB300]/50 px-3 py-1 font-f1-mono text-[11px] text-[#FFB300]">
          {KIOSK_TRACKS.find((t) => t.id === config.trackId)?.label ?? config.trackId} non caricato · in uso {trackLabel}
        </span>
      ) : null}
      {configSource !== "server" ? (
        <span className="rounded-full border border-[#FFB300]/50 px-3 py-1 font-f1-mono text-[11px] text-[#FFB300]">
          server del kiosk non raggiungibile · config {configSource === "cache" ? "in cache" : "predefinita"} · classifica non disponibile
        </span>
      ) : null}
    </div>
  );
  const liveScore = run ? scoreSession(run.laps, { limitMode: c.limitMode, limitLaps: c.laps, invalidLaps: c.invalidLaps, penaltyS: c.penaltyS }) : null;
  const remainingMs = run && c.limitMode === "time" ? c.minutes * 60_000 - run.drivenMs : null;
  const capLeftMs = run && c.limitMode === "laps" && c.maxMinutes > 0 ? c.maxMinutes * 60_000 - run.drivenMs : null;

  return (
    // display: contents: no box of its own, only the kiosk's focus colours for everything inside (globals.css)
    <div className="kiosk-ui contents">
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

      {stage === "boot" ? <KioskBootScreen progress={progress} downloadFailed={downloadFailed} motto={config.motto} /> : null}

      {stage === "menu" ? (
        <div className="fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-gradient-to-r from-black/90 via-black/70 to-black/25 px-[max(1.25rem,env(safe-area-inset-left))] py-6 text-white">
          <BrandHeader />
          <div className="mt-4 flex flex-1 flex-col gap-6 lg:flex-row lg:items-center 2xl:gap-10">
            <section className="flex w-full max-w-4xl flex-col gap-4 2xl:gap-6">
              <h1 className="font-f1-display text-4xl font-black uppercase leading-tight tracking-[0.06em] lg:text-5xl 2xl:text-7xl">{challenge}</h1>
              {config.motto ? <p className="font-f1-italic text-2xl font-bold text-white/85 2xl:text-4xl">{config.motto}</p> : null}
              <p className="font-f1-display text-2xl font-black uppercase tracking-[0.12em] text-[#FF3B30] 2xl:text-3xl">
                {carLabel} · {trackLabel}
              </p>
              <div>
                <p className="font-f1-italic text-2xl font-bold">{rules.headline}</p>
                <p className="mt-1 max-w-2xl font-f1-italic text-base text-white/70">{rules.detail}</p>
              </div>
              <KioskButton big autoFocus onClick={goToEntry} disabled={!api.ready} className="mt-1 self-start !px-16 !py-5 !text-5xl 2xl:!px-20 2xl:!py-7 2xl:!text-6xl">
                Gioca
              </KioskButton>
              <p className="font-f1-italic text-base text-white/60">Tocca GIOCA o premi un pulsante del controller</p>
            </section>
            <aside className="w-full max-w-xl rounded-2xl border border-white/10 bg-black/55 p-5 backdrop-blur-sm">
              <LeaderboardTable board={board} limit={10} emptyText={boardError ? "Classifica non disponibile" : undefined} />
            </aside>
          </div>
          <div className="mt-4 flex items-end justify-between gap-4">
            {statusPills}
            <button
              type="button"
              onClick={() => setAskPin(true)}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/15 px-4 py-2 font-f1-italic text-sm font-bold uppercase tracking-[0.2em] text-white/55 hover:bg-white/10"
            >
              <Settings className="h-4 w-4" aria-hidden /> Impostazioni
            </button>
          </div>
          {/* Where the game comes from and under which licence: plain, small, for whoever asks */}
          <p className="mt-3 font-f1-italic text-xs leading-snug text-white/45">
            Questo gioco è una versione adattata di LibreCorsa di KhazP (github.com/KhazP/librecorsa), software libero pubblicato con
            licenza AGPL-3.0. Sorgenti di questa versione: github.com/nik2208/librecorsa
          </p>
        </div>
      ) : null}

      {stage === "entry" ? (
        <div className="fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-black/85 px-[max(1.25rem,env(safe-area-inset-left))] py-6 text-white backdrop-blur-sm">
          <BrandHeader compact />
          <div className="mt-6 flex flex-1 flex-col gap-8 lg:flex-row lg:items-start">
            <section className="flex w-full max-w-3xl flex-col gap-5">
              <h2 className="font-f1-display text-4xl font-black uppercase tracking-[0.06em] sm:text-5xl">Chi guida?</h2>
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
            </section>
            <section className="flex w-full max-w-xl flex-col gap-4">
              <h3 className="font-f1-italic text-sm font-bold uppercase tracking-[0.25em] text-white/60">Difficoltà</h3>
              <div className="flex flex-col gap-2" role="radiogroup" aria-label="Difficoltà">
                {KIOSK_DIFFICULTIES.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={difficulty === d.id}
                    onClick={() => onDifficulty(d.id)}
                    className={`flex flex-col items-start rounded-xl border-2 px-5 py-3 text-left transition-colors ${difficulty === d.id ? "border-[#C7000B] bg-[#C7000B] text-white" : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10"}`}
                  >
                    <span className="font-f1-display text-2xl font-black uppercase tracking-[0.1em]">{d.label}</span>
                    <span className={`font-f1-italic text-sm ${difficulty === d.id ? "text-white/85" : "text-white/55"}`}>{d.hint}</span>
                  </button>
                ))}
              </div>
              <p className="font-f1-italic text-base font-bold text-white/80">
                {carLabel} · {trackLabel} · {rules.headline}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <KioskButton big onClick={startRun} disabled={!nameOk || !api.ready}>
                  Via!
                </KioskButton>
                <KioskButton tone="ghost" onClick={backToMenu}>
                  Indietro
                </KioskButton>
              </div>
              <p className="max-w-md font-f1-italic text-sm text-white/60">
                Controller: frecce per la difficoltà · A per partire · B per tornare al menu. In gara: RT accelera, LT frena, pulsante
                pausa per fermarti.
                {gyroOn ? " Sterzi anche inclinando il controller: tienilo dritto al VIA!, e tieni premuto il touchpad per rimetterlo al centro." : ""}{" "}
                Il nome comparirà nella classifica pubblica dell&apos;evento.
              </p>
            </section>
          </div>
          <div className="mt-6">{statusPills}</div>
        </div>
      ) : null}

      {stage === "countdown" && countdown !== null ? (
        <div className="pointer-events-none fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/30 text-white">
          <p className="mb-4 font-f1-italic text-2xl font-bold uppercase tracking-[0.3em] text-white/80">
            {run?.name} · {difficultyLabel(run?.difficulty)}
          </p>
          <div key={countdown} className="font-f1-display text-[12rem] font-black leading-none text-white drop-shadow-[0_8px_40px_rgba(199,0,11,0.9)]">
            {countdown > 0 ? countdown : "VIA!"}
          </div>
          {gyroOn ? (
            <p className="mt-4 font-f1-italic text-xl font-bold uppercase tracking-[0.2em] text-white/80">Tieni il controller dritto</p>
          ) : null}
        </div>
      ) : null}

      {(stage === "running" || stage === "countdown") && run ? (
        <TopCentre>
          <div className="flex items-stretch overflow-hidden rounded-xl border border-white/15 bg-black/75 text-white shadow-[0_10px_40px_rgba(0,0,0,0.5)] backdrop-blur-md">
            {brands.length > 0 ? (
              <div className="flex flex-col justify-center bg-[#C7000B] px-3 py-1 font-f1-display text-[10px] font-black uppercase leading-tight tracking-[0.15em]">
                {brands.slice(0, 3).map((logo, i) => (
                  <span key={logo.id} className={`max-w-[9rem] truncate ${i > 0 ? "opacity-80" : ""}`}>
                    {badgeName(logo)}
                  </span>
                ))}
              </div>
            ) : null}
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
          {/* The lap just done, under the bar and in the same block: the game's notices then start under it too */}
          {lapToast && stage === "running" ? (
            <div className="mt-3 rounded-xl border border-white/15 bg-black/80 px-6 py-3 text-center text-white backdrop-blur-md">
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
        </TopCentre>
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
              <p className="-mt-2 font-f1-italic text-lg font-bold uppercase tracking-[0.2em] text-white/60">
                {carLabel} · {KIOSK_TRACKS.find((t) => t.id === outcome.input.trackId)?.label ?? outcome.input.trackId} · {difficultyLabel(outcome.input.difficulty)}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Miglior giro" value={formatLapTime(outcome.score.bestLapMs)} note={outcome.score.bestLapPenalised ? `con penalità +${outcome.input.penaltyS} s` : undefined} />
                {outcome.input.limitMode === "laps" ? (
                  <Stat label={`Tempo totale (${outcome.input.limitLaps} ${outcome.input.limitLaps === 1 ? "giro" : "giri"})`} value={formatLapTime(outcome.score.totalTimeMs)} note={outcome.score.totalTimeMs === null ? "giri non completati" : undefined} />
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
                <KioskButton big onClick={backToMenu}>
                  Menu
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
    </div>
  );
};

/** While the circuit and the car load: the event's screen with the progress (the game's own loading screen is not shown) */
/**
 * The kiosk's block at the top centre of the screen while a session runs: the bar (time left, laps, best lap), the
 * last-lap and last-minute calls and the card of the lap just done. The game puts its own notices in the same place
 * (track limits, the flaps, the graphics quality, the launch hint): while this block is up it tells the game's HUD
 * where it ends (--lc-kiosk-top, read by F1TelemetryHud), so they start under it instead of behind it.
 */
const TopCentre: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const tell = () => root.style.setProperty("--lc-kiosk-top", `${Math.ceil(el.getBoundingClientRect().bottom) + 8}px`);
    tell();
    const sized = typeof ResizeObserver !== "undefined" ? new ResizeObserver(tell) : null;
    sized?.observe(el);
    window.addEventListener("resize", tell);
    return () => {
      sized?.disconnect();
      window.removeEventListener("resize", tell);
      root.style.removeProperty("--lc-kiosk-top");
    };
  }, []);
  return (
    <div ref={ref} className="pointer-events-none fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-[65] flex -translate-x-1/2 flex-col items-center">
      {children}
    </div>
  );
};

const KioskBootScreen: React.FC<{ progress: AssetProgressSnapshot; downloadFailed: boolean; motto: string }> = ({ progress, downloadFailed, motto }) => {
  const challenge = challengeName(useKioskLogos());
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = now - startedAt;
  // The circuit's or the car's download (the shaders don't count: a slow GPU compiles for long, and the game goes on
  // when it is done, even after the watchdog has marked them failed)
  const failed = downloadFailed;
  // A download with no data for a while
  const downloading = progress.tasks.filter((t) => t.status === "loading" && KIOSK_DOWNLOADS.has(t.id));
  const lastData = downloading.length ? Math.max(...downloading.map((t) => t.lastProgressMs)) : null;
  const stalled = lastData !== null && lastData > 0 && performance.now() - lastData > BOOT_STALL_MS;
  // A failed or stuck load starts again by itself: nobody may be there to press anything
  useEffect(() => {
    if (!failed && !stalled) return;
    const id = window.setTimeout(() => window.location.reload(), 15_000);
    return () => window.clearTimeout(id);
  }, [failed, stalled]);
  const pct = Math.round(Math.min(1, Math.max(0, progress.progress)) * 100);
  return (
    <div className="kiosk-ui fixed inset-0 z-[72] flex flex-col items-center justify-center gap-8 bg-[radial-gradient(ellipse_at_top_left,#3a0306_0%,#08090D_60%)] px-6 text-white">
      <BrandHeader />
      <h1 className="text-center font-f1-display text-4xl font-black uppercase tracking-[0.08em] sm:text-6xl">{challenge}</h1>
      {motto ? <p className="-mt-4 text-center font-f1-italic text-2xl font-bold text-white/85">{motto}</p> : null}
      <div className="w-[min(90vw,36rem)]">
        <div className="h-3 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-[#C7000B]" style={{ width: `${failed || stalled ? 100 : pct}%` }} />
        </div>
        <p className="mt-3 text-center font-f1-italic text-lg font-bold uppercase tracking-[0.25em] text-white/70">
          {failed || stalled
            ? "Caricamento non riuscito · nuovo tentativo tra poco"
            : progress.settled
              ? "Preparazione della pista…"
              : `Caricamento ${pct}%`}
        </p>
      </div>
      {failed || stalled || elapsed > BOOT_SLOW_MS ? (
        <div className="flex flex-col items-center gap-3">
          {!failed && !stalled ? (
            <p className="max-w-xl text-center font-f1-italic text-sm text-white/60">
              Il caricamento sta richiedendo molto tempo. Se succede sempre, abbassa la qualità grafica nelle impostazioni del kiosk.
            </p>
          ) : null}
          <div className="flex flex-wrap justify-center gap-3">
            <KioskButton tone="ghost" onClick={() => window.location.reload()}>
              Riprova
            </KioskButton>
            {/* The staff's way to the settings (graphics quality) when the game never gets to its menu */}
            <KioskButton tone="ghost" onClick={() => window.location.assign(withBasePath("/kiosk/admin"))}>
              Impostazioni
            </KioskButton>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; note?: string }> = ({ label, value, note }) => (
  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
    <p className="font-f1-italic text-xs font-bold uppercase tracking-[0.25em] text-white/60">{label}</p>
    <p className="font-f1-mono text-3xl font-bold tabular-nums">{value}</p>
    {note ? <p className="font-f1-italic text-xs font-bold text-[#FFB300]">{note}</p> : null}
  </div>
);
