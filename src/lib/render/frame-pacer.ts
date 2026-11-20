/**
 * The frame-rate cap (Settings > Display > Graphics > Frame rate): which animation frames draw the scene.
 *
 * Time-based, so a 120 Hz screen gets 30 fps too, not 60: a frame draws once a cap interval has passed since the last
 * draw was due. The browser's frame timestamps jitter by a millisecond or two, so a frame that comes up to
 * TOLERANCE_MS early still draws (a strict `>= 33.33` skips the 60 Hz frame stamped 33.32 and drops to 20 fps). The
 * next draw is due one interval after this one was due rather than after it happened, so a screen whose rate is not
 * a multiple of the cap (144 Hz) still averages the cap; a draw that came late by more than the tolerance (a missed
 * vsync, a stall) restarts the schedule from itself, so no two frames are drawn back to back to catch up.
 *
 * Only the drawing is skipped: input, the simulation, the network and the lap timing still run on every frame.
 */

/** How early a frame may come and still draw (ms): under half a frame of the fastest common screens (144 Hz: 6.9 ms) */
export const TOLERANCE_MS = 4;

export class FramePacer {
  /** When the last drawn frame was due (ms, the frame clock); -Infinity before the first */
  private dueMs = -Infinity;

  /** `capFps`: frames drawn per second at most; 0 = every frame */
  constructor(private capFps = 0) {}

  get cap(): number {
    return this.capFps;
  }

  /** A new cap applies from the next frame (the first frame after it always draws) */
  setCap(capFps: number): void {
    if (capFps === this.capFps) return;
    this.capFps = capFps;
    this.dueMs = -Infinity;
  }

  /** Whether the frame stamped `nowMs` draws */
  shouldDraw(nowMs: number): boolean {
    if (!(this.capFps > 0)) return true;
    const intervalMs = 1000 / this.capFps;
    const sinceDueMs = nowMs - this.dueMs;
    if (sinceDueMs < intervalMs - TOLERANCE_MS) return false;
    const nextDueMs = this.dueMs + intervalMs;
    // On time (within the tolerance either side): keep the schedule; late or the first frame: start it from here
    this.dueMs = Math.abs(nowMs - nextDueMs) <= TOLERANCE_MS ? nextDueMs : nowMs;
    return true;
  }
}
