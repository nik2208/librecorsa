import { buildIdFromEnv } from "@/lib/build-id";
import { PROTOCOL_VERSION } from "@/lib/net/state-codec";

export const dynamic = "force-static";

/**
 * /build.json: what an open game asks to learn that a newer build is out (src/lib/build-update.ts). The deployed
 * build's commit, as in the page's lc-build meta tag ("" in a local build, where nothing is checked), and the online
 * protocol it speaks, so a page that can no longer race online knows it.
 */
export function GET() {
  return Response.json({ build: buildIdFromEnv(), protocol: PROTOCOL_VERSION });
}
