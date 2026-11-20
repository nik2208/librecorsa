import { withBasePath } from "@/lib/base-path";

/**
 * Production builds register public/sw.js, which keeps the circuits, cars and sounds a player downloads and serves
 * them again once the server says they are current. Development never caches (and drops a worker a preview build may
 * have left on this origin).
 */
export function registerAssetCache(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") {
    void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()));
    return;
  }
  // One address for every build: the browser installs a new worker only when sw.js itself changes, and the kept files
  // stay through any deploy (they are checked against the server, never tied to a build). The worker takes over the
  // page as it activates, so what this visit downloads after that is kept for the next one
  navigator.serviceWorker
    .register(withBasePath("/sw.js"), { scope: withBasePath("/") })
    .catch((err) => console.warn("Asset cache not available", err));
}
