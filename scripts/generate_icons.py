#!/usr/bin/env python3
"""Generate BossKey FC PNG icons (16/48/128) with no external assets.

Renders a dark rounded tile with a stylised green football. Run:
    python3 scripts/generate_icons.py
"""
import math
import os

from PIL import Image, ImageDraw

BG = (10, 14, 10, 255)      # Pitch Black
GREEN = (34, 197, 94, 255)  # Goal Green
DARK = (7, 18, 11, 255)
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")


def rounded_tile(size: int) -> Image.Image:
    scale = 4  # supersample for smooth edges
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(s * 0.22)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=BG)

    # Ball
    cx = cy = s / 2
    r = s * 0.30
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=GREEN)

    # Central pentagon + spokes to suggest a football
    pent_r = r * 0.42
    pts = []
    for i in range(5):
        ang = -math.pi / 2 + i * 2 * math.pi / 5
        pts.append((cx + pent_r * math.cos(ang), cy + pent_r * math.sin(ang)))
    d.polygon(pts, fill=DARK)
    for px, py in pts:
        edge_x = cx + (px - cx) * 1.9
        edge_y = cy + (py - cy) * 1.9
        d.line([px, py, edge_x, edge_y], fill=DARK, width=max(2, int(s * 0.012)))

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (16, 48, 128):
        path = os.path.join(OUT_DIR, f"icon{size}.png")
        rounded_tile(size).save(path)
        print("wrote", os.path.relpath(path))


if __name__ == "__main__":
    main()
