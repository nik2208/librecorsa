"use client";

/** Pieces shared by the kiosk's screens: the event header, buttons, the leaderboard, keyboards and pad input */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { withBasePath } from "@/lib/base-path";
import { BRAND_FILES, EVENT_BRAND } from "@/lib/kiosk/event-brand";
import { checkPin, rememberPin } from "@/lib/kiosk/kiosk-api";
import { formatLapTime } from "@/lib/kiosk/kiosk-score";
import { KIOSK_DIFFICULTIES, type KioskLeaderboard } from "@/lib/kiosk/kiosk-types";

export const RED = EVENT_BRAND.red;

/**
 * The official logo when it is in public/kiosk/brand/, else its name as a text placeholder. The text shows until the
 * picture has loaded (a static page's <img> can fail before React is there to see it, leaving a broken image)
 */
export const BrandMark: React.FC<{ kind: "sponsor" | "event"; className?: string; textClassName?: string }> = ({ kind, className, textClassName }) => {
  const src = withBasePath(kind === "sponsor" ? BRAND_FILES.sponsorLogo : BRAND_FILES.eventLogo);
  const text = kind === "sponsor" ? EVENT_BRAND.sponsor : EVENT_BRAND.eventShort;
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    const img = new Image();
    img.onload = () => live && setLoaded(true);
    img.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  if (!loaded) return <span className={textClassName}>{text}</span>;
  // eslint-disable-next-line @next/next/no-img-element -- a static export with no image optimiser
  return <img src={src} alt={text} className={className} draggable={false} />;
};

/** Sponsor × event, with the dates and the venue */
export const BrandHeader: React.FC<{ compact?: boolean }> = ({ compact }) => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
    <BrandMark kind="sponsor" className={compact ? "h-7 w-auto" : "h-10 w-auto"} textClassName={`font-f1-display font-black tracking-[0.18em] text-[#C7000B] ${compact ? "text-xl" : "text-3xl"}`} />
    <span className={`font-f1-display text-white/50 ${compact ? "text-lg" : "text-2xl"}`}>×</span>
    {/* The event's logo is taller than wide words: a little more height keeps its tagline readable */}
    <BrandMark kind="event" className={compact ? "h-10 w-auto" : "h-16 w-auto"} textClassName={`font-f1-display font-extrabold tracking-[0.08em] text-white ${compact ? "text-lg" : "text-2xl"}`} />
    {!compact ? (
      <span className="font-f1-italic text-sm font-bold uppercase tracking-[0.2em] text-white/60">
        {EVENT_BRAND.dates} · {EVENT_BRAND.venue}
      </span>
    ) : null}
  </div>
);

export const KioskButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "ghost" | "danger"; big?: boolean }
> = ({ tone = "primary", big, className = "", ...rest }) => {
  const toneClass =
    tone === "primary"
      ? "bg-[#C7000B] text-white hover:bg-[#E0000D] disabled:bg-[#5a1a1d] disabled:text-white/50 shadow-[0_10px_40px_rgba(199,0,11,0.45)]"
      : tone === "danger"
        ? "border border-[#FF3B30]/60 text-[#FF6B60] hover:bg-[#FF3B30]/15"
        : "border border-white/20 text-white hover:bg-white/10";
  return (
    <button
      type="button"
      {...rest}
      className={`rounded-xl font-f1-display font-extrabold uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed ${big ? "px-10 py-5 text-3xl" : "px-5 py-3 text-base"} ${toneClass} ${className}`}
    />
  );
};

