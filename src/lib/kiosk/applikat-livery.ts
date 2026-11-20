/**
 * Applikat's livery for the 2026 Prototype, the stand's own (applikat.it): the car in the studio's carbon black, its
 * wings in the site's ribbon red and its details in its cream, the cat and APPLIKAT on the sidepods, the nose and the
 * rear wing, applikat.it on the engine cover. It is the kiosk's livery while the sponsor's logo is off (kiosk-types.ts KIOSK_NEUTRAL_LIVERY_ID).
 *
 * The atlas (public/cars/f12026/liveries/applikat/decals.png, 2048 × 512) keeps the event atlas's layout
 * (event-livery.ts eventDecalsAt): A the cat badge from applikat.it (applikat_logo.jpeg, its dark ground made
 * transparent) beside APPLIKAT in Martian Mono ExtraBold at 75% width (the site's wordmark face, SIL OFL), over the
 * ribbon red; B applikat.it; C the number box.
 */

import type { LiveryConfig } from "@/types/f1";
import { eventDecalsAt } from "@/lib/kiosk/event-livery";

/** applikat.it's palette (its stylesheet: --carbon, --ink, --ribbon) */
export const APPLIKAT_COLORS = { carbon: "#0f0e0c", ink: "#efe9da", ribbon: "#ff4b2b" } as const;

export const APPLIKAT_LIVERY: LiveryConfig = {
  id: "applikat",
  name: "Applikat #26",
  team: "Applikat",
  // Carbon body, ribbon-red wings (cream on them reads, as on the site's ribbon), cream details
  primary: APPLIKAT_COLORS.carbon,
  secondary: APPLIKAT_COLORS.ribbon,
  accent: APPLIKAT_COLORS.ink,
  number: "26",
  decals: eventDecalsAt("/cars/f12026/liveries/applikat/decals.png"),
};
