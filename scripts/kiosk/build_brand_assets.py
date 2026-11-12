#!/usr/bin/env python3
"""
Builds the kiosk's brand pictures in public/kiosk/brand/ from the sponsor's wordmark (a PNG with transparency, any
colour, any size), in the sizes src/lib/kiosk/event-brand.ts BRAND_FILES expects:

  huawei-logo.png     the wordmark in the brand red, for the kiosk's screens (header)
  banner-huawei.png   1024 x 128 trackside banner: the wordmark on white between red and black bands
  banner-combo.png    1024 x 128 trackside banner: the wordmark in white on red, with the event's name

The event's own banner (banner-mgw.png) is left to the event's official artwork: without it the game draws its text.
The output folder is gitignored: brand artwork stays on the machine unless someone chooses to commit it.

Run: python3 scripts/kiosk/build_brand_assets.py path/to/wordmark.png
(the official brand kit's wordmark is the right input; a public copy only stands in until it arrives)
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


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    mark = Image.open(sys.argv[1]).convert("RGBA")
    # Trim to the letters
    box = mark.getchannel("A").getbbox()
    if box:
        mark = mark.crop(box)
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

    # Both together: the wordmark in white on red, then the event
    combo = Image.new("RGBA", (w, h), RED)
    d = ImageDraw.Draw(combo)
    d.rectangle((0, 10, w, 13), fill=WHITE)
    d.rectangle((0, h - 14, w, h - 11), fill=WHITE)
    word = fit_height(tinted(mark, WHITE), 48, 290)
    text = "×  MILAN GAMES WEEK 2026"
    f = font(40)
    tw = d.textbbox((0, 0), text, font=f)[2]
    gap = 28
    x0 = (w - (word.width + gap + tw)) // 2
    combo.alpha_composite(word, (x0, (h - word.height) // 2))
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    d.text((x0 + word.width + gap - l, (h - (b - t)) // 2 - t), text, font=f, fill=WHITE)
    combo.convert("RGB").save(OUT / "banner-combo.png", optimize=True)

    for name in ("huawei-logo.png", "banner-huawei.png", "banner-combo.png"):
        print(f"wrote {(OUT / name).relative_to(ROOT)}")


if __name__ == "__main__":
    main()
