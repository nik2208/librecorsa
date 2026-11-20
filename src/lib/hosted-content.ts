/**
 * What a copy of the game can list. The repository carries only RISE Motordrome and the 2026 prototype car (its
 * body, liveries and sound in `public/cars/f12026/`); every other car and circuit lives on librecorsa.org
 * only, in the librecorsa-assets R2 bucket, which `cloudflare/worker.js` serves from the same paths. So a clone lists
 * just what it has, and the deploy (`.github/workflows/deploy-pages.yml`) sets `NEXT_PUBLIC_HOSTED_CONTENT=1` to list
 * everything. Set it in `.env.local` too if you have the hosted files in `public/` (they are gitignored).
 */
export const HOSTED_CONTENT = process.env.NEXT_PUBLIC_HOSTED_CONTENT === "1";

/**
 * Event branch: Monza, restored from the repository's history (commit 7b009d9) and committed on this branch for the
 * kiosk. Listed unless NEXT_PUBLIC_EXTRA_CONTENT names a narrower set ("" = none), whatever NEXT_PUBLIC_HOSTED_CONTENT
 * says: the hosted bucket doesn't have it. (The Ferrari SF-26 restored with it is gone: the event can't use it.)
 */
export const EXTRA_CONTENT_KNOWN: ReadonlySet<string> = new Set(["monza"]);
export const EXTRA_CONTENT_IDS: ReadonlySet<string> = new Set(
  (process.env.NEXT_PUBLIC_EXTRA_CONTENT ?? "monza")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => EXTRA_CONTENT_KNOWN.has(id))
);

/**
 * Event branch: the kiosk's extra cars, which a kiosk build fetches from librecorsa.org and dresses for the event before
 * `next build` (scripts/kiosk/fetch-kiosk-cars.mjs, run as `prebuild`; they are not in the repository). next.config.ts
 * names the ones that came out complete, so a build without them (offline, or Pages) doesn't list them.
 */
export const KIOSK_FETCHED_CAR_IDS: ReadonlySet<string> = new Set(
  (process.env.NEXT_PUBLIC_KIOSK_FETCHED_CARS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

/** The cars in the repository: both drive the 2026 prototype's body and sound */
export const REPO_CAR_IDS: ReadonlySet<string> = new Set(["lc26"]);

/** The circuits in the repository */
export const REPO_TRACK_IDS: ReadonlySet<string> = new Set(["rwanda_official_short", "rwanda_official"]);

/** Whether this copy lists a car */
export const carListed = (id: string): boolean =>
  KIOSK_FETCHED_CAR_IDS.has(id) || (EXTRA_CONTENT_KNOWN.has(id) ? EXTRA_CONTENT_IDS.has(id) : HOSTED_CONTENT || REPO_CAR_IDS.has(id));

/** Whether this copy lists a circuit */
export const trackListed = (id: string): boolean =>
  EXTRA_CONTENT_KNOWN.has(id) ? EXTRA_CONTENT_IDS.has(id) : HOSTED_CONTENT || REPO_TRACK_IDS.has(id);
