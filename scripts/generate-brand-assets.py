#!/usr/bin/env python3
import os
import sys
from PIL import Image, ImageOps, ImageDraw

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_LOGO = "/Users/ruyne./Downloads/applogo.png"

CREAM_COLOR = (244, 243, 235, 255) # #F4F3EB
CREAM_RGB = (244, 243, 235)

print(f"Loading master logo from {SRC_LOGO}...")
if not os.path.exists(SRC_LOGO):
    print(f"ERROR: Source logo {SRC_LOGO} not found!", file=sys.stderr)
    sys.exit(1)

master_img = Image.open(SRC_LOGO).convert("RGBA")
width, height = master_img.size
print(f"Master dimensions: {width}x{height}, mode={master_img.mode}")

# Crop to tight non-zero alpha bounding box
bbox = master_img.getbbox()
print(f"Character bounding box: {bbox}")
char_img = master_img.crop(bbox)
char_w, char_h = char_img.size
print(f"Character actual size: {char_w}x{char_h}")

# Verify white parts (eyes, book pages) are not punched out
# Count pixels with RGB > 200 and Alpha > 200
white_pixels = sum(1 for r, g, b, a in char_img.getdata() if r > 200 and g > 200 and b > 200 and a > 200)
print(f"White feature pixels preserved inside character: {white_pixels}")
assert white_pixels > 5000, "Character eye/book white pixels appear to be missing!"

# Ensure target directories exist
os.makedirs(os.path.join(ROOT_DIR, "src/assets/branding"), exist_ok=True)
os.makedirs(os.path.join(ROOT_DIR, "public/branding"), exist_ok=True)

# 1. Save master images
master_dest = os.path.join(ROOT_DIR, "src/assets/branding/potato-logo-master.png")
master_img.save(master_dest, "PNG")
master_pub = os.path.join(ROOT_DIR, "public/branding/potato-logo-master.png")
master_img.save(master_pub, "PNG")

# Create master transparent centered on square 1254x1254 canvas with 10% breathing room
def create_centered_logo(canvas_size, scale_ratio, bg_color=None):
    """
    scale_ratio: fraction of canvas_size that the character's largest dimension should occupy.
    bg_color: RGBA tuple or None for transparent.
    """
    canvas = Image.new("RGBA", (canvas_size, canvas_size), bg_color or (0, 0, 0, 0))
    target_dim = int(canvas_size * scale_ratio)
    
    # Scale preserving aspect ratio
    aspect = char_w / char_h
    if aspect >= 1.0:
        new_w = target_dim
        new_h = int(target_dim / aspect)
    else:
        new_h = target_dim
        new_w = int(target_dim * aspect)
    
    resized_char = char_img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    pos_x = (canvas_size - new_w) // 2
    pos_y = (canvas_size - new_h) // 2
    
    canvas.paste(resized_char, (pos_x, pos_y), resized_char)
    return canvas

# Master transparent & cream (1254x1254)
master_transparent = create_centered_logo(1254, 0.88, bg_color=None)
master_transparent.save(os.path.join(ROOT_DIR, "src/assets/branding/potato-logo-transparent.png"), "PNG")
master_transparent.save(os.path.join(ROOT_DIR, "public/branding/potato-logo-transparent.png"), "PNG")

master_cream = create_centered_logo(1254, 0.84, bg_color=CREAM_COLOR)
master_cream.save(os.path.join(ROOT_DIR, "src/assets/branding/potato-logo-cream.png"), "PNG")
master_cream.save(os.path.join(ROOT_DIR, "public/branding/potato-logo-cream.png"), "PNG")

# Also save high-res public brand logos
master_cream.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(ROOT_DIR, "public/branding/logo.png"), "PNG")
master_transparent.resize((512, 512), Image.Resampling.LANCZOS).save(os.path.join(ROOT_DIR, "public/branding/logo-transparent.png"), "PNG")

# 2. PWA Icons (Standard & Maskable)
# Standard PWA (cream background, comfortable margin)
pwa_192 = create_centered_logo(192, 0.82, bg_color=CREAM_COLOR)
pwa_192.save(os.path.join(ROOT_DIR, "public/pwa-192.png"), "PNG")

pwa_512 = create_centered_logo(512, 0.82, bg_color=CREAM_COLOR)
pwa_512.save(os.path.join(ROOT_DIR, "public/pwa-512.png"), "PNG")

