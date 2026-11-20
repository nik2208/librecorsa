import type { NextConfig } from "next";

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");

// Other machines on the LAN testing `next dev` (e.g. NEXT_DEV_ORIGINS=192.168.1.196): Next blocks their dev requests otherwise
const devOrigins = (process.env.NEXT_DEV_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);

// A git worktree's node_modules live in the main checkout, outside the folder Turbopack takes as its root: name the
// main checkout here (NEXT_TURBOPACK_ROOT=/path/to/librecorsa) to build or run a worktree with Turbopack
const turbopackRoot = process.env.NEXT_TURBOPACK_ROOT;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(turbopackRoot ? { turbopack: { root: turbopackRoot } } : {}),
  env: {
    // Event branch: always defined, so a normal build compiles the kiosk's test hooks out (src/components/kiosk)
    NEXT_PUBLIC_KIOSK_TEST_HOOKS: process.env.NEXT_PUBLIC_KIOSK_TEST_HOOKS === "1" ? "1" : "0",
  },
  ...(devOrigins.length ? { allowedDevOrigins: devOrigins } : {}),
  output: "export",
  images: {
    unoptimized: true,
  },
  ...(basePath
    ? {
        basePath,
        assetPrefix: `${basePath}/`,
      }
    : {}),
};

export default nextConfig;

