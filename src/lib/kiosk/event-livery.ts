/**
 * The event livery for the 2026 Prototype: the sponsor's red with black and white, its name on the sidepods, nose and
 * rear wing, the event's on the engine cover. The decals sit where the Oracle Red Bull livery's do (track-data.ts).
 *
 * The atlas (public/cars/f12026/liveries/huawei_mgw/decals.png) holds text placeholders made by
 * scripts/kiosk/build_event_livery.py: replace it with the official artwork, each picture inside its rectangle.
 */

import type { LiveryConfig, LiveryDecalSet } from "@/types/f1";
import { EVENT_BRAND } from "@/lib/kiosk/event-brand";

/** Atlas rectangles (x, y, width, height, 0-1 from the top left) */
const SPONSOR = [0, 0, 0.53711, 0.58594] as const;
const EVENT = [0, 0.625, 0.53711, 0.375] as const;
const NUMBER = [0.54688, 0, 0.125, 0.5] as const;

/** Height for a width, keeping the rectangle's proportions in the 2048 × 512 atlas */
const tall = (rect: readonly [number, number, number, number], width: number): number => width / ((rect[2] * 2048) / (rect[3] * 512));

const EVENT_DECALS: LiveryDecalSet = {
  atlas: "/cars/f12026/liveries/huawei_mgw/decals.png",
  decals: [
    // The sponsor along each sidepod
    { rect: SPONSOR, face: "left", centre: [0.62, 0.5, -0.08], size: [0.62, tall(SPONSOR, 0.62)], depth: 0.15 },
    { rect: SPONSOR, face: "right", centre: [-0.62, 0.5, -0.08], size: [0.62, tall(SPONSOR, 0.62)], depth: 0.15 },
    // The event on each side of the engine cover
    { rect: EVENT, face: "left", centre: [0.31, 0.62, -0.98], size: [0.5, tall(EVENT, 0.5)], depth: 0.12 },
    { rect: EVENT, face: "right", centre: [-0.31, 0.62, -0.98], size: [0.5, tall(EVENT, 0.5)], depth: 0.12 },
    // The nose: the sponsor on each side, the number on top
    { rect: SPONSOR, face: "left", centre: [0.12, 0.44, 2.05], size: [0.3, tall(SPONSOR, 0.3)], depth: 0.1 },
    { rect: SPONSOR, face: "right", centre: [-0.12, 0.44, 2.05], size: [0.3, tall(SPONSOR, 0.3)], depth: 0.1 },
    { rect: NUMBER, face: "top", centre: [0, 0.56, 1.72], size: [0.17, tall(NUMBER, 0.17)], rotDeg: -90, depth: 0.1 },
    // The sponsor across the rear wing's main plane
    { rect: SPONSOR, face: "top", centre: [0, 0.8, -2.18], size: [0.7, tall(SPONSOR, 0.7)], depth: 0.07 },
  ],
};

export const EVENT_LIVERY: LiveryConfig = {
  id: "huawei_mgw",
  name: "Milan Games Week #26",
  team: EVENT_BRAND.sponsor,
  primary: EVENT_BRAND.red,
  secondary: "#111114",
  accent: "#f5f5f5",
  number: "26",
  decals: EVENT_DECALS,
};
