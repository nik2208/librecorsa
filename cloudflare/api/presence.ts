/**
 * The live count: how many tabs have the game (/play) open and in view right now. Each such tab sends an empty
 * heartbeat once a minute (POST /api/live, src/lib/net/live-heartbeat.ts), and stops while it is hidden. One object
 * counts them all:
 *   POST  a heartbeat           -> 204
 *   GET   the count             -> { live }
 *
 * A tab beats once a minute, so the heartbeats of the last minute are the tabs in view. Only the arrival times of
 * those heartbeats are kept, in memory: no address, no id, nothing from the request, and nothing written to storage.
 * The Worker limits how often one address may beat (LIVE_LIMIT) before a heartbeat gets here.
 *
 * An idle object can be put to sleep after about ten seconds, and its memory goes with it; a pending timer keeps it
 * awake. So while any heartbeat is still within the minute, a timer runs until it has passed, and with heartbeats
 * arriving at least once a minute the object stays in memory. With nobody left, the timer ends and the object may
 * sleep: it has nothing left to remember.
 */
import type { DurableObjectState, Env } from "./types";

/** Each tab in view beats once in this long (ms): the heartbeats of the last such window are the tabs */
export const LIVE_WINDOW_MS = 60_000;
/** More heartbeats than this in a minute are not kept (memory stays bounded whatever arrives) */
const MAX_BEATS = 200_000;

export class PresenceCounter {
  /** Arrival times (ms) of the heartbeats within the window, oldest first */
  private beats: number[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    _state: DurableObjectState,
    _env: Env,
    /** Replaced in tests */
    private readonly now: () => number = Date.now,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method === "POST") {
      this.beat();
      return new Response(null, { status: 204 });
    }
    if (request.method === "GET") return Response.json({ live: this.count() });
    return new Response("Method not allowed", { status: 405 });
  }

  /** One heartbeat, now */
  beat(): void {
    this.prune();
    if (this.beats.length < MAX_BEATS) this.beats.push(this.now());
    this.keepAwake();
  }

  /** Tabs in view: the heartbeats of the last window */
  count(): number {
    this.prune();
    return this.beats.length;
  }

  private prune(): void {
    const from = this.now() - LIVE_WINDOW_MS;
    let i = 0;
    while (i < this.beats.length && this.beats[i] <= from) i++;
    if (i > 0) this.beats.splice(0, i);
  }

  /** Until the last heartbeat has left the window, a timer keeps the object (and so the count) in memory */
  private keepAwake(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.prune();
      if (this.beats.length > 0) this.keepAwake();
    }, LIVE_WINDOW_MS + 1_000);
  }

  /** Stops the timer (tests) */
  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
