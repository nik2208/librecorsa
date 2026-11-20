/** Classes and formatting shared by the press page and its coverage list */

/** A content card on the page: carbon, a white 7 % hairline (the kit's `Card` surface) */
export const CARD = "rounded-lc-card border border-white/7 bg-lc-carbon/80";
/** A card that is one link: the edge lights under the pointer, the volt edge and halo under the cursor */
export const CARD_LINK = `${CARD} group no-underline transition-[border-color,box-shadow] duration-200 ease-lc hover:border-lc-keyline focus-visible:border-lc-volt focus-visible:shadow-lc-focus focus-visible:outline-none`;
/** The icon at a card link's corner, lit under the pointer */
export const CARD_ICON = "shrink-0 text-lc-slate transition-colors duration-200 group-hover:text-lc-chalk";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 2026-11-09 → 9 Nov 2026 (the same on every machine, unlike toLocaleDateString) */
export const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

const LANGUAGES = new Intl.DisplayNames(["en"], { type: "language" });
/** "it" → "Italian" */
export const language = (code: string) => LANGUAGES.of(code) ?? code.toUpperCase();
