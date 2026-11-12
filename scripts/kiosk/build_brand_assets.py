#!/usr/bin/env python3
"""
Builds the kiosk's brand pictures in public/kiosk/brand/ from the sponsor's wordmark and, when given, the event's logo
(PNGs with transparency, any colour, any size), in the sizes src/lib/kiosk/event-brand.ts BRAND_FILES expects:

  huawei-logo.png     the wordmark in the brand red, for the kiosk's screens (header)
  banner-huawei.png   1024 x 128 trackside banner: the wordmark on white between red and black bands
  banner-combo.png    1024 x 128 trackside banner: the wordmark in white on red, with the event's logo (or name)
  mgw-logo.png        the event's logo in white, for the kiosk's screens (header)            [with the event logo]
  banner-mgw.png      1024 x 128 trackside banner: the event's logo, dates and venue on black  [with the event logo]

Without the event's logo the game draws its banner as text. The output folder is gitignored: brand artwork stays on
the machine unless someone chooses to commit it.

Run: python3 scripts/kiosk/build_brand_assets.py path/to/huawei-wordmark.png [path/to/mgw-logo.png]
(the official brand kits are the right inputs; the MGW 2026 logo is on milangamesweek.it as an SVG: rasterise it first,
e.g. with Inkscape or a browser)
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/kiosk/brand"
RED = (199, 0, 11, 255)
WHITE = (245, 245, 245, 255)
BLACK = (11, 11, 15, 255)
PAPER = (244, 244, 242, 255)
FONTS = [
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/Library/Fonts/Arial Bold.ttf",
]


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONTS:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    raise SystemExit("No bold TTF font found: add one to FONTS")


def tinted(mark: Image.Image, colour: tuple[int, int, int, int]) -> Image.Image:
    """The mark's shape (its alpha) filled with one colour"""
    alpha = mark.getchannel("A")
    out = Image.new("RGBA", mark.size, colour)
    out.putalpha(alpha)
    return out


def fit_height(mark: Image.Image, height: int, max_width: int) -> Image.Image:
    scale = min(height / mark.height, max_width / mark.width)
    return mark.resize((max(1, round(mark.width * scale)), max(1, round(mark.height * scale))), Image.LANCZOS)


def trimmed(path: str) -> Image.Image:
    """A picture cropped to what it draws (its alpha)"""
    im = Image.open(path).convert("RGBA")
    box = im.getchannel("A").getbbox()
    return im.crop(box) if box else im


def main() -> None:
    if len(sys.argv) not in (2, 3):
        raise SystemExit(__doc__)
    mark = trimmed(sys.argv[1])
    event = trimmed(sys.argv[2]) if len(sys.argv) == 3 else None
    OUT.mkdir(parents=True, exist_ok=True)

    # Header logo: the brand red, room around it
    logo = fit_height(tinted(mark, RED), 120, 1200)
    canvas = Image.new("RGBA", (logo.width + 24, logo.height + 24), (0, 0, 0, 0))
    canvas.alpha_composite(logo, (12, 12))
    canvas.save(OUT / "huawei-logo.png", optimize=True)

    # Sponsor banner: as the game's own placeholder, with the wordmark
    w, h = 1024, 128
    banner = Image.new("RGBA", (w, h), PAPER)
    d = ImageDraw.Draw(banner)
    for x in (0, w - 40):
        d.rectangle((x, 0, x + 39, h), fill=RED)
    d.rectangle((40, 0, 49, h), fill=BLACK)
    d.rectangle((w - 50, 0, w - 41, h), fill=BLACK)
    word = fit_height(tinted(mark, RED), 76, w - 220)
    banner.alpha_composite(word, ((w - word.width) // 2, (h - word.height) // 2))
    banner.convert("RGB").save(OUT / "banner-huawei.png", optimize=True)

    # Both together: the wordmark in white on red, then the event's logo (or its name)
    combo = Image.new("RGBA", (w, h), RED)
    d = ImageDraw.Draw(combo)
    d.rectangle((0, 10, w, 13), fill=WHITE)
    d.rectangle((0, h - 14, w, h - 11), fill=WHITE)
    word = fit_height(tinted(mark, WHITE), 48, 290)
    gap = 28
    times = "×"
    tf = font(44)
    l, t, r, b = d.textbbox((0, 0), times, font=tf)
    if event is not None:
        logo = fit_height(tinted(event, WHITE), 96, 300)
        x0 = (w - (word.width + gap + (r - l) + gap + logo.width)) // 2
        combo.alpha_composite(word, (x0, (h - word.height) // 2))
        d.text((x0 + word.width + gap - l, (h - (b - t)) // 2 - t), times, font=tf, fill=WHITE)
        combo.alpha_composite(logo, (x0 + word.width + gap + (r - l) + gap, (h - logo.height) // 2))
    else:
        text = "×  MILAN GAMES WEEK 2026"
        f = font(40)
        tw = d.textbbox((0, 0), text, font=f)[2]
        x0 = (w - (word.width + gap + tw)) // 2
        combo.alpha_composite(word, (x0, (h - word.height) // 2))
        l, t, r, b = d.textbbox((0, 0), text, font=f)
        d.text((x0 + word.width + gap - l, (h - (b - t)) // 2 - t), text, font=f, fill=WHITE)
    combo.convert("RGB").save(OUT / "banner-combo.png", optimize=True)
    written = ["huawei-logo.png", "banner-huawei.png", "banner-combo.png"]

    if event is not None:
        # Header logo: the event's own white logo, room around it
        logo = fit_height(tinted(event, WHITE), 200, 1200)
        canvas = Image.new("RGBA", (logo.width + 24, logo.height + 24), (0, 0, 0, 0))
        canvas.alpha_composite(logo, (12, 12))
        canvas.save(OUT / "mgw-logo.png", optimize=True)

        # Event banner: the logo on black between red bands, then the dates and the venue
        banner = Image.new("RGBA", (w, h), BLACK)
        d = ImageDraw.Draw(banner)
        for x in (0, w - 36):
            d.rectangle((x, 0, x + 35, h), fill=RED)
        d.rectangle((36, 0, 41, h), fill=WHITE)
        d.rectangle((w - 42, 0, w - 37, h), fill=WHITE)
        logo = fit_height(tinted(event, WHITE), 104, 260)
        lines = [("27–29 NOVEMBRE 2026", font(38), WHITE), ("FIERA MILANO RHO", font(30), (255, 59, 48, 255))]
        sizes = [d.textbbox((0, 0), txt, font=f) for txt, f, _ in lines]
        text_w = max(s[2] - s[0] for s in sizes)
        gap = 40
        x0 = (w - (logo.width + gap + text_w)) // 2
        banner.alpha_composite(logo, (x0, (h - logo.height) // 2))
        total_h = sum(s[3] - s[1] for s in sizes) + 10
        y = (h - total_h) // 2
        for (txt, f, colour), s in zip(lines, sizes):
            d.text((x0 + logo.width + gap - s[0], y - s[1]), txt, font=f, fill=colour)
            y += s[3] - s[1] + 10
        banner.convert("RGB").save(OUT / "banner-mgw.png", optimize=True)
        written += ["mgw-logo.png", "banner-mgw.png"]

    for name in written:
        print(f"wrote {(OUT / name).relative_to(ROOT)}")


if __name__ == "__main__":
    main()
