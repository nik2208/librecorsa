import type { Metadata } from "next";
import { KioskPlay } from "@/components/kiosk/KioskPlay";

export const metadata: Metadata = {
  title: "Gioca",
  robots: { index: false, follow: false },
};

/** Event branch: the game in kiosk mode (name, start, a session to the admin's limit, the leaderboard) */
export default function KioskPlayPage() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-[#07070c]">
      <KioskPlay />
    </main>
  );
}
