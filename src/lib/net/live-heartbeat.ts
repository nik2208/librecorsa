/**
 * The game's side of the live count (cloudflare/api/presence.ts): while the game's page is in view, an empty
 * heartbeat goes to POST <api>/live once a minute; while it is hidden, none. No body, no id, no cookie: the server
 * counts the last minute's heartbeats and keeps nothing else. Only sent when the online side says the count is on.
 */
import { useEffect } from "react";
import { onlineUrl, watchOnlineConfig } from "./online-config";

/** One heartbeat a minute per tab in view: the server counts a minute's worth */
export const HEARTBEAT_MS = 60_000;

/** When this page last sent one: a tab never sends two within the minute, however often it is shown and hidden */
let lastSentMs = Number.NEGATIVE_INFINITY;

/**
 * When the next heartbeat is due (ms from now), or null while the page is hidden. Kept apart from the timers so the
 * rule can be checked on its own: in view, one at once unless one went out in the last minute, then one a minute.
 */
export function nextHeartbeatInMs(visible: boolean, nowMs: number, lastMs: number): number | null {
  if (!visible) return null;
  return Math.max(0, lastMs + HEARTBEAT_MS - nowMs);
}

function send(url: string): void {
  lastSentMs = Date.now();
  void fetch(url, { method: "POST", credentials: "omit", cache: "no-store" }).catch(() => {
    // Not counted this minute, and nothing to tell the player
  });
}

/** Sends the heartbeats for as long as the calling component (the game's page) is mounted */
export function useLiveHeartbeat(): void {
  useEffect(() => {
    const url = onlineUrl("/live");
    if (!url) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let on = false;
    let live = true;
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (!on || !live) return;
      const wait = nextHeartbeatInMs(document.visibilityState !== "hidden", Date.now(), lastSentMs);
      if (wait === null) return;
      timer = setTimeout(() => {
        timer = null;
        if (document.visibilityState === "hidden") return;
        send(url);
        schedule();
      }, wait);
    };
    // Followed, not asked once: a server out of reach at start is counted once it answers
    const unwatch = watchOnlineConfig((online) => {
      on = online.config.live;
      schedule();
    });
    document.addEventListener("visibilitychange", schedule);
    return () => {
      live = false;
      unwatch();
      document.removeEventListener("visibilitychange", schedule);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
}
