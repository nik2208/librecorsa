"use client";

/**
 * Event branch: the badge the game shows in place of its own emblem (the HUD's lap timer, the full game's menus): a red
 * number board with the event's initials and year (as public/kiosk/event-mark.svg, the site's icon). When the staff hid
 * the event's logo (src/lib/kiosk/kiosk-logos.ts) it keeps the year only. It follows the logo list without asking for
 * it: the kiosk's own screens keep it read.
 */

import React, { useSyncExternalStore } from "react";
import { EVENT_BRAND } from "@/lib/kiosk/event-brand";
import { followLogos, getLogosSnapshot } from "@/lib/kiosk/kiosk-logos";

const BOARD = "M28 6H110Q122 6 122 18V98L98 122H18Q6 122 6 110V28Z";

export const EventMark: React.FC<{ className?: string }> = ({ className = "h-10 w-10" }) => {
  const logos = useSyncExternalStore(followLogos, getLogosSnapshot, () => null);
  const eventShown = logos?.find((l) => l.id === "mgw")?.enabled !== false;
  return (
    <svg
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={eventShown ? `${EVENT_BRAND.eventShort} ${EVENT_BRAND.year}` : EVENT_BRAND.year}
    >
      <path d={BOARD} fill={EVENT_BRAND.red} />
      <path d={BOARD} stroke="#FFFFFF" strokeOpacity="0.25" strokeWidth="3" />
      {eventShown ? (
        <>
          <text x="64" y="70" textAnchor="middle" fill="#FFFFFF" fontFamily="Arial, Helvetica, sans-serif" fontSize="44" fontWeight="900" fontStyle="italic">
            MGW
          </text>
          <text x="64" y="102" textAnchor="middle" fill="#FFFFFF" fillOpacity="0.85" fontFamily="Arial, Helvetica, sans-serif" fontSize="26" fontWeight="700" letterSpacing="4">
            {EVENT_BRAND.year}
          </text>
        </>
      ) : (
        <text x="64" y="80" textAnchor="middle" fill="#FFFFFF" fontFamily="Arial, Helvetica, sans-serif" fontSize="36" fontWeight="900" fontStyle="italic">
          {EVENT_BRAND.year}
        </text>
      )}
    </svg>
  );
};
