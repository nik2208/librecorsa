"use client";

/** The public leaderboard, for a second screen at the stand or a phone on the same network (refreshes by itself) */

import React, { useEffect, useState } from "react";
import { BrandHeader, KioskCredits, LeaderboardTable } from "@/components/kiosk/kiosk-ui";
import { fetchLeaderboard, loadKioskConfig } from "@/lib/kiosk/kiosk-api";
import { EVENT_BRAND } from "@/lib/kiosk/event-brand";
import { KIOSK_TRACKS, rankingModeFor, type KioskLeaderboard } from "@/lib/kiosk/kiosk-types";

const REFRESH_MS = 10_000;

export const KioskLeaderboardPage: React.FC = () => {
  const [board, setBoard] = useState<KioskLeaderboard | null>(null);
  const [error, setError] = useState(false);
  const [subtitle, setSubtitle] = useState("");

  useEffect(() => {
    let live = true;
    const limit = Number(new URLSearchParams(window.location.search).get("limit")) || 15;
    const load = async () => {
      try {
        const { config } = await loadKioskConfig();
        const next = await fetchLeaderboard({ mode: rankingModeFor(config), trackId: config.trackId, laps: config.laps, limit });
        if (!live) return;
        setBoard(next);
        setError(false);
        const track = KIOSK_TRACKS.find((t) => t.id === config.trackId)?.label ?? config.trackId;
        setSubtitle(config.limitMode === "laps" ? `${config.laps} giri · tempo totale · ${track}` : `Miglior giro · ${track}`);
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
    <main className="flex min-h-dvh flex-col bg-[radial-gradient(ellipse_at_top,#3a0306_0%,#08090D_60%)] px-[max(1.25rem,env(safe-area-inset-left))] py-8 text-white">
      <BrandHeader />
      <h1 className="mt-6 font-f1-display text-4xl font-black uppercase tracking-[0.06em] sm:text-6xl">{EVENT_BRAND.challenge}</h1>
      <p className="mt-1 font-f1-italic text-xl font-bold uppercase tracking-[0.25em] text-[#FF3B30]">{subtitle || "Classifica"}</p>
      <div className="mt-8 w-full max-w-5xl">
        <LeaderboardTable board={board} limit={board?.rows.length ?? 15} large emptyText={error ? "Classifica non disponibile" : undefined} />
      </div>
      <div className="mt-auto pt-8">
        <KioskCredits />
      </div>
    </main>
  );
};
