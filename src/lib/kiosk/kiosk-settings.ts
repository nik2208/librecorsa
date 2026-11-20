/**
 * What the kiosk lays over the settings saved in its browser (KioskMode.settings): the level the player picked, the
 * device and graphics quality the staff set in the admin page (a USB controller by default), and the event's car
 * setup. The wheel's own bindings and calibration stay as saved in this browser.
 */

import { MUSIC_TRACK_IDS } from "@/lib/audio/music-catalog";
import type { PlayerSettings } from "@/lib/settings/player-settings";
import type { AssistPreset } from "@/types/f1";
import { KIOSK_LIVERY_ID, KIOSK_NEUTRAL_LIVERY_ID, type KioskConfig } from "@/lib/kiosk/kiosk-types";

/** `eventLivery`: the sponsor's livery (its logo is on, src/lib/kiosk/kiosk-logos.ts sponsorShown), else the game's own */
export function kioskSettingsFor(
  config: KioskConfig,
  difficulty: AssistPreset = config.difficulty,
  eventLivery = false
): (own: PlayerSettings) => PlayerSettings {
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
    liveryId: eventLivery ? KIOSK_LIVERY_ID : KIOSK_NEUTRAL_LIVERY_ID,
    mouseSteer: false,
    // Tilt steering as the staff set it, never as this browser's full game saved it (both ways: the kiosk never saves);
    // only with the controller
    dualSense: {
      ...own.dualSense,
      gyroSteer: config.device === "controller" && config.gyroSteer,
      gyroLockDeg: config.gyroLockDeg,
      gyroSensitivity: config.gyroSensitivity,
    },
    // No soundtrack on the stand (upstream's music player, with its English "now playing" card): every track off, so
    // none loads or is announced; the car, the tyres and the kerbs still sound
    audio: { ...own.audio, musicMuted: true, musicOff: [...MUSIC_TRACK_IDS], menuMusic: 0, raceMusic: 0, replayMusic: 0 },
    conditions: { ...own.conditions, weather: "clear", weatherNodes: undefined, timeScale: 0 },
    // Controls a visitor must not reach: the autopilot (it would set lap times), mute, replays, the flying restart and
    // mouse steering. Restart stays: it puts a stuck car back on the grid (the lap in progress is lost)
    // Upstream's newer keys too: the MFD (O), the HUD layouts (H), the online board (J) and the next music track (K)
    keys: { ...own.keys, autopilot: [], mute: [], replay: [], flyingLap: [], mouseSteer: [], mfdPage: [], mfd: [], hud: [], board: [], nextTrack: [] },
    // Nor the MFD (its dials change the assists of the level picked), hiding the HUD or the online board
    padButtons: { ...own.padButtons, flyingLap: null, mfd: null, mfdPage: null, hud: null, board: null },
    // The lap card has buttons (save a ghost file …) a visitor has no use for; the kiosk shows its own lap times
    hud: { ...own.hud, lapSummary: false, deltaBar: false, boardWidget: "closed" },
    // Nothing goes to the online boards from the stand (there are none offline: belt and braces)
    profile: { ...own.profile, autoUpload: false },
  });
}
