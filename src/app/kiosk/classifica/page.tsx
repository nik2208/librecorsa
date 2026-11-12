import type { Metadata } from "next";
import { KioskLeaderboardPage } from "@/components/kiosk/KioskLeaderboardPage";

export const metadata: Metadata = {
  title: "Classifica",
  robots: { index: false, follow: false },
};

/** Event branch: the public leaderboard, for a second screen (the data: GET /api/kiosk/leaderboard) */
export default function KioskLeaderboardRoute() {
  return <KioskLeaderboardPage />;
}
