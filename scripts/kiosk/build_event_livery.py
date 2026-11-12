#!/usr/bin/env python3
"""
Builds the event livery's decal atlas for the 2026 Prototype:
public/cars/f12026/liveries/huawei_mgw/decals.png (2048 x 512, transparent).

The pictures are TEXT PLACEHOLDERS in the brand colours, not logos. To use the official artwork, replace the PNG
keeping each picture inside its rectangle (src/lib/kiosk/event-livery.ts lists them, 0-1 from the top left):

  A  0.000 0.000 0.537 0.586   sponsor wordmark (sidepods, nose sides, rear wing), white on transparent
  B  0.000 0.625 0.537 0.375   event name (engine cover), white on transparent
  C  0.547 0.000 0.125 0.500   race number box (nose)

Run: python3 scripts/kiosk/build_event_livery.py  (needs Pillow and a bold sans-serif TTF, e.g. Liberation Sans)
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/cars/f12026/liveries/huawei_mgw/decals.png"
FONTS = [
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/Library/Fonts/Arial Bold.ttf",
]
W, H = 2048, 512
RED = (199, 0, 11, 255)
WHITE = (245, 245, 245, 255)
OUTLINE = (20, 20, 24, 255)


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONTS:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    raise SystemExit("No bold TTF font found: add one to FONTS")


def fit(draw: ImageDraw.ImageDraw, text: str, box: tuple[int, int, int, int], start: int, stroke: int) -> ImageFont.FreeTypeFont:
    """The largest font size (from `start` down) at which `text` fits inside the box"""
    x0, y0, x1, y1 = box
    size = start
    while size > 10:
        f = font(size)
        l, t, r, b = draw.textbbox((0, 0), text, font=f, stroke_width=stroke)
        if r - l <= x1 - x0 and b - t <= y1 - y0:
            return f
        size -= 4
    return font(size)


def centred(draw: ImageDraw.ImageDraw, text: str, box: tuple[int, int, int, int], start: int, fill, stroke: int = 0) -> None:
    f = fit(draw, text, box, start, stroke)
    l, t, r, b = draw.textbbox((0, 0), text, font=f, stroke_width=stroke)
    x = (box[0] + box[2]) / 2 - (r - l) / 2 - l
    y = (box[1] + box[3]) / 2 - (b - t) / 2 - t
    draw.text((x, y), text, font=f, fill=fill, stroke_width=stroke, stroke_fill=OUTLINE)


def main() -> None:
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # A: sponsor wordmark (1100 x 300)
    centred(d, "HUAWEI", (20, 30, 1080, 270), 260, WHITE, stroke=6)
    # B: event name, two lines (1100 x 192)
    centred(d, "MILAN GAMES WEEK", (20, 326, 1080, 418), 90, WHITE, stroke=4)
    centred(d, "& CARTOOMICS 2026", (20, 420, 1080, 506), 80, WHITE, stroke=4)
    # C: number box (256 x 256)
    d.rounded_rectangle((1124, 4, 1372, 252), radius=28, fill=WHITE, outline=OUTLINE, width=6)
    centred(d, "26", (1140, 30, 1356, 226), 200, RED)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
