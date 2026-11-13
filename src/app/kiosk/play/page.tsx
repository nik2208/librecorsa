import type { Metadata } from "next";
import { KioskPlay } from "@/components/kiosk/KioskPlay";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Event branch: the kiosk, as on the home page (older links and bookmarks) */
export default function KioskPlayPage() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-[#07070c]">
      <KioskPlay />
    </main>
  );
}
