/**
 * Which builds each day's sessions ran on, for the owner's page (Dashboard.tsx).
 *
 * Usage is counted per UTC day, so a day with a deploy always splits between the build before it and the new one, and
 * neither is behind on that day: the old one was live until the deploy. A build counts as replaced on a day only when
 * a newer build was first seen on an earlier day, that is when it still gets sessions the day after a deploy, or later.
 * A build seen on a sliver of its first day's sessions (under 1%: a stray or made-up report) is not taken as a deploy.
 */
export interface BuildUse {
  day: string;
  build: string;
  sessions: number;
}

export interface BuildOnDay {
  build: string;
  sessions: number;
  /** The day the build was first reported */
  firstSeen: string;
  /** A newer build was first seen on a day before this one */
  replaced: boolean;
}

export interface BuildDay {
  day: string;
  /** Sessions that sent a build */
  total: number;
  /** Most sessions first */
  builds: BuildOnDay[];
  /** Sessions on builds replaced before this day */
  replaced: number;
  /** Builds first reported this day */
  fresh: string[];
}

/** A newer build must carry this share of its first day's sessions to count as a deploy */
export const DEPLOY_SHARE = 0.01;

/**
 * The day each build was first reported. The API sends its sessions that day and that day's sessions on any build, so
 * a first day before the range is judged as one inside it; without them the range's own rows are read
 */
export interface BuildFirstSeen {
  build: string;
  day: string;
  sessions?: number;
  dayTotal?: number;
}

export function buildDays(perDay: BuildUse[], firstSeen: BuildFirstSeen[], days: string[]): BuildDay[] {
  const first = new Map(firstSeen.map((b) => [b.build, b.day]));
  const dayTotal = new Map<string, number>();
  for (const r of perDay) dayTotal.set(r.day, (dayTotal.get(r.day) ?? 0) + r.sessions);
  // The days a deploy was first seen: a build whose first day's share is not known (that day out of the range and no
  // share sent with it) counts, as its first day is out of sight
  const deployDays = new Set<string>();
  for (const b of firstSeen) {
    const onDay = perDay.find((r) => r.build === b.build && r.day === b.day);
    const sessions = b.sessions ?? onDay?.sessions;
    const total = b.dayTotal ?? (onDay ? dayTotal.get(b.day) : undefined);
    if (sessions === undefined || total === undefined || sessions >= DEPLOY_SHARE * total) deployDays.add(b.day);
  }
  const sortedDeploys = [...deployDays].sort();

  return days.map((day) => {
    // The last deploy before this day: a build first seen before it had been replaced by the time this day began
    const lastDeployBefore = sortedDeploys.filter((d) => d < day).pop() ?? null;
    const builds = perDay
      .filter((r) => r.day === day)
      .sort((a, b) => b.sessions - a.sessions)
      .map((r) => {
        const seen = first.get(r.build) ?? day;
        return { build: r.build, sessions: r.sessions, firstSeen: seen, replaced: lastDeployBefore !== null && seen < lastDeployBefore };
      });
    return {
      day,
      total: builds.reduce((n, b) => n + b.sessions, 0),
      builds,
      replaced: builds.filter((b) => b.replaced).reduce((n, b) => n + b.sessions, 0),
      fresh: builds.filter((b) => b.firstSeen === day).map((b) => b.build),
    };
  });
}