# Maskable PWA (Safe zone is inner 80% circle, character occupies ~65% of canvas so circle/squircle cuts never touch character)
pwa_mask_192 = create_centered_logo(192, 0.65, bg_color=CREAM_COLOR)
pwa_mask_192.save(os.path.join(ROOT_DIR, "public/pwa-maskable-192.png"), "PNG")

pwa_mask_512 = create_centered_logo(512, 0.65, bg_color=CREAM_COLOR)
pwa_mask_512.save(os.path.join(ROOT_DIR, "public/pwa-maskable-512.png"), "PNG")

# Apple Touch Icon (180x180, cream background, standard iOS squircle safe area)
apple_touch = create_centered_logo(180, 0.80, bg_color=CREAM_COLOR)
apple_touch.save(os.path.join(ROOT_DIR, "public/apple-touch-icon.png"), "PNG")

# Favicons (16, 32, 48)
fav_16 = create_centered_logo(16, 0.90, bg_color=CREAM_COLOR)
fav_16.save(os.path.join(ROOT_DIR, "public/favicon-16x16.png"), "PNG")

fav_32 = create_centered_logo(32, 0.88, bg_color=CREAM_COLOR)
fav_32.save(os.path.join(ROOT_DIR, "public/favicon-32x32.png"), "PNG")

fav_48 = create_centered_logo(48, 0.85, bg_color=CREAM_COLOR)
fav_48.save(os.path.join(ROOT_DIR, "public/favicon-48x48.png"), "PNG")
fav_48.save(os.path.join(ROOT_DIR, "public/favicon.png"), "PNG")

# Multi-resolution favicon.ico
fav_48.convert("RGB").save(os.path.join(ROOT_DIR, "public/favicon.ico"), format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])

# 3. Android Icons
android_res = os.path.join(ROOT_DIR, "android/app/src/main/res")
densities = {
    "mipmap-mdpi": {"legacy": 48, "foreground": 108},
    "mipmap-hdpi": {"legacy": 72, "foreground": 162},
    "mipmap-xhdpi": {"legacy": 96, "foreground": 216},
    "mipmap-xxhdpi": {"legacy": 144, "foreground": 324},
    "mipmap-xxxhdpi": {"legacy": 192, "foreground": 432},
}

for folder, dims in densities.items():
    dir_path = os.path.join(android_res, folder)
    os.makedirs(dir_path, exist_ok=True)
    
    leg_dim = dims["legacy"]
    fg_dim = dims["foreground"]
    
    # A. Legacy square/squircle icon (cream background, scale 0.82)
    leg_icon = create_centered_logo(leg_dim, 0.82, bg_color=CREAM_COLOR)
    leg_icon.save(os.path.join(dir_path, "ic_launcher.png"), "PNG")
    
    # B. Legacy round icon (circular mask on cream background)
    # Circle diameter = leg_dim, character scale = 0.72 so inside circle with safe margin
    round_canvas = create_centered_logo(leg_dim, 0.72, bg_color=CREAM_COLOR)
    # Apply circular mask
    mask = Image.new("L", (leg_dim, leg_dim), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, leg_dim - 1, leg_dim - 1), fill=255)
    round_icon = Image.new("RGBA", (leg_dim, leg_dim), (0, 0, 0, 0))
    round_icon.paste(round_canvas, (0, 0), mask)
    round_icon.save(os.path.join(dir_path, "ic_launcher_round.png"), "PNG")
    
    # C. Adaptive foreground (108dp canvas, character within 60% inner circle, transparent background)
    # Safe viewport in Android adaptive icon is 72dp / 108dp = 66.6%.
    # Scaling to 0.60 guarantees eyes, hands, and book are 100% inside any OEM mask.
    fg_icon = create_centered_logo(fg_dim, 0.60, bg_color=None)
    fg_icon.save(os.path.join(dir_path, "ic_launcher_foreground.png"), "PNG")

    # D. Monochrome layer (silhouette with alpha channel)
    mono_icon = Image.new("RGBA", (fg_dim, fg_dim), (0, 0, 0, 0))
    fg_alpha = fg_icon.getchannel("A")
    white_layer = Image.new("RGBA", (fg_dim, fg_dim), (255, 255, 255, 255))
    mono_icon.paste(white_layer, (0, 0), fg_alpha)
    mono_icon.save(os.path.join(dir_path, "ic_launcher_monochrome.png"), "PNG")

print("All brand assets generated successfully.")
