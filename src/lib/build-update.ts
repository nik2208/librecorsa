/**
 * Tells a game left open across a deploy that a newer build is out. A fresh load or a reload gets the deployed build
 * (the page is checked with the server each time), but a tab or an installed app that stays open keeps running the
 * build it loaded, for days if nobody reloads it. And going Back to the game takes its page from the browser's cache
 * without asking the server, so it can start an old build too.
 *
 * The deploy publishes /build.json (src/app/build.json/route.ts): its build's commit and online protocol. The game
 * reads it as it starts, every five minutes while it is in view, and when the tab comes back into view, back from
 * the back/forward cache or back online. Once the build there differs from the page's own, an update is ready: the
 * title and pause menus offer the reload (src/components/menu/UpdateReady.tsx), and the game reloads by itself only
 * where nothing can be lost (`autoReloadNow`). A local build has no build id and never checks.
 */
import { withBasePath } from "@/lib/base-path";
import { pageBuild } from "@/lib/build-id";
import { PROTOCOL_VERSION } from "@/lib/net/state-codec";

/** How often the open game asks while in view */
export const UPDATE_POLL_MS = 5 * 60_000;
/** The least time between two asks (a burst of tab switches asks once) */
export const UPDATE_MIN_GAP_MS = 30_000;
/** A page open this long that a newer build has passed is reloaded at the next safe moment, without asking */
export const STALE_PAGE_MS = 24 * 3_600_000;
/** The build an automatic reload was last made for: one try per build, so a server still sending the old page can't loop it */
const AUTO_RELOAD_KEY = "librecorsa.update-reload";

/** What /build.json says */
export interface BuildInfo {
  build: string;
  protocol: number | null;
}

export interface UpdateState {
  /** A build other than this page's is deployed */
  ready: boolean;
  /** That build ("" before one is seen) */
  latest: string;
  /** It speaks another online protocol: this page can't join its rooms and races any more */
  protocolChanged: boolean;
}

const NONE: UpdateState = { ready: false, latest: "", protocolChanged: false };

/** /build.json's answer, or null when it isn't one */
export function parseBuildInfo(raw: unknown): BuildInfo | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { build, protocol } = raw as Record<string, unknown>;
  if (typeof build !== "string" || build.length > 64) return null;
  return { build, protocol: typeof protocol === "number" && Number.isInteger(protocol) ? protocol : null };
}

/**
 * The update state for a page of build `running` speaking `protocol`, given what the server says. Any other build is
 * an update, newer or not: a rolled-back deploy is the one to run too. A server without a build id (a local build)
 * offers none.
 */
export function compareBuild(running: string, protocol: number, info: BuildInfo): UpdateState {
  if (!running || !info.build || info.build === running) return NONE;
  return { ready: true, latest: info.build, protocolChanged: info.protocol !== null && info.protocol !== protocol };
}

/**
 * Where the player is, for an automatic reload: `loading` is the loading screen, `idle` the title screen with nothing
 * open (no Settings, room lobby or race entry), `busy` anything else (driving, paused, setup, a circuit loading for a
 * room).
 */
export type UpdateMoment = "loading" | "idle" | "busy";

export interface AutoReloadInput {
  moment: UpdateMoment;
  update: UpdateState;
  /** The page's first loading screen, before the player has started: nothing has happened yet */
  boot: boolean;
  /** How long this page has been open (ms) */
  pageAgeMs: number;
  /** The tab is out of view */
  hidden: boolean;
  /** A text field has the focus (a half-typed request) */
  typing: boolean;
  /** The build an automatic reload was last made for, if any */
  triedFor: string | null;
}

/**
 * Whether to reload now without asking. Only where a reload loses nothing and nobody is looking at a menu that
 * disappears: on the page's first loading screen (an old page brought back by Back is caught there), or on the idle
 * title screen while the tab is out of view, and there only for a page open over a day or one that can no longer play
 * online. Never once driving, paused, in a lobby or in Settings, and once per build at most.
 */
export function autoReloadNow(o: AutoReloadInput): boolean {
  if (!o.update.ready || !o.update.latest || o.triedFor === o.update.latest) return false;
  if (o.moment === "loading") return o.boot;
  if (o.moment !== "idle" || !o.hidden || o.typing) return false;
  return o.update.protocolChanged || o.pageAgeMs >= STALE_PAGE_MS;
}

// --- The page's state, shared by the menus ---

let state: UpdateState = NONE;
const listeners = new Set<() => void>();

function setState(next: UpdateState): void {
  if (next.ready === state.ready && next.latest === state.latest && next.protocolChanged === state.protocolChanged) return;
  state = next;
  for (const listener of listeners) listener();
}

/** For useSyncExternalStore */
export const updateStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: (): UpdateState => state,
  getServerSnapshot: (): UpdateState => NONE,
};

let lastAskMs = -Infinity;
let asking: Promise<UpdateState> | null = null;

/** Asks the server for its build (at most once per `UPDATE_MIN_GAP_MS` unless `force`); resolves to the new state */
export function checkForUpdate(force = false): Promise<UpdateState> {
  const running = pageBuild();
  if (!running || typeof fetch === "undefined") return Promise.resolve(state);
  if (asking) return asking;
  const now = Date.now();
  if (!force && now - lastAskMs < UPDATE_MIN_GAP_MS) return Promise.resolve(state);
  lastAskMs = now;
  asking = (async () => {
    try {
      const res = await fetch(withBasePath("/build.json"), { cache: "no-store" });
      if (res.ok) {
        const info = parseBuildInfo(await res.json());
        if (info) setState(compareBuild(running, PROTOCOL_VERSION, info));
      }
    } catch {
      // Offline, or the request was cut off: asked again on the next turn
    }
    return state;
  })().finally(() => {
    asking = null;
  });
  return asking;
}

let watchers = 0;
let stopWatch: (() => void) | null = null;

/** Starts the checks (once per page, however many callers); the returned function stops this caller's share */
export function watchForUpdates(): () => void {
  if (typeof window === "undefined" || !pageBuild()) return () => {};
  watchers++;
  if (!stopWatch) {
    const inView = () => document.visibilityState === "visible";
    const timer = window.setInterval(() => {
      if (inView()) void checkForUpdate();
    }, UPDATE_POLL_MS);
    const onVisibility = () => {
      if (inView()) void checkForUpdate();
    };
    // Back from the back/forward cache: the page may be days old
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void checkForUpdate(true);
    };
    const onOnline = () => void checkForUpdate();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    void checkForUpdate(true);
    stopWatch = () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
    };
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    if (--watchers === 0) {
      stopWatch?.();
      stopWatch = null;
    }
  };
}

/** The player's Reload: loads the page again, on the newest build */
export function reloadForUpdate(): void {
  window.location.reload();
}

/** The build an automatic reload was last made for in this tab */
export function autoReloadTriedFor(): string | null {
  try {
    return sessionStorage.getItem(AUTO_RELOAD_KEY);
  } catch {
    return null;
  }
}

/** An automatic reload: noted first, so it is tried once per build */
export function autoReload(latest: string): void {
  try {
    sessionStorage.setItem(AUTO_RELOAD_KEY, latest);
  } catch {
    // Without storage the reload can't be told apart from a loop: not made
    return;
  }
  window.location.reload();
}

/** How long this page has been open (ms), on the wall clock: a computer asleep in between counts */
export function pageAgeMs(): number {
  return Date.now() - performance.timeOrigin;
}
