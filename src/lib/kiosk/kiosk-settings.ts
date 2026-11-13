/**
 * What the kiosk lays over the settings saved in its browser (KioskMode.settings): the level the player picked, the
 * device and graphics quality the staff set in the admin page (a USB controller by default), and the event's car
 * setup. The wheel's own bindings and calibration stay as saved in this browser.
 */

import type { PlayerSettings } from "@/lib/settings/player-settings";
import type { AssistPreset } from "@/types/f1";
import { KIOSK_LIVERY_ID, type KioskConfig } from "@/lib/kiosk/kiosk-types";

export function kioskSettingsFor(config: KioskConfig, difficulty: AssistPreset = config.difficulty): (own: PlayerSettings) => PlayerSettings {
  return (own) => ({
    ...own,
    device: config.device,
    graphics: { ...own.graphics, quality: config.graphics },
    assistPreset: difficulty,
    // No tyre wear or fuel to manage, milder rain (and the weather is dry anyway)
    realism: "casual",
    // Shifting is one thing too many for most visitors; the hardest level leaves it as the staff set it
    autoGearbox: difficulty === "pro" ? own.autoGearbox : true,
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