/** The ranking, as the server sends it; `highlightId` marks the player's own row */
export const LeaderboardTable: React.FC<{
  board: KioskLeaderboard | null;
  highlightId?: string | null;
  /** Also marks this driver's row (the board keeps each driver's best, which may be an earlier session) */
  highlightName?: string | null;
  limit?: number;
  large?: boolean;
  emptyText?: string;
}> = ({
  board,
  highlightId,
  highlightName,
  limit = 10,
  large,
  emptyText = "Nessun tempo ancora: sii il primo!",
}) => {
  const rows = board?.rows.slice(0, limit) ?? [];
  const label = board?.mode === "total" ? `Tempo totale · ${board.laps} ${board.laps === 1 ? "giro" : "giri"}` : "Miglior giro";
  return (
    <div className="w-full">
      <div className={`mb-2 flex items-baseline justify-between font-f1-italic font-bold uppercase tracking-[0.2em] text-white/60 ${large ? "text-lg" : "text-xs"}`}>
        <span>Classifica</span>
        <span>{label}</span>
      </div>
      {rows.length === 0 ? (
        <div className={`rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center font-f1-italic text-white/70 ${large ? "text-2xl" : "text-base"}`}>{emptyText}</div>
      ) : (
        <ol className="flex flex-col gap-1">
          {rows.map((r) => {
            const mine =
              (highlightId !== undefined && highlightId !== null && r.id === highlightId) ||
              (!!highlightName && r.name.trim().toLowerCase() === highlightName.trim().toLowerCase());
            const time = board?.mode === "total" ? r.totalTimeMs : r.bestLapMs;
            return (
              <li
                key={r.id}
                className={`flex items-center gap-3 rounded-lg px-3 ${large ? "py-3 text-3xl" : "py-1.5 text-lg"} ${mine ? "bg-[#C7000B] text-white" : r.rank <= 3 ? "bg-white/10 text-white" : "bg-white/5 text-white/90"}`}
              >
                <span className={`w-12 shrink-0 text-center font-f1-mono font-bold ${r.rank === 1 && !mine ? "text-[#FFD34D]" : ""}`}>{r.rank}</span>
                <span className="min-w-0 flex-1 truncate font-f1-italic font-bold uppercase">{r.name}</span>
                {r.difficulty ? (
                  <span
                    title={KIOSK_DIFFICULTIES.find((d) => d.id === r.difficulty)?.label}
                    className={`shrink-0 rounded px-1.5 font-f1-mono text-[0.6em] font-bold leading-relaxed ${mine ? "bg-white/25 text-white" : "bg-white/10 text-white/70"}`}
                  >
                    {KIOSK_DIFFICULTIES.find((d) => d.id === r.difficulty)?.short}
                  </span>
                ) : null}
                <span className="shrink-0 font-f1-mono font-bold tabular-nums">
                  {formatLapTime(time)}
                  {board?.mode === "best" && r.bestLapPenalised ? <span className="ml-1 text-[0.6em] opacity-70">*</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {board && rows.some((r) => r.bestLapPenalised) && board.mode === "best" ? (
        <p className="mt-2 font-f1-italic text-xs text-white/50">* giro fuori dai limiti della pista, con penalità</p>
      ) : null}
      {rows.some((r) => r.difficulty) ? (
        <p className={`mt-1 font-f1-italic text-white/50 ${large ? "text-base" : "text-xs"}`}>
          Difficoltà: {KIOSK_DIFFICULTIES.map((d) => `${d.short} ${d.label.toLowerCase()}`).join(" · ")}
        </p>
      ) : null}
    </div>
  );
};

/**
 * Calls `onPress` for every pad or wheel button that goes down while `enabled` (buttons already held when it turns on
 * are ignored until released, so the press that led here does not count again)
 */
export function useGamepadPress(onPress: (button: number) => void, enabled: boolean): void {
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !navigator.getGamepads) return;
    let raf = 0;
    const held = new Map<number, boolean[]>();
    let first = true;
    const loop = () => {
      for (const pad of navigator.getGamepads()) {
        if (!pad) continue;
        const was = held.get(pad.index) ?? [];
        const now = pad.buttons.map((b) => b.pressed);
        if (!first) now.forEach((down, i) => down && !was[i] && onPressRef.current(i));
        held.set(pad.index, now);
      }
      first = false;
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [enabled]);
}

const KEY_ROWS = ["1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

/** A keyboard on the screen, for a touch screen with no keyboard */
export const OnScreenKeyboard: React.FC<{ onKey: (key: string) => void; onBackspace: () => void; disabled?: boolean }> = ({ onKey, onBackspace, disabled }) => (
  <div className="flex select-none flex-col items-center gap-1.5">
    {KEY_ROWS.map((row) => (
      <div key={row} className="flex gap-1.5">
        {row.split("").map((k) => (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => onKey(k)}
            className="h-12 w-12 rounded-lg border border-white/15 bg-white/10 font-f1-mono text-xl font-bold text-white active:bg-[#C7000B] disabled:opacity-40 sm:h-14 sm:w-14"
          >
            {k}
          </button>
        ))}
      </div>
    ))}
    <div className="flex gap-1.5">
      <button type="button" disabled={disabled} onClick={() => onKey(" ")} className="h-12 w-72 rounded-lg border border-white/15 bg-white/10 font-f1-italic text-base font-bold uppercase tracking-widest text-white active:bg-[#C7000B] disabled:opacity-40 sm:h-14">
        Spazio
      </button>
      <button type="button" disabled={disabled} onClick={onBackspace} className="h-12 w-28 rounded-lg border border-white/15 bg-white/10 font-f1-italic text-base font-bold uppercase text-white active:bg-[#C7000B] disabled:opacity-40 sm:h-14" aria-label="Cancella">
        ⌫
      </button>
    </div>
  </div>
);

/** The admin PIN, checked with the server; `onSuccess` runs once it is right (and remembered for this tab) */
export const PinDialog: React.FC<{ onSuccess: (pin: string) => void; onCancel?: () => void; title?: string }> = ({ onSuccess, onCancel, title = "PIN amministratore" }) => {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = useCallback(async () => {
    if (!pin || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await checkPin(pin)) {
        rememberPin(pin);
        onSuccess(pin);
      } else {
        setError("PIN errato");
        setPin("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore");
    } finally {
      setBusy(false);
    }
  }, [pin, busy, onSuccess]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) setPin((p) => (p + e.key).slice(0, 12));
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter") void submit();
      else if (e.key === "Escape") onCancel?.();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [submit, onCancel]);
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-[min(92vw,22rem)] rounded-2xl border border-white/15 bg-[#121218] p-6 text-white shadow-2xl">
        <h2 className="mb-4 text-center font-f1-display text-lg font-bold uppercase tracking-[0.15em]">{title}</h2>
        <div className="mb-4 h-14 rounded-lg border border-white/15 bg-black/40 text-center font-f1-mono text-4xl leading-[3.5rem] tracking-[0.4em]">{"•".repeat(pin.length) || " "}</div>
        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} type="button" onClick={() => setPin((p) => (p + d).slice(0, 12))} className="h-14 rounded-lg bg-white/10 font-f1-mono text-2xl font-bold active:bg-[#C7000B]">
              {d}
            </button>
          ))}
          <button type="button" onClick={() => setPin((p) => p.slice(0, -1))} className="h-14 rounded-lg bg-white/10 text-2xl active:bg-white/20" aria-label="Cancella">
            ⌫
          </button>
          <button type="button" onClick={() => setPin((p) => (p + "0").slice(0, 12))} className="h-14 rounded-lg bg-white/10 font-f1-mono text-2xl font-bold active:bg-[#C7000B]">
            0
          </button>
          <button type="button" onClick={() => void submit()} disabled={busy || !pin} className="h-14 rounded-lg bg-[#C7000B] font-f1-display text-lg font-bold disabled:opacity-50">
            OK
          </button>
        </div>
        {error ? <p className="mt-3 text-center font-f1-italic text-sm font-bold text-[#FF6B60]">{error}</p> : null}
        {onCancel ? (
          <button type="button" onClick={onCancel} className="mt-4 w-full rounded-lg border border-white/15 py-2 font-f1-italic text-sm uppercase tracking-widest text-white/70">
            Annulla
          </button>
        ) : null}
      </div>
    </div>
  );
};

/** Five quick taps (within 3 s) on a corner of the screen, or Ctrl+Shift+K: the staff's way out of the game */
export function useStaffGesture(onTrigger: () => void, enabled = true): () => void {
  const taps = useRef<number[]>([]);
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === "KeyK") {
        e.preventDefault();
        onTriggerRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
  return useCallback(() => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 3000), now];
    if (taps.current.length >= 5) {
      taps.current = [];
      onTriggerRef.current();
    }
  }, []);
}

/** Credits and provenance, for the staff (the admin page): the visitors' screens carry the event's brand only */
export const KioskCredits: React.FC<{ className?: string }> = ({ className = "" }) => (
  <p className={`font-f1-italic text-xs leading-snug text-white/50 ${className}`}>
    Motore di gioco: LibreCorsa di KhazP (MIT, github.com/KhazP/librecorsa) · Monza e Ferrari SF-26: modelli recuperati dalla
    storia del progetto LibreCorsa, senza licenza (vedi kiosk/README.md) · RISE Motordrome di Alp Yalay, CC BY-NC-SA 4.0 ·
    Monoposto 2026 di Qvist Designs, CC BY 4.0 · Evento non affiliato a Formula 1, FIA o Ferrari.
  </p>
);
