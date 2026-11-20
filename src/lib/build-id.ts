/**
 * The deployed build: the first seven digits of its commit. The deploy workflow sets NEXT_PUBLIC_BUILD; a local build
 * has none, and gets "".
 *
 * Only the page's HTML and /build.json carry it (the lc-build meta tag in src/app/layout.tsx, and
 * src/app/build.json/route.ts). The game reads it back from the page with `pageBuild()` rather than having it built
 * into its scripts, so a deploy that changes no code leaves the game's cached files as they were.
 */
export function buildIdFromEnv(): string {
  return (process.env.NEXT_PUBLIC_BUILD || "").slice(0, 7);
}

/** The build this page was served as, from its lc-build meta tag; "" in a local build or outside a browser */
export function pageBuild(): string {
  if (typeof document === "undefined") return "";
  return document.querySelector('meta[name="lc-build"]')?.getAttribute("content") ?? "";
}
