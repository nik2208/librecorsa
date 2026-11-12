/**
 * What the kiosk lays over the settings saved in its browser (KioskMode.settings). The staff set the controls, wheel
 * and graphics once in the full game (/play); every session on the kiosk then drives with those, plus these.
 */

import type { PlayerSettings } from "@/lib/settings/player-settings";
import { KIOSK_LIVERY_ID, type KioskConfig } from "@/lib/kiosk/kiosk-types";

export function kioskSettingsFor(config: KioskConfig): (own: PlayerSettings) => PlayerSettings {
  return (own) => ({
    ...own,
    assistPreset: config.difficulty,
    // No tyre wear or fuel to manage, milder rain (and the weather is dry anyway)
    realism: "casual",
    // Shifting is one thing too many for most visitors; the hardest level leaves it as the staff set it
    autoGearbox: config.difficulty === "pro" ? own.autoGearbox : true,
    racingLine: config.racingLine,
    // Everyone shares this browser's personal best: no ghost or delta to it
    ghost: false,
    liveryId: KIOSK_LIVERY_ID,
    mouseSteer: false,
    conditions: { ...own.conditions, weather: "clear", weatherNodes: undefined, timeScale: 0 },
    // Controls a visitor must not reach: the autopilot (it would set lap times), mute, replays, the flying restart and
    // mouse steering. Restart stays: it puts a stuck car back on the grid (the lap in progress is lost)
    keys: { ...own.keys, autopilot: [], mute: [], replay: [], flyingLap: [], mouseSteer: [] },
    padButtons: { ...own.padButtons, flyingLap: null },
    // The lap card has buttons (save a ghost file …) a visitor has no use for; the kiosk shows its own lap times
    hud: { ...own.hud, lapSummary: false, deltaBar: false },
  });
}
