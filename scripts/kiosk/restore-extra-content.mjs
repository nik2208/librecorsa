#!/usr/bin/env node
/**
 * Restores, from this repository's own git history, two pieces of content upstream removed on 2026-11-12:
 *
 *   sf26   the Ferrari SF-26 body and sound bank  → public/cars/sf26/
 *   monza  the Monza circuit (model + track data)  → public/tracks/monza/
 *
 * The files are written to public/ UNTRACKED: those folders are gitignored, so they are never committed (or pushed)
 * again. The game lists them only in a build made with NEXT_PUBLIC_EXTRA_CONTENT naming them (src/lib/hosted-content.ts).
 *
 * WARNING (read kiosk/README.md, "Contenuti extra"): upstream removed these because the SF-26 body was ripped from an
 * F1 video game and the Monza model from "Ripped" Assetto Corsa conversions on Sketchfab. Using them at a commercial
 * event exposes you and the brand you work for. The default build does not include them.
 *
 * Usage:
 *   node scripts/kiosk/restore-extra-content.mjs [sf26] [monza] [--force]
 *   echo "NEXT_PUBLIC_EXTRA_CONTENT=sf26,monza" >> .env.local && npm run build
 *
 * Needs the full git history (a shallow clone: git fetch --unshallow).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** The last commit that still had the files in the repository (the parent of 0f1992c, which moved them to R2) */
const SOURCE = "7b009d905790e277cd6bc926a549b862907e49f3";
const SETS = {
  sf26: { label: "Ferrari SF-26", paths: ["public/cars/sf26"] },
  monza: { label: "Monza", paths: ["public/tracks/monza"] },
};

const git = (args, opts = {}) => execFileSync("git", args, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024, ...opts });

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const wanted = argv.filter((a) => !a.startsWith("--"));
const ids = wanted.length > 0 ? wanted : Object.keys(SETS);
for (const id of ids) {
  if (!SETS[id]) {
    console.error(`Unknown content "${id}" (known: ${Object.keys(SETS).join(", ")})`);
    process.exit(1);
  }
}

try {
  git(["cat-file", "-e", `${SOURCE}^{commit}`], { stdio: "ignore" });
} catch {
  console.error(`Commit ${SOURCE.slice(0, 7)} is not in this clone. Fetch the full history first: git fetch --unshallow (or git fetch origin)`);
  process.exit(1);
}

let written = 0;
let skipped = 0;
for (const id of ids) {
  const set = SETS[id];
  const files = set.paths.flatMap((p) =>
    git(["ls-tree", "-r", "-z", "--name-only", SOURCE, "--", p], { encoding: "utf8" })
      .split("\0")
      .filter(Boolean)
  );
  if (files.length === 0) {
    console.error(`${set.label}: no files at ${SOURCE.slice(0, 7)}`);
    process.exit(1);
  }
  // Never put these where git would track them
  for (const p of set.paths) {
    try {
      git(["check-ignore", "-q", join(p, "probe")], { stdio: "ignore" });
    } catch {
      console.error(`${p} is not gitignored: refusing to restore it where it could be committed`);
      process.exit(1);
    }
  }
  let bytes = 0;
  for (const file of files) {
    const dest = join(ROOT, file);
    const size = Number(git(["cat-file", "-s", `${SOURCE}:${file}`], { encoding: "utf8" }).trim());
    if (!force && existsSync(dest) && statSync(dest).size === size) {
      skipped++;
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, git(["cat-file", "blob", `${SOURCE}:${file}`]));
    bytes += size;
    written++;
  }
  console.log(`${set.label}: ${files.length} files in ${set.paths.join(", ")} (${(bytes / 1048576).toFixed(1)} MB written)`);
}
console.log(`${written} written, ${skipped} already there. Build with NEXT_PUBLIC_EXTRA_CONTENT=${ids.join(",")} to list them.`);
