import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { withBasePath } from "@/lib/base-path";
import { buildIdFromEnv } from "@/lib/build-id";
import { EVENT_BRAND } from "@/lib/kiosk/event-brand";
import { REPO_URL, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

// Event branch: the kiosk's own name in the browser's title bar (no LibreCorsa on the stand's screens). Fixed at build,
// so no brand in it: the brands are the staff's choice while the kiosk runs (src/lib/kiosk/kiosk-logos.ts)
const EVENT_TITLE = EVENT_BRAND.challengeNeutral;

/*
 * The UI fonts ship with the app (Latin subsets, as Google Fonts serves them; SIL OFL 1.1, licences in ./fonts).
 * next/font/google fetched them at build time, and its Turbopack loader cannot take Google's newer
 * `/l/font?kit=…&skey=…` file URLs, so a build depended on what Google happened to return that day.
 */
// Racing Line type (docs/DESIGN.md §3): Geist for UI text, Geist Mono for labels and data,
// Chakra Petch (bold italic) for display. The wordmark is drawn as outlines (LibreCorsaLogo); Orbitron loads only for
// the event kiosk's trackside screens (below).
// Variable fonts: one file serves every weight
const geist = localFont({
  src: "./fonts/geist-variable.woff2",
  weight: "100 900",
  variable: "--font-geist",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-variable.woff2",
  weight: "100 900",
  variable: "--font-geist-mono",
  display: "swap",
});

const chakraPetch = localFont({
  src: [
    { path: "./fonts/chakra-petch-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/chakra-petch-600-italic.woff2", weight: "600", style: "italic" },
    { path: "./fonts/chakra-petch-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./fonts/chakra-petch-700-italic.woff2", weight: "700", style: "italic" },
  ],
  variable: "--font-chakra",
  display: "swap",
});

// Event branch: the trackside screens of the kiosk paint their headings in Orbitron (src/lib/kiosk/event-scene-branding.ts)
const orbitron = localFont({
  src: "./fonts/orbitron-variable.woff2",
  weight: "700 900",
  variable: "--font-orbitron",
  display: "swap",
});

const BUILD_ID = buildIdFromEnv();

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: EVENT_TITLE, template: `%s · ${EVENT_TITLE}` },
  description: SITE_DESCRIPTION,
  applicationName: EVENT_TITLE,
  keywords: [
    "sim racing",
    "racing simulator",
    "browser racing game",
    "free racing game",
    "open source racing game",
    "motorsport simulator",
    "formula car",
    "GT3",
    "force feedback",
    "WebGL",
  ],
  authors: [{ name: "KhazP", url: "https://github.com/KhazP" }],
  creator: "KhazP",
  category: "games",
  alternates: { canonical: "/" },
  // An event kiosk, not a public site
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: EVENT_TITLE,
    description: SITE_DESCRIPTION,
    locale: "en_US",
  },
  twitter: { card: "summary_large_image", title: EVENT_TITLE, description: SITE_DESCRIPTION },
  // The deployed build's commit (src/lib/build-id.ts), read from the page by the usage counter and the update check
  // rather than built into the game's script, so a deploy doesn't change the game's cached files
  ...(BUILD_ID ? { other: { "lc-build": BUILD_ID } } : {}),
  // Metadata URLs don't get a base path on their own
  // The SVG emblem draws its small version under 32 px; the PNG and ICO frames are for browsers without SVG icons
  icons: {
    icon: [{ url: withBasePath("/kiosk/event-mark.svg"), type: "image/svg+xml" }],
    apple: [{ url: withBasePath("/branding/apple-touch-icon.png"), sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  // ui-allow: hex-in-style the browser chrome's colour is metadata, which cannot read a CSS token (lc-void)
  themeColor: "#08090D",
  colorScheme: "dark",
  // Draw under the notch, Dynamic Island and home indicator: the scene runs edge to edge and the UI keeps
  // to the safe area by itself (.lc-safe-frame, env(safe-area-inset-*); docs/DESIGN.md §9)
  viewportFit: "cover",
};

// schema.org description of the game for search results
const jsonLd = {
  "@context": "https://schema.org",
  "@type": ["VideoGame", "WebApplication"],
  name: SITE_NAME,
  url: `${SITE_URL}/`,
  description: SITE_DESCRIPTION,
  image: `${SITE_URL}/opengraph-image.jpg`,
  applicationCategory: "GameApplication",
  genre: ["Racing", "Simulation", "Sim racing"],
  gamePlatform: "Web browser",
  operatingSystem: "Any (runs in a WebGL2 browser)",
  playMode: ["SinglePlayer", "MultiPlayer"],
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  license: "https://www.gnu.org/licenses/agpl-3.0.html",
  codeRepository: REPO_URL,
  sameAs: [REPO_URL],
  author: { "@type": "Person", name: "KhazP", url: "https://github.com/KhazP" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="it"
      className={`dark ${geist.variable} ${geistMono.variable} ${chakraPetch.variable} ${orbitron.variable}`}
    >
      <body className="bg-lc-void text-lc-chalk antialiased">
        {/* Event branch: no forward from "/" to /play (forward-to-game.ts): "/" is the kiosk, framed or installed too */}
        <script
          type="application/ld+json"
          // Static data, escaped so it can't close the script element
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />
        {children}
      </body>
    </html>
  );
}

