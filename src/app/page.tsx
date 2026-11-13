import { KioskPlay } from "@/components/kiosk/KioskPlay";

/**
 * Event branch: the site opens straight on the kiosk (the menu with GIOCA, the leaderboard and the staff's settings),
 * whatever serves it: kiosk/server.mjs, a static host or `next dev`. The full game is still at /play for the staff.
 */
export default function KioskHomePage() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-[#07070c]">
      <KioskPlay />
    </main>
  );
}
