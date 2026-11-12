import type { Metadata } from "next";
import { KioskAdmin } from "@/components/kiosk/KioskAdmin";

export const metadata: Metadata = {
  title: "Admin kiosk",
  robots: { index: false, follow: false },
};

/** Event branch: the kiosk's config (laps or minutes, circuit, difficulty) and its results, behind the admin PIN */
export default function KioskAdminPage() {
  return <KioskAdmin />;
}
