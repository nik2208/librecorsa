import { driverNameKey, type BoardPage } from "@/lib/net/board-client";
import type { LeaderboardEntry } from "@/lib/sim/lap-types";

/** Top places fetched: the top three before a gap, or a plain top when the player is in it */
export const TOP = 7;
export const NEAR = 2;

/** Heights the open tower is drawn at, unscaled (px): the cap, the foot and the list's padding; a row; a gap */
export const CHROME_PX = 44 + 32 + 10;
export const ROW_PX = 28;
export const GAP_PX = 20;

/** One place of the tower */
export type Line = { pos: number; entry: LeaderboardEntry; mine: boolean } | { gap: true; key: string };

/**
 * The tower's lines: the top three, a gap, two places either side of the player's; a plain top when they are near it.
 * Where the screen has no room for all of them (`rowsRoom`, in rows) the player's own row and the places next to it
 * stay first, then the leader, then the rest.
 */
export function towerLines(page: BoardPage, myKey: string, rowsRoom = 99): Line[] {
  const me = page.me;
  const isMine = (e: LeaderboardEntry) => myKey !== "" && driverNameKey(e.name) === myKey;
  const byPos = new Map<number, { pos: number; entry: LeaderboardEntry; mine: boolean }>();
  page.entries.forEach((entry, i) => byPos.set(page.offset + i + 1, { pos: page.offset + i + 1, entry, mine: isMine(entry) }));
  page.near?.entries.forEach((entry, i) => byPos.set(page.near!.pos + i, { pos: page.near!.pos + i, entry, mine: isMine(entry) }));
  const room = Math.max(1, rowsRoom);
  if (!me || me.pos <= 5 || !page.near) {
    const plain = Math.max(5, Math.min(TOP, (me?.pos ?? 0) + NEAR));
    const tops = [...byPos.values()].filter((l) => l.pos <= plain).sort((a, b) => a.pos - b.pos);
    if (tops.length <= room) return tops;
    // Short of room: the player's row stays, with the places above it first
    const keep = me ? tops.filter((l) => l.pos <= me.pos).slice(-room) : tops.slice(0, room);
    return keep.length ? keep : tops.slice(0, room);
  }
  const order = [me.pos, me.pos - 1, me.pos + 1, 1, me.pos - 2, me.pos + 2, 2, 3];
  const rowsFor = (set: number[]) => {
    const sorted = [...set].sort((a, b) => a - b);
    const gaps = sorted.filter((p, i) => i > 0 && p > sorted[i - 1] + 1).length;
    return sorted.length + (gaps * GAP_PX) / ROW_PX;
  };
  let chosen: number[] = [];
  for (const p of order) {
    if (!byPos.has(p) || chosen.includes(p)) continue;
    if (chosen.length > 0 && rowsFor([...chosen, p]) > room) break;
    chosen = [...chosen, p];
  }
  const sorted = chosen.sort((a, b) => a - b);
  const lines: Line[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p > sorted[i - 1] + 1) lines.push({ gap: true, key: `gap-${p}` });
    lines.push(byPos.get(p)!);
  });
  return lines;
}
