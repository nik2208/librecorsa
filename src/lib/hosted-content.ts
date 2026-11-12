/**
 * What a copy of the game can list. The repository carries only RISE Motordrome and the 2026 prototype car (its
 * body, liveries and sound in `public/cars/f12026/`); every other car and circuit lives on librecorsa.org
 * only, in the librecorsa-assets R2 bucket, which `cloudflare/worker.js` serves from the same paths. So a clone lists
 * just what it has, and the deploy (`.github/workflows/deploy-pages.yml`) sets `NEXT_PUBLIC_HOSTED_CONTENT=1` to list
 * everything. Set it in `.env.local` too if you have the hosted files in `public/` (they are gitignored).
 */
export const HOSTED_CONTENT = process.env.NEXT_PUBLIC_HOSTED_CONTENT === "1";

/**
 * Event branch: extras whose files are put in `public/` by hand (scripts/kiosk/restore-extra-content.mjs; gitignored),
 * listed only when NEXT_PUBLIC_EXTRA_CONTENT names them ("sf26,monza"), whatever NEXT_PUBLIC_HOSTED_CONTENT says: the
 * hosted bucket doesn't have them, and the deploy, the verify suites and the thumbnail script all set that one
 */
export const EXTRA_CONTENT_KNOWN: ReadonlySet<string> = new Set(["sf26", "monza"]);
export const EXTRA_CONTENT_IDS: ReadonlySet<string> = new Set(
  (process.env.NEXT_PUBLIC_EXTRA_CONTENT ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => EXTRA_CONTENT_KNOWN.has(id))
);

/** The cars in the repository: both drive the 2026 prototype's body and sound */
export const REPO_CAR_IDS: ReadonlySet<string> = new Set(["vf26"]);

/** The circuits in the repository */
export const REPO_TRACK_IDS: ReadonlySet<string> = new Set(["rwanda_official_short", "rwanda_official"]);

/** Whether this copy lists a car */
export const carListed = (id: string): boolean =>
  EXTRA_CONTENT_KNOWN.has(id) ? EXTRA_CONTENT_IDS.has(id) : HOSTED_CONTENT || REPO_CAR_IDS.has(id);

/** Whether this copy lists a circuit */
export const trackListed = (id: string): boolean =>
  EXTRA_CONTENT_KNOWN.has(id) ? EXTRA_CONTENT_IDS.has(id) : HOSTED_CONTENT || REPO_TRACK_IDS.has(id);
