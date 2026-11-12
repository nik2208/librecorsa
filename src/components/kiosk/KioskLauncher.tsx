"use client";

/** What the kiosk opens on: the game for the visitors, or the admin's settings (behind the PIN) */

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Gamepad2, Settings, Trophy } from "lucide-react";
import { BrandHeader, KioskCredits, PinDialog } from "@/components/kiosk/kiosk-ui";
import { loadKioskConfig, storedPin } from "@/lib/kiosk/kiosk-api";
import { EVENT_BRAND } from "@/lib/kiosk/event-brand";
import { formatMinutes } from "@/lib/kiosk/kiosk-score";
import { KIOSK_CARS, KIOSK_TRACKS, runnableCarId, runnableTrackId, type KioskConfig } from "@/lib/kiosk/kiosk-types";
import { withBasePath } from "@/lib/base-path";

export const KioskLauncher: React.FC = () => {
  const [askPin, setAskPin] = useState(false);
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    void loadKioskConfig().then(({ config, source }) => {
      setConfig(config);
      setOnline(source === "server");
    });
  }, []);

  const goAdmin = () => {
    if (storedPin()) window.location.assign(withBasePath("/kiosk/admin"));
    else setAskPin(true);
  };

  const track = config ? runnableTrackId(config.trackId) : null;
  const car = config ? runnableCarId(config.carId) : null;
  const summary = config
    ? `${config.limitMode === "laps" ? `${config.laps} ${config.laps === 1 ? "giro" : "giri"}` : formatMinutes(config.minutes)} · ${KIOSK_TRACKS.find((t) => t.id === track)?.label ?? track}${car && car !== "vf26" ? ` · ${KIOSK_CARS.find((c) => c.id === car)?.label ?? car}` : ""}`
    : "…";

  return (
    <main className="flex min-h-dvh flex-col bg-[radial-gradient(ellipse_at_top_left,#3a0306_0%,#08090D_55%)] px-[max(1.25rem,env(safe-area-inset-left))] py-8 text-white">
      <BrandHeader />
      <h1 className="mt-8 font-f1-display text-4xl font-black uppercase tracking-[0.06em] sm:text-6xl">{EVENT_BRAND.challenge}</h1>
      <p className="mt-2 font-f1-italic text-lg font-bold uppercase tracking-[0.25em] text-white/60">Postazione kiosk · scegli la modalità</p>

      <div className="mt-10 grid flex-1 grid-cols-1 gap-6 md:grid-cols-2">
        <Link
          href="/kiosk/play"
          className="group flex flex-col justify-between rounded-3xl bg-[#C7000B] p-8 shadow-[0_20px_80px_rgba(199,0,11,0.45)] transition-transform hover:scale-[1.01] focus-visible:outline focus-visible:outline-4 focus-visible:outline-white"
        >
          <Gamepad2 className="h-20 w-20" aria-hidden />
          <div>
            <h2 className="font-f1-display text-5xl font-black uppercase tracking-[0.08em]">Gioca</h2>
            <p className="mt-2 font-f1-italic text-xl font-bold text-white/85">Modalità gara per i visitatori · {summary}</p>
          </div>
        </Link>
        <button
          type="button"
          onClick={goAdmin}
          className="flex flex-col justify-between rounded-3xl border-2 border-white/15 bg-white/5 p-8 text-left transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-4 focus-visible:outline-white"
        >
          <Settings className="h-20 w-20 text-white/80" aria-hidden />
          <div>
            <h2 className="font-f1-display text-5xl font-black uppercase tracking-[0.08em]">Admin / Config</h2>
            <p className="mt-2 font-f1-italic text-xl font-bold text-white/70">Giri o minuti, circuito, difficoltà, classifica · richiede PIN</p>
          </div>
        </button>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <Link href="/kiosk/classifica" className="inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-2 font-f1-italic font-bold uppercase tracking-[0.2em] text-white/80 hover:bg-white/10">
          <Trophy className="h-5 w-5" aria-hidden /> Classifica
        </Link>
        <span className={`font-f1-mono text-xs ${online === false ? "text-[#FFB300]" : "text-white/40"}`}>
          {online === null ? "server…" : online ? "server kiosk collegato" : "server kiosk non raggiungibile: config locale"}
        </span>
      </div>
      <KioskCredits className="mt-6" />

      {askPin ? <PinDialog onSuccess={() => window.location.assign(withBasePath("/kiosk/admin"))} onCancel={() => setAskPin(false)} /> : null}
    </main>
  );
};
