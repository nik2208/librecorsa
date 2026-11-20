import type { MetadataRoute } from "next";
import { withBasePath } from "@/lib/base-path";
import { EVENT_BRAND } from "@/lib/kiosk/event-brand";
import { SITE_DESCRIPTION } from "@/lib/site";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // Event branch: an install opens the kiosk, under its name (no brand: they are the staff's choice at run time)
    name: EVENT_BRAND.challengeNeutral,
    short_name: EVENT_BRAND.challengeNeutral,
    description: SITE_DESCRIPTION,
    start_url: withBasePath("/"),
    scope: withBasePath("/"),
    display: "fullscreen",
    orientation: "landscape",
    background_color: "#08090D",
    theme_color: "#08090D",
    categories: ["games", "sports"],
    icons: [{ src: withBasePath("/kiosk/event-mark.svg"), sizes: "any", type: "image/svg+xml" }],
  };
}
