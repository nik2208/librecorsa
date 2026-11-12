/**
 * The event's branding: Milan Games Week & Cartoomics 2026 (Fiera Milano Rho, 27–29 November 2026), for Huawei.
 *
 * Everything drawn from here is a TEXT PLACEHOLDER in the brand colours: no logo is recreated. Drop the official
 * artwork into public/kiosk/brand/ under the names in `BRAND_FILES` (see public/kiosk/brand/README.md) and it is used
 * in place of the placeholder, on the trackside banners and screens, the car and the kiosk's screens.
 */

export const EVENT_BRAND = {
  sponsor: "HUAWEI",
  event: "MILAN GAMES WEEK & CARTOOMICS",
  eventShort: "MILAN GAMES WEEK",
  year: "2026",
  dates: "27–29 NOVEMBRE 2026",
  datesShort: "27–29 NOV 2026",
  venue: "FIERA MILANO RHO",
  /** The kiosk's game, as the screens name it */
  challenge: "HUAWEI RACING CHALLENGE",
  /** Brand colours (the sponsor's red, with black and white) */
  red: "#C7000B",
  redDark: "#8E0008",
  black: "#0B0B0F",
  white: "#F5F5F5",
} as const;

/** Official artwork, when present (public/kiosk/brand/); each falls back to a drawn text placeholder */
export const BRAND_FILES = {
  /** Sponsor logo for the kiosk screens (transparent PNG, any size, landscape) */
  sponsorLogo: "/kiosk/brand/huawei-logo.png",
  /** Event logo for the kiosk screens (transparent PNG, landscape) */
  eventLogo: "/kiosk/brand/mgw-logo.png",
  /** Trackside banners, 1024 × 128 (8:1): sponsor, event, and both together */
  bannerSponsor: "/kiosk/brand/banner-huawei.png",
  bannerEvent: "/kiosk/brand/banner-mgw.png",
  bannerCombo: "/kiosk/brand/banner-combo.png",
  /** The circuit's big screens, 512 × 288 (16:9); without it they show the kiosk's leaderboard */
  screen: "/kiosk/brand/screen.png",
} as const;

/** Set NEXT_PUBLIC_EVENT_BRANDING=0 to build without the event's dressing on the circuit */
export const EVENT_BRANDING_ON = process.env.NEXT_PUBLIC_EVENT_BRANDING !== "0";
