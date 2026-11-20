import type { MetadataRoute } from "next";
import { withBasePath } from "@/lib/base-path";
import { EVENT_BRAND } from "@/lib/kiosk/event-brand";
import { SITE_DESCRIPTION } from "@/lib/site";

export const dynamic = "force-static";

/** The icons come from `npm run brand` (scripts/build-brand.ts) */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // Event branch: an install opens the kiosk, under its name (no brand: they are the staff's choice at run time)
    id: withBasePath("/"),
    name: EVENT_BRAND.challengeNeutral,
    short_name: EVENT_BRAND.challengeNeutral,
    description: SITE_DESCRIPTION,
    lang: "it",
    dir: "ltr",
    start_url: withBasePath("/"),
    scope: withBasePath("/"),
    display: "fullscreen",
    orientation: "landscape",
    // ui-allow: hex-in-style the browser reads the manifest, which cannot hold a CSS token (lc-void)
    background_color: "#08090D",
    // ui-allow: hex-in-style as above
    theme_color: "#08090D",
    categories: ["games", "sports"],
    prefer_related_applications: false,
    icons: [{ src: withBasePath("/kiosk/event-mark.svg"), sizes: "any", type: "image/svg+xml" }],
  };
}
