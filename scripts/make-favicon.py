#!/usr/bin/env python3
"""Render the HEALTHPLEX favicon from the app's brand system.

Brand (from src/components/Shell.tsx sidebar logo + globals.css):
  - rounded square tile with a mint gradient (#4fe0a2 -> #12a271)
  - lucide `Activity` pulse glyph in navy (#04091a), round caps/joins
Renders at 4x and downsamples for clean anti-aliasing at tiny sizes.
"""
import math
from PIL import Image, ImageDraw

SIZE = 512          # final canvas
SS = 4              # supersample factor
S = SIZE * SS
RADIUS = int(S * 0.225)  # matches rounded-xl/2xl feel of the app logo

MINT_TOP = (79, 224, 162)    # --color-mint-400
MINT_BOTTOM = (18, 162, 113)  # --color-mint-600
NAVY = (4, 9, 26)             # --color-navy-950

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# --- mint gradient tile (diagonal) ---
grad = Image.new("RGBA", (S, S))
px = grad.load()
for y in range(S):
    for x in range(0, S, 1):
        t = (x + y) / (2 * (S - 1))          # 0 top-left -> 1 bottom-right
        r = int(MINT_TOP[0] + (MINT_BOTTOM[0] - MINT_TOP[0]) * t)
        g = int(MINT_TOP[1] + (MINT_BOTTOM[1] - MINT_TOP[1]) * t)
        b = int(MINT_TOP[2] + (MINT_BOTTOM[2] - MINT_TOP[2]) * t)
        px[x, y] = (r, g, b, 255)
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=RADIUS, fill=255)
img.paste(grad, (0, 0), mask)

draw = ImageDraw.Draw(img)

# --- subtle inner ring for depth ---
draw.rounded_rectangle(
    [int(S * 0.035), int(S * 0.035), S - int(S * 0.035) - 1, S - int(S * 0.035) - 1],
    radius=int(RADIUS * 0.9),
    outline=(255, 255, 255, 46),
    width=int(S * 0.012),
)

# --- lucide Activity pulse glyph: points "22 12 16 12 13.5 4 10.5 20 8 12 2 12" ---
pts24 = [(22, 12), (16, 12), (13.5, 4), (10.5, 20), (8, 12), (2, 12)]
scale = S / 24.0
# optically enlarge the glyph within the tile (stroke-to-tile ratio like the app logo)
pad_x, pad_y = S * 0.10, S * 0.10
inner = S - 2 * pad_x
pts = [(pad_x + (x / 24.0) * inner, (S / 2) + ((y - 12) / 24.0) * inner) for x, y in pts24]
stroke = int(S * 0.085)
draw.line(pts, fill=NAVY + (255,), width=stroke, joint="curve")
# round caps (PIL line caps are butt by default)
r = stroke / 2
for (x, y) in (pts[0], pts[-1]):
    draw.ellipse([x - r, y - r, x + r, y + r], fill=NAVY + (255,))

# --- soft gloss highlight (top-left sheen, very subtle) ---
gloss = Image.new("RGBA", (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(gloss)
gd.rounded_rectangle([0, 0, S - 1, int(S * 0.55)], radius=RADIUS, fill=(255, 255, 255, 26))
gmask = Image.new("L", (S, S), 0)
ImageDraw.Draw(gmask).rounded_rectangle([0, 0, S - 1, S - 1], radius=RADIUS, fill=255)
img.paste(Image.alpha_composite(img, gloss), (0, 0), gmask)

out = img.resize((SIZE, SIZE), Image.LANCZOS)

import os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.makedirs(os.path.join(root, "public"), exist_ok=True)
os.makedirs(os.path.join(root, "src", "app"), exist_ok=True)

out.save(os.path.join(root, "public", "icon-512.png"))
out.save(os.path.join(root, "src", "app", "icon.png"))          # Next.js app-icon convention
out.resize((180, 180), Image.LANCZOS).save(os.path.join(root, "src", "app", "apple-icon.png"))

# multi-resolution .ico for /favicon.ico
sizes = [16, 32, 48, 64]
out.save(os.path.join(root, "public", "favicon.ico"), sizes=[(s, s) for s in sizes])

# small PNG variants handy for PWA/manifest later
for s in (192, 32):
    out.resize((s, s), Image.LANCZOS).save(os.path.join(root, "public", f"icon-{s}.png"))

print("favicon written: public/favicon.ico, public/icon-{512,192,32}.png, src/app/icon.png, src/app/apple-icon.png")
