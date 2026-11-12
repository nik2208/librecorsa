import type { Metadata } from "next";
import { KioskLauncher } from "@/components/kiosk/KioskLauncher";

export const metadata: Metadata = {
  title: "Kiosk",
  robots: { index: false, follow: false },
};

/** Event branch: the kiosk opens here (kiosk/server.mjs sends "/" here) and picks the game or the admin page */
export default function KioskPage() {
  return <KioskLauncher />;
}
