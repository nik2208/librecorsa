"use client";

/** The kiosk's game page: reads the admin's config, then runs the circuit it names with the kiosk's screens over it */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TrackGate } from "@/components/TrackGate";
import { KioskOverlay } from "@/components/kiosk/KioskOverlay";
import { BrandHeader } from "@/components/kiosk/kiosk-ui";
import { flushResultQueue, loadKioskConfig, type ConfigSource } from "@/lib/kiosk/kiosk-api";
import { kioskSettingsFor } from "@/lib/kiosk/kiosk-settings";
import type { KioskConfig } from "@/lib/kiosk/kiosk-types";
import type { KioskMode } from "@/lib/kiosk/kiosk-bridge";
import { withBasePath } from "@/lib/base-path";

/** Results still waiting in this browser (the server was down) are sent again this often */
const QUEUE_RETRY_MS = 60_000;

export const KioskPlay: React.FC = () => {
  const [state, setState] = useState<{ config: KioskConfig; source: ConfigSource } | null>(null);

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

  const config = state?.config;
  const source = state?.source ?? "default";
  const settings = useMemo(() => (config ? kioskSettingsFor(config) : undefined), [config]);
  const kiosk = useMemo<KioskMode | undefined>(
    () =>
      config && settings
        ? {
            settings,
            render: (api) => <KioskOverlay api={api} config={config} configSource={source} onRefreshConfig={refresh} onStaffExit={staffExit} />,
          }
        : undefined,
    [config, settings, source, refresh, staffExit]
  );

  if (!config || !kiosk) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-6 bg-[#08090D] px-6 text-white">
        <BrandHeader />
        <p className="font-f1-italic text-lg font-bold uppercase tracking-[0.3em] text-white/60">Caricamento…</p>
      </div>
    );
  }
  return <TrackGate kiosk={kiosk} trackId={config.trackId} />;
};
