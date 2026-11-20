import type { Metadata } from "next";
import { AdminStats } from "./AdminStats";

// The owner's numbers. Not linked from anywhere, not in the sitemap and not indexed; the title and the page say nothing
// until the key opens it. The page holds no data: it asks the online side with the key (cloudflare/api/admin.ts),
// which answers no one else
export const metadata: Metadata = {
  title: { absolute: "LibreCorsa" },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function AdminPage() {
  return <AdminStats />;
}
