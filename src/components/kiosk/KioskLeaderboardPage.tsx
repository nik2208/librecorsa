"use client";

/** The public leaderboard, for a second screen at the stand or a phone on the same network (refreshes by itself) */

import React, { useEffect, useState } from "react";
import { BrandHeader, LeaderboardTable } from "@/components/kiosk/kiosk-ui";
import { fetchLeaderboard, loadKioskConfig } from "@/lib/kiosk/kiosk-api";
import { EVENT_BRAND } from "@/lib/kiosk/event-brand";
import { KIOSK_CARS, KIOSK_TRACKS, rankingModeFor, runnableCarId, runnableTrackId, type KioskLeaderboard } from "@/lib/kiosk/kiosk-types";

const REFRESH_MS = 10_000;

export const KioskLeaderboardPage: React.FC = () => {
  const [board, setBoard] = useState<KioskLeaderboard | null>(null);
  const [error, setError] = useState(false);
  const [subtitle, setSubtitle] = useState("");
  // Opened from the kiosk's settings (no address bar there): a way back. A second screen opened on it has no history
  const [canGoBack, setCanGoBack] = useState(false);
  useEffect(() => setCanGoBack(window.history.length > 1), []);

  useEffect(() => {
    let live = true;
    const limit = Number(new URLSearchParams(window.location.search).get("limit")) || 15;
    const load = async () => {
      try {
        const { config: raw } = await loadKioskConfig();
        const config = { ...raw, trackId: runnableTrackId(raw.trackId), carId: runnableCarId(raw.carId) };
        const next = await fetchLeaderboard({ mode: rankingModeFor(config), trackId: config.trackId, carId: config.carId, laps: config.laps, limit });
        if (!live) return;
        setBoard(next);
        setError(false);
        const track = KIOSK_TRACKS.find((t) => t.id === config.trackId)?.label ?? config.trackId;
        const car = ` · ${KIOSK_CARS.find((c) => c.id === config.carId)?.label ?? config.carId}`;
        setSubtitle(config.limitMode === "laps" ? `${config.laps} ${config.laps === 1 ? "giro" : "giri"} · tempo totale · ${track}${car}` : `Miglior giro · ${track}${car}`);
      } catch {
        if (live) setError(true);
      }
    };
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <main className="kiosk-ui flex min-h-dvh flex-col bg-[radial-gradient(ellipse_at_top,#3a0306_0%,#08090D_60%)] px-[max(1.25rem,env(safe-area-inset-left))] py-8 text-white">
      <BrandHeader />
      <h1 className="mt-6 font-f1-display text-4xl font-black uppercase tracking-[0.06em] sm:text-6xl">{EVENT_BRAND.challenge}</h1>
      <p className="mt-1 font-f1-italic text-xl font-bold uppercase tracking-[0.25em] text-[#FF3B30]">{subtitle || "Classifica"}</p>
      <div className="mt-8 w-full max-w-5xl">
        <LeaderboardTable board={board} limit={board?.rows.length ?? 15} large emptyText={error ? "Classifica non disponibile" : undefined} />
      </div>
      {canGoBack ? (
        <button
          type="button"
          onClick={() => window.history.back()}
          className="mt-auto self-start rounded-full border border-white/15 px-4 py-2 font-f1-italic text-xs font-bold uppercase tracking-[0.2em] text-white/50 hover:bg-white/10"
        >
          ← Indietro
        </button>
      ) : null}
    </main>
  );
};
