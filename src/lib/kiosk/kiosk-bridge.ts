/**
 * How the kiosk pages drive the simulator (LibreCorsaSimulator's `kiosk` prop): the kiosk hands it settings to drive
 * with and screens to draw over the game; the simulator hands back what is happening on track and the few things the
 * kiosk may do (send a player out, hold the car, bring it back).
 */

import type { ReactNode } from "react";
import type { AppPhase } from "@/lib/drive-session";
import type { LapSummaryData } from "@/lib/sim/lap-types";
import type { PlayerSettings } from "@/lib/settings/player-settings";
import type { CarTelemetry } from "@/types/f1";

export interface KioskMode {
  /** The car every session drives (the kiosk remounts the game for another) */
  carId: string;
  /**
   * Laid over the settings saved in this browser (the controls the staff set up in the full game). Kiosk mode never
   * saves settings back, so what it changes lasts for this page only.
   */
  settings: (own: PlayerSettings) => PlayerSettings;
  /** The kiosk's screens, drawn over the game */
  render: (api: KioskSimApi) => ReactNode;
}

export interface KioskSimApi {
  /** The circuit actually loaded: the config's, or the default when its files could not be loaded */
  trackId: string;
  phase: AppPhase;
  /** The circuit has loaded and the car waits on the grid for a player */
  ready: boolean;
  /** The car is frozen: the pause button, a lost wheel, or the kiosk holding it */
  paused: boolean;
  /** Why the game paused by itself (a wheel unplugged), if it did */
  pauseNotice: string | null;
  telemetry: CarTelemetry;
  /** Out on track from the grid under this name. Call it inside the click or key handler: it unlocks the sound */
  start: (name: string) => void;
  /** Freezes or releases the car (the countdown, the end of a session, the pause screen's resume) */
  setFrozen: (frozen: boolean) => void;
  /** Off the track and back to the grid, waiting for the next player */
  stop: () => void;
  /** Each lap completed on track (valid or not); returns the unsubscribe */
  onLap: (listener: (lap: LapSummaryData) => void) => () => void;
  unlockAudio: () => void;
}
