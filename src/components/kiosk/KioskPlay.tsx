"use client";

/**
 * The kiosk (the site's home page on the event branch): reads the admin's config, then runs the circuit it names with
 * the kiosk's screens over it: the menu, the player's name and level, the session and its result
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TrackGate } from "@/components/TrackGate";
import { KioskOverlay } from "@/components/kiosk/KioskOverlay";
import { BrandHeader, useKioskLogos } from "@/components/kiosk/kiosk-ui";
import { sponsorShown } from "@/lib/kiosk/kiosk-logos";
import { flushResultQueue, loadKioskConfig, type ConfigSource } from "@/lib/kiosk/kiosk-api";
import { kioskSettingsFor } from "@/lib/kiosk/kiosk-settings";
import { runnableCarId, runnableTrackId, type KioskConfig } from "@/lib/kiosk/kiosk-types";
import type { KioskMode } from "@/lib/kiosk/kiosk-bridge";
import type { AssistPreset } from "@/types/f1";
import { withBasePath } from "@/lib/base-path";

/** Results still waiting in this browser (the server was down) are sent again this often */
const QUEUE_RETRY_MS = 60_000;

export const KioskPlay: React.FC = () => {
  const [state, setState] = useState<{ config: KioskConfig; source: ConfigSource } | null>(null);
  // The level the player picked on the start screen (each player starts from the admin's)
  const [difficulty, setDifficulty] = useState<AssistPreset | null>(null);

  const refresh = useCallback(() => {
    void loadKioskConfig().then((next) =>
      // The same config keeps its object, so the game does not apply its settings again for nothing
      setState((prev) => (prev && prev.source === next.source && JSON.stringify(prev.config) === JSON.stringify(next.config) ? prev : next))
    );
  }, []);

  useEffect(() => {
    refresh();
    void flushResultQueue();
    const id = window.setInterval(() => void flushResultQueue(), QUEUE_RETRY_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const staffExit = useCallback(() => window.location.assign(withBasePath("/kiosk/admin")), []);

  // A config naming what this build doesn't list (Monza left out, or the SF-26 of an earlier version) runs the defaults
  const config = useMemo(
    () => (state ? { ...state.config, trackId: runnableTrackId(state.config.trackId), carId: runnableCarId(state.config.carId) } : undefined),
    [state]
  );
  const source = state?.source ?? "default";
  const level = difficulty ?? config?.difficulty;
  // The sponsor's livery only while its logo is on (it changes on the car mid-race, as the boards do)
  const eventLivery = sponsorShown(useKioskLogos());
  const settings = useMemo(() => (config ? kioskSettingsFor(config, level, eventLivery) : undefined), [config, level, eventLivery]);
  const kiosk = useMemo<KioskMode | undefined>(
    () =>
      config && settings
        ? {
            carId: config.carId,
            settings,
            render: (api) => (
              <KioskOverlay
                api={api}
                config={config}
                configSource={source}
                difficulty={level ?? config.difficulty}
                onDifficulty={setDifficulty}
                onRefreshConfig={refresh}
                onStaffExit={staffExit}
              />
            ),
          }
        : undefined,
    [config, settings, source, level, refresh, staffExit]
  );

  if (!config || !kiosk) return <KioskBoot />;
  // Another car remounts the game on it (the circuit reloads), so nothing of the last car's session carries over
  return <TrackGate key={config.carId} kiosk={kiosk} trackId={config.trackId} />;
};

const KioskBoot: React.FC = () => (
  <div className="kiosk-ui flex h-screen w-screen flex-col items-center justify-center gap-6 bg-[radial-gradient(ellipse_at_top_left,#3a0306_0%,#08090D_60%)] px-6 text-white">
    <BrandHeader />
    <p className="font-f1-italic text-lg font-bold uppercase tracking-[0.3em] text-white/60">Caricamento…</p>
  </div>
);
