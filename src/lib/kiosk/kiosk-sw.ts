/**
 * The kiosk keeps no service worker. Its files are on the PC (the distro serves them), so upstream's asset cache
 * (public/sw.js) brings it nothing, and a worker the browser's profile kept from an earlier build, after an ISO update,
 * could hand the new build's first page old circuit or car files. On the kiosk's page every worker of this origin is
 * unregistered and the game's caches ("librecorsa-…", the old worker's and the new one's) are deleted; a page a worker
 * still controlled loads once more, so nothing of the old build stays in it.
 */

const RELOADED_KEY = "kiosk.sw.cleared";

export async function dropServiceWorker(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("librecorsa-")).map((n) => caches.delete(n)));
    }
    if (!navigator.serviceWorker.controller) return;
    let reload = false;
    try {
      // Once per tab: a page that keeps a controller after this (a browser quirk) must not reload in a loop
      reload = sessionStorage.getItem(RELOADED_KEY) !== "1";
      sessionStorage.setItem(RELOADED_KEY, "1");
    } catch {
      reload = false;
    }
    if (reload) window.location.reload();
  } catch (err) {
    console.warn("[kiosk] service worker not cleared", err);
  }
}
