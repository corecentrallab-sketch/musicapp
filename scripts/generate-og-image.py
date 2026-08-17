#!/usr/bin/env python3
"""Generate public/og-image.png (1200x630) for NoteSnap social sharing.

Brand: amber (#d97706) + stone (#fafaf9 / #1c1917). Rerun after editing the
design: python3 scripts/generate-og-image.py
Requires Pillow (available in the sandbox).
"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
STONE_50 = (250, 250, 249)
STONE_900 = (28, 25, 23)
STONE_500 = (120, 113, 108)
AMBER_600 = (217, 119, 6)
AMBER_100 = (254, 243, 199)
WHITE = (255, 255, 255)

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

img = Image.new("RGB", (W, H), STONE_50)
d = ImageDraw.Draw(img)

# Left accent bar + bottom band
d.rectangle([0, 0, 24, H], fill=AMBER_600)
d.rectangle([0, H - 16, W, H], fill=AMBER_600)

# Rounded "logo chip"
chip = Image.new("RGBA", (120, 120), (0, 0, 0, 0))
cd = ImageDraw.Draw(chip)
cd.rounded_rectangle([0, 0, 119, 119], radius=28, fill=AMBER_600)
# Music-note glyph approximation (two filled circles + stems) drawn simply
cd.ellipse([38, 62, 58, 82], fill=WHITE)
cd.ellipse([72, 46, 92, 66], fill=WHITE)
cd.rectangle([52, 40, 60, 82], fill=WHITE)
cd.rectangle([86, 24, 94, 66], fill=WHITE)
img.paste(chip, (96, 96), chip)

title_font = ImageFont.truetype(FONT_BOLD, 72)
sub_font = ImageFont.truetype(FONT_REG, 34)
foot_font = ImageFont.truetype(FONT_BOLD, 26)

d.text((96, 260), "NoteSnap", font=title_font, fill=STONE_900)
d.text((96, 360), "Identify any song. Get sheet music instantly.", font=sub_font, fill=STONE_500)
d.text((96, 540), "Free classical scores · Official sheet music · Practice tools", font=foot_font, fill=AMBER_600)

out = "/home/team/shared/site/public/og-image.png"
img.save(out, "PNG", optimize=True)
print("wrote", out, img.size)
