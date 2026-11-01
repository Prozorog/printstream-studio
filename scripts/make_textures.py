"""Author Printstream-inspired 4K decals and 2K linear PBR maps.

Run with the system Python: python scripts/make_textures.py
Regenerate only the two cylindrical pigment atlases with --only cylinders.
Dependencies: Pillow and NumPy. No renderer, network access, or image-generation
service is used. The supplied reference informs the newly drawn graphic layout;
photographic illumination is deliberately not copied into the pigment maps.

assets/materials.json is the authoritative material/UV contract. PNG coordinates
are top-origin; the Blender formulas in that file are bottom-origin. Cylinder
left-side graphics are flipped vertically within their angular sector, making
them upright on the negative-Y face rather than inverted by the cylindrical UVs.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, PngImagePlugin

ROOT = Path(__file__).resolve().parents[1]
SIZE = 4096
DATA_SIZE = 2048
SEED = 15102020
INK = (20, 21, 22)
MID = (102, 106, 105)
PALE = (156, 159, 157)
WHITE = (220, 222, 218)
PEARL = (228, 229, 227)
CHARCOAL = (27, 27, 27)
RESAMPLE = Image.Resampling.LANCZOS
FONT_FILES = {"sans": "arial.ttf", "bold": "arialbd.ttf", "mono": "consola.ttf", "technical": "bahnschrift.ttf"}
FONTS: dict[str, ImageFont.FreeTypeFont] = {}
OUTPUT: Path
REFERENCE: str


def save(image: Image.Image, name: str, description: str, data: bool = False) -> None:
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("Title", "PRINTSTREAM / " + name)
    metadata.add_text("Description", description)
    metadata.add_text("SourceReference", REFERENCE)
    metadata.add_text("Seed", str(SEED))
    metadata.add_text("ColorSpace", "linear data" if data else "sRGB")
    metadata.add_text("UVConvention", "Blender bottom-origin v; PNG y=(1-v)*height")
    image.save(OUTPUT / name, pnginfo=metadata, compress_level=9)


def coat_base(color: tuple[int, int, int], seed: int) -> Image.Image:
    """Only sub-two-level spatial pigment variation; never a light gradient."""
    rng = np.random.default_rng(seed)
    small = Image.fromarray(rng.integers(0, 256, (48, 48), dtype=np.uint8))
    field_image = small.resize((SIZE, SIZE), Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(18))
    delta = (np.asarray(field_image, dtype=np.int16) - 128) // 90
    pixels = np.empty((SIZE, SIZE, 3), dtype=np.uint8)
    for channel, value in enumerate(color):
        pixels[:, :, channel] = np.clip(value + delta, 0, 255)
    return Image.fromarray(pixels)


def cylinder_coat(seed: int) -> Image.Image:
    """Mean-neutral chromatic pigment, concentrated at top/grazing UV sectors.

    Palette offsets have zero luminance and are centered per row. This adds no
    shading or highlight: curvature-dependent lighting remains the renderer's
    job, while the separate thickness map still drives physical interference.
    """
    pixels = np.asarray(coat_base(PEARL, seed)).copy()
    palette = np.array([(11, -6, 6), (4, -6, 15), (-12, 3, 13),
                        (-10, 9, -1), (7, 3, -9), (11, -6, 6)], dtype=np.float32)
    luminance = np.array([.2126, .7152, .0722], dtype=np.float32)
    palette -= (palette @ luminance)[:, None]
    knots = np.linspace(0, 1, len(palette), dtype=np.float32)
    u = np.arange(SIZE, dtype=np.float32) / SIZE
    for row in range(SIZE):
        v = 1 - (row + .5) / SIZE
        strength = min(1, .68 * math.exp(-((v - .25) / .13) ** 2)
                       + .55 * math.exp(-((v - .40) / .09) ** 2)
                       + .40 * math.exp(-((v - .10) / .09) ** 2)
                       + .15 * math.exp(-((v - .75) / .10) ** 2))
        phase = np.mod(u + .10 * math.sin(2 * math.pi * v), 1)
        tint = np.column_stack([np.interp(phase, knots, palette[:, channel]) for channel in range(3)])
        tint -= tint.mean(axis=0)
        neutral = pixels[row].astype(np.float32)
        neutral += np.array(PEARL, dtype=np.float32) - neutral.mean(axis=0)
        pixels[row] = np.clip(np.rint(neutral + tint * strength * 1.1), 0, 255).astype(np.uint8)
    return Image.fromarray(pixels)


class Paint:
    """Draw in physical chart coordinates, keeping lettering aspect correct."""

    def __init__(self, image: Image.Image, domain=(0, 0, 1, 1), uv=(0, .02, 1, .48)):
        self.image = image
        self.draw = ImageDraw.Draw(image)
        self.x0, self.z0, self.x1, self.z1 = domain
        self.u0, self.v0, self.u1, self.v1 = uv
        self.sx = image.width * (self.u1 - self.u0) / (self.x1 - self.x0)
        self.sy = image.height * (self.v1 - self.v0) / (self.z1 - self.z0)

    def point(self, x, z):
        return (round(self.image.width * self.u0 + (x - self.x0) * self.sx),
                round(self.image.height * (1 - self.v0) - (z - self.z0) * self.sy))

    def line(self, points, fill=INK, width=.0018):
        self.draw.line([self.point(x, z) for x, z in points], fill=fill,
                       width=max(1, round(width * self.sy)), joint="curve")

    def polygon(self, points, fill=INK):
        self.draw.polygon([self.point(x, z) for x, z in points], fill=fill)

    def rect(self, x0, z0, x1, z1, fill=INK, outline=None, width=.0015):
        left, bottom = self.point(x0, z0)
        right, top = self.point(x1, z1)
        self.draw.rectangle((left, top, right, bottom), fill=fill, outline=outline,
                            width=max(1, round(width * self.sy)))

    def circle(self, x, z, radius, fill=INK, outline=None, width=.0015):
        left, top = self.point(x - radius, z + radius)
        right, bottom = self.point(x + radius, z - radius)
        self.draw.ellipse((left, top, right, bottom), fill=fill, outline=outline,
                          width=max(1, round(width * self.sy)))

    def text(self, x, top, text, height=.016, fill=INK, face="mono", width=None):
        font = FONTS[face]
        bounds = font.getbbox(text)
        tile = Image.new("RGBA", (bounds[2] - bounds[0] + 4, bounds[3] - bounds[1] + 4))
        ImageDraw.Draw(tile).text((2 - bounds[0], 2 - bounds[1]), text, fill=fill + (255,), font=font)
        box = tile.getbbox()
        if box is None:
            return
        tile = tile.crop(box)
        target_h = max(1, round(height * self.sy))
        target_w = max(1, round(width * self.sx if width is not None else tile.width / tile.height * height * self.sx))
        tile = tile.resize((target_w, target_h), RESAMPLE)
        self.image.paste(tile, self.point(x, top), tile)

    def cross(self, x, z, radius=.009, fill=INK, width=.0018, gap=0):
        if gap:
            self.line([(x - radius, z), (x - gap, z)], fill, width)
            self.line([(x + gap, z), (x + radius, z)], fill, width)
            self.line([(x, z - radius), (x, z - gap)], fill, width)
            self.line([(x, z + gap), (x, z + radius)], fill, width)
        else:
            self.line([(x - radius, z), (x + radius, z)], fill, width)
            self.line([(x, z - radius), (x, z + radius)], fill, width)

    def corners(self, x0, z0, x1, z1, length=.035, fill=INK, width=.002):
        for x, dx in ((x0, length), (x1, -length)):
            for z, dz in ((z0, length), (z1, -length)):
                self.line([(x, z + dz), (x, z), (x + dx, z)], fill, width)

    def paste(self, tile, x0, z0, x1, z1):
        left, top = self.point(x0, z1)
        right, bottom = self.point(x1, z0)
        self.image.paste(tile.resize((right - left, bottom - top), RESAMPLE), (left, top))


def glyph_x(p: Paint, x: float, z: float, w=.21, h=.18, fill=INK, weight=.25):
    notch, waist = .5 - .72 * weight, .56 * weight
    shape = [(0, 0), (weight, 0), (.5, notch), (1 - weight, 0), (1, 0), (.5 + waist, .5),
             (1, 1), (1 - weight, 1), (.5, 1 - notch), (weight, 1), (0, 1), (.5 - waist, .5)]
    p.polygon([(x + u * w, z + v * h) for u, v in shape], fill)


def heart(p: Paint, x: float, z: float, width=.18, height=.17, fill=INK):
    points = []
    for t in np.linspace(0, 2 * math.pi, 160):
        hx = 16 * math.sin(t) ** 3
        hz = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        points.append((x + hx / 32 * width, z + (hz + 2.5) / 29 * height))
    p.polygon(points, fill)


def barcode(p: Paint, x: float, z: float, width: float, height: float, code: str, ink_gain=0):
    """A deterministic optical serial mark, not a machine-readable product UPC."""
    bars = [2, 1, 2, 1]
    for value in code.encode("ascii"):
        bars.extend((1 + (value >> bit & 1)) for bit in range(7, -1, -1))
    bars.extend([2, 1, 1, 2])
    unit = width / sum(bars)
    offset = x
    for i, span in enumerate(bars):
        if i % 2 == 0:
            p.rect(max(x, offset - ink_gain * unit / 2), z,
                   min(x + width, offset + (span + ink_gain / 2) * unit), z + height)
        offset += span * unit


def qr_matrix(payload="PRINTSTREAM") -> np.ndarray:
    """ISO QR Version 1-L byte mode, mask 0, with real Reed-Solomon parity."""
    data = payload.encode("ascii")
    if len(data) > 17:
        raise ValueError("Version 1-L QR payload must be at most 17 bytes")
    bits = [0, 1, 0, 0] + [(len(data) >> i) & 1 for i in range(7, -1, -1)]
    for value in data:
        bits += [(value >> i) & 1 for i in range(7, -1, -1)]
    bits += [0] * min(4, 152 - len(bits))
    bits += [0] * (-len(bits) % 8)
    codewords = [sum(bits[i + j] << (7 - j) for j in range(8)) for i in range(0, len(bits), 8)]
    while len(codewords) < 19:
        codewords.append((0xEC, 0x11)[(len(codewords) - (len(bits) // 8)) % 2])

    def multiply(a, b):
        result = 0
        for _ in range(8):
            if b & 1:
                result ^= a
            a <<= 1
            if a & 0x100:
                a ^= 0x11D
            b >>= 1
        return result

    generator = [1]
    root = 1
    for _ in range(7):
        expanded = [0] * (len(generator) + 1)
        for j, value in enumerate(generator):
            expanded[j] ^= value
            expanded[j + 1] ^= multiply(value, root)
        generator = expanded
        root = multiply(root, 2)
    parity = [0] * 7
    for value in codewords:
        factor = value ^ parity[0]
        parity = parity[1:] + [0]
        for j in range(7):
            parity[j] ^= multiply(generator[j + 1], factor)
    stream = [(value >> bit) & 1 for value in codewords + parity for bit in range(7, -1, -1)]
    modules = np.zeros((21, 21), dtype=np.uint8)
    reserved = np.zeros((21, 21), dtype=bool)

    def put(x, y, value):
        if 0 <= x < 21 and 0 <= y < 21:
            modules[y, x] = value
            reserved[y, x] = True

    for cx, cy in ((3, 3), (17, 3), (3, 17)):
        for dy in range(-4, 5):
            for dx in range(-4, 5):
                distance = max(abs(dx), abs(dy))
                put(cx + dx, cy + dy, int(distance not in (2, 4)))
    for i in range(8, 13):
        put(i, 6, int(i % 2 == 0))
        put(6, i, int(i % 2 == 0))
    format_value = 0x77C4  # Level L / mask 0, BCH encoded and XOR masked.
    for i in range(6):
        put(8, i, (format_value >> i) & 1)
    put(8, 7, (format_value >> 6) & 1)
    put(8, 8, (format_value >> 7) & 1)
    put(7, 8, (format_value >> 8) & 1)
    for i in range(9, 15):
        put(14 - i, 8, (format_value >> i) & 1)
    for i in range(8):
        put(20 - i, 8, (format_value >> i) & 1)
    for i in range(8, 15):
        put(8, 6 + i, (format_value >> i) & 1)
    put(8, 13, 1)
    cursor = 0
    right = 20
    upwards = True
    while right >= 1:
        if right == 6:
            right -= 1
        for y in (range(20, -1, -1) if upwards else range(21)):
            for x in (right, right - 1):
                if not reserved[y, x]:
                    modules[y, x] = stream[cursor] ^ int((x + y) % 2 == 0)
                    cursor += 1
        upwards = not upwards
        right -= 2
    return np.pad(modules, 4)


def qr(p: Paint, x: float, z: float, side: float, fill=INK):
    matrix = qr_matrix()
    unit = side / len(matrix)
    for row, column in zip(*np.nonzero(matrix)):
        p.rect(x + column * unit, z + (len(matrix) - row - 1) * unit,
               x + (column + 1) * unit, z + (len(matrix) - row) * unit, fill)


def pixel_cluster(p: Paint, x, z, width, height, columns=17, rows=5, fill=INK, radius_scale=1):
    """Intentional open-cell optical pattern, with several distinctive glyphs."""
    for row in range(rows):
        for col in range(columns):
            value = (col * 13 + row * 7 + col * row * 3) % 17
            if value < 7 or (col == columns - 1 and row % 2):
                continue
            px = x + col * width / (columns - 1)
            pz = z + row * height / (rows - 1)
            radius = min(width / columns, height / rows) * (.16 + .022 * (value % 5)) * radius_scale
            if value == 12:
                p.cross(px, pz, radius * 1.7, fill, .0016 * radius_scale)
            else:
                p.circle(px, pz, radius, fill)


def monitor_icon(p: Paint, x, z, width=.13, height=.092):
    p.rect(x, z, x + width, z + height, fill=None, outline=INK, width=.004)
    p.line([(x + .012, z + height * .32), (x + width * .28, z + height * .63),
            (x + width * .43, z + height * .37), (x + width * .55, z + height * .75),
            (x + width * .76, z + height * .25), (x + width - .012, z + height * .55)], width=.004)
    p.line([(x + width * .25, z - .01), (x + width * .75, z - .01)], width=.002)


def hologram() -> Image.Image:
    palette = np.array([(231, 190, 212), (191, 186, 238), (157, 206, 229),
                        (159, 220, 202), (221, 226, 169), (238, 197, 157),
                        (226, 185, 214)], dtype=np.float32)
    x = np.linspace(0, 1, SIZE, dtype=np.float32)[None, :]
    y = np.linspace(0, 1, 1024, dtype=np.float32)[:, None]
    phase = np.clip(x * .94 + .035 + .026 * np.sin(y * math.pi * 2), 0, 1) * (len(palette) - 1)
    index = np.minimum(phase.astype(np.int32), len(palette) - 2)
    blend = (phase - index)[:, :, None]
    colors = palette[index] * (1 - blend) + palette[index + 1] * blend
    # Fine transparent-looking optical ruling; still pigment, not a light map.
    ruling = ((np.arange(1024) % 32) < 2).astype(np.float32)[:, None, None]
    colors = np.clip(colors - ruling * 11, 0, 255).astype(np.uint8)
    image = Image.fromarray(colors)
    p = Paint(image, uv=(0, 0, 1, 1))
    p.line([(.018, .11), (.982, .11)], (232, 234, 232), .006)
    p.line([(.018, .89), (.982, .89)], (243, 244, 242), .006)
    for x_pos in np.linspace(.035, .965, 30):
        p.line([(x_pos, .11), (x_pos, .14)], (102, 113, 124), .003)
    p.text(.025, .72, "P / S", .26, (66, 75, 83), "technical", width=.065)
    p.text(.77, .42, "OPTICAL / 015", .13, (68, 80, 91), width=.19)
    return image


def receiver(holo: Image.Image):
    image = coat_base(PEARL, SEED)
    left = Paint(image, (.05, -.93, 2.45, .87), (0, .02, 1, .48))
    glyph_x(left, .28, -.02, .215, .18)
    glyph_x(left, .535, -.02, .215, .18)
    left.text(.285, .205, "PS / OPTICAL COATING SYSTEM", .011, MID)
    left.text(.288, -.058, "PRINTSTREAM", .016, INK, "technical", width=.254)
    left.line([(.28, -.097), (.75, -.097)], MID, .001)
    left.corners(.20, -.655, .765, -.225, .038, INK, .002)
    heart(left, .37, -.36)
    left.text(.256, -.487, "IRIDESCENT / WHITE", .012, MID)
    for i, height in enumerate((.011, .015, .009)):
        z = -.565 - i * .023
        left.paste(holo, .30, z - height, .57, z)
    left.text(.302, -.638, "PS.2020 / EDITION 015", .010, INK)
    left.line([(.618, -.61), (.618, -.55), (.69, -.55), (.69, -.49)], MID, .0015)
    left.cross(.69, -.49, .011, MID, .0015)
    left.cross(.255, -.56, .013, INK, .0015)
    pixel_cluster(left, .87, .045, .31, .10, 14, 4)
    left.circle(.815, .094, .027, fill=None, outline=INK, width=.009)
    left.cross(.815, .094, .039, INK, .006)
    monitor_icon(left, 1.31, .024, .158, .12)
    left.text(1.306, -.010, "LIGHT / RESPONSE", .011, MID, width=.18)
    barcode(left, 1.60, .032, .375, .115, "B15-PS20")
    left.text(1.60, .015, "0 1 5  /  P S  2 0 2 0", .011, INK, width=.375)
    left.text(1.80, .29, "B15:", .052, INK, "technical")
    left.circle(2.045, .261, .016, fill=None, outline=INK, width=.002)
    left.line([(2.09, .25), (2.14, .25), (2.15, .27), (2.22, .27)], INK, .006)
    pixel_cluster(left, 2.075, .035, .13, .115, 5, 5)
    qr(left, .925, -.295, .178)
    left.text(.939, -.313, "SCAN / PS", .010, MID, width=.142)
    left.text(1.15, -.26, "CHROMATIC LABORATORY", .014, MID)
    left.text(1.15, -.295, "WHITE SERIES / OPTICAL STUDY", .010, MID)
    left.text(1.15, -.329, "FINISH  015  /  L-2020", .010, MID)
    left.line([(1.15, -.36), (1.48, -.36)], PALE, .001)
    left.text(1.58, -.26, "S", .027, MID, "technical")
    left.text(1.865, -.26, "F", .027, MID, "technical")
    left.circle(1.76, -.267, .012, MID)
    left.text(1.80, -.42, "PS / 01", .015, MID)
    for x, z in ((.16, .14), (.16, -.13), (1.21, .128), (1.53, -.14), (2.20, -.17), (2.27, .37)):
        left.cross(x, z, .011, MID, .0017, .003)
    left.text(.09, .365, "L / 15", .015, INK)
    left.line([(.115, .415), (.15, .44), (.18, .415)], INK, .003)
    left.text(1.65, .565, "PRINTSTREAM / PEARLESCENT", .014, MID, width=.43)
    left.cross(2.18, .57, .014, MID)
    left.text(.807, -.545, "SERIAL", .009, MID)
    barcode(left, .797, -.655, .106, .071, "015")
    left.text(.80, -.675, "01-PS15", .010, MID, width=.105)

    right = Paint(image, (.05, -.93, 2.45, .87), (0, .52, 1, .98))
    # Keep x=.65..1.70, z=-.07...19 completely free for the real ejection opening.
    right.text(.28, .29, "P / S", .078, INK, "technical", width=.27)
    right.text(.28, .17, "PRINTSTREAM", .016, MID, width=.26)
    right.corners(.245, -.63, .76, -.245, .039, INK, .002)
    qr(right, .28, -.45, .192)
    right.text(.485, -.297, "015", .055, INK, "technical")
    right.text(.485, -.376, "CHROMATIC", .012, MID)
    right.text(.485, -.407, "RESPONSE", .012, MID)
    right.paste(holo, .295, -.572, .673, -.546)
    right.text(.295, -.602, "RIGHT / OPTICAL SERIES", .012, INK, width=.377)
    right.line([(.77, .245), (1.69, .245)], MID, .0012)
    right.text(.78, .278, "PEARL FILM / 250-450 NM", .015, MID, width=.48)
    right.text(1.42, .278, "R - 015", .014, MID, width=.20)
    right.text(1.83, .285, "B15", .052, INK, "technical")
    glyph_x(right, 1.84, .028, .12, .10)
    glyph_x(right, 1.984, .028, .12, .10)
    barcode(right, 1.80, -.15, .34, .09, "R015PS")
    right.text(1.80, -.18, "PS  /  R  /  015", .012, MID, width=.34)
    right.text(.94, -.28, "SURFACE STUDY / NO. 001", .014, MID)
    right.text(.94, -.316, "MONOCHROME  |  INTERFERENCE", .010, MID)
    right.text(.94, -.352, "ARCHIVE 2020 / STUDIO EDITION", .010, MID)
    monitor_icon(right, 1.47, -.48, .14, .10)
    right.text(1.48, -.51, "OPTICAL", .010, MID)
    for x, z in ((.17, .035), (.54, .40), (1.75, -.39), (2.18, -.3), (2.27, .39)):
        right.cross(x, z, .013, MID, .0015)
    right.text(1.65, .565, "PRINTSTREAM / WHITE SERIES", .014, MID, width=.43)
    save(image, "receiver.png", "4096 squared receiver atlas. Left bottom half, distinct right top half; actual QR and sharp authored optical graphics.")


def flip_sector(image, low=.42, high=.58):
    top, bottom = round((1 - high) * SIZE), round((1 - low) * SIZE)
    image.paste(image.crop((0, top, SIZE, bottom)).transpose(Image.Transpose.FLIP_TOP_BOTTOM), (0, top))


def suppressor():
    image = cylinder_coat(SEED + 1)
    decals = Image.new("RGBA", image.size)
    left = Paint(decals, (0, 0, 1.9, .32), (0, .42, 1, .58))
    pixel_cluster(left, .135, .085, .365, .17, 17, 4, radius_scale=2)
    left.line([(.57, .185), (1.66, .185)], INK, .004)
    left.circle(.57, .185, .004, INK)
    glyph_x(left, 1.705, .178, .039, .041, weight=.28)
    glyph_x(left, 1.751, .178, .039, .041, weight=.28)
    barcode(left, 1.704, .059, .086, .082, "PS", ink_gain=.6)
    left.text(.625, .155, "PRINTSTREAM / LIGHT INTERFERENCE SERIES", .010, MID, width=.515)
    left.text(1.18, .155, "015  /  WHITE", .009, MID, width=.20)
    left.text(.145, .055, "OPTICAL / 2020", .009, MID, width=.22)
    flip_sector(decals)
    image.paste(decals, (0, 0), decals)
    top = Paint(image, (0, 0, 1.9, .12), (0, .22, 1, .28))
    top.text(1.31, .065, "PS / COATING 015", .010, MID, width=.29)
    top.cross(1.655, .052, .008, MID)
    right = Paint(image, (0, 0, 1.9, .12), (0, .04, 1, .10))
    right.text(.37, .085, "P E A R L  /  P R I N T S T R E A M", .014, MID, width=.64)
    right.line([(1.08, .073), (1.60, .073)], MID, .0012)
    save(image, "suppressor.png", "4096 squared cylinder atlas: optical dot cluster; fine straight reference stripe; XX and barcode. Restrained mean-neutral pearl tint, with no baked highlights.")


def handguard():
    image = cylinder_coat(SEED + 2)
    decals = Image.new("RGBA", image.size)
    left = Paint(decals, (0, 0, 1.66, .28), (0, .42, 1, .58))
    for index in range(13):
        x = .062 + index * .121
        left.text(x, .21, f"{index + 1:02}", .011, MID, width=.020)
        left.line([(x, .184), (x + .022, .184)], MID, .0012)
        left.cross(x + .011, .112, .005, MID, .0012)
        if index % 3 == 0:
            left.text(x - .006, .076, "PS", .010, INK, width=.023)
            left.text(x - .006, .053, "015", .0075, MID, width=.024)
    left.text(.067, .255, "PEARL FILM", .008, MID, width=.10)
    left.text(1.415, .255, "WHITE / 2020", .008, MID, width=.13)
    flip_sector(decals)
    image.paste(decals, (0, 0), decals)
    top = Paint(image, (0, 0, 1.66, .12), (0, .22, 1, .28))
    for index, x in enumerate((.17, .53, .90, 1.27)):
        top.text(x, .08, ("PS / 015", "WHITE", "OPTICAL", "PRINTSTREAM")[index], .011, MID, width=.10)
        top.line([(x, .047), (x + .095, .047)], PALE, .001)
    right = Paint(image, (0, 0, 1.66, .12), (0, .03, 1, .09))
    for index in range(13):
        x = .062 + index * .121
        right.text(x, .085, f"R{index + 1:02}", .009, MID, width=.026)
        right.cross(x + .01, .045, .005, MID, .001)
    save(image, "handguard.png", "4096 squared ribbed handguard cylinder atlas; per-rib microtype, optical indexing and quiet top lettering. Mean-neutral pink/lilac/cyan/mint pigment at top/grazing sectors, without baked lighting.")


def magazine():
    image = coat_base(PEARL, SEED + 3)
    for right_side in (False, True):
        p = Paint(image, (0, 0, .66, 1.35), (0, .52 if right_side else .02, 1, .98 if right_side else .48))
        for column, u in enumerate((.75, .85)):
            for row in range(35):
                z = .16 + row * .029
                if (row * 7 + column * 3) % 11 < 3:
                    continue
                x = .66 * u + .0035 * ((row % 3) - 1)
                p.circle(x, z, .003 + .0017 * ((row + column) % 3), INK)
                if row % 6 == 1:
                    p.circle(x + .012, z + .010, .0021, INK)
        p.cross(.17, .22, .025, INK, .0018, .005)
        p.cross(.17, .22, .0045, INK, .0012)
        p.cross(.325, .11, .011, MID, .0012)
        p.text(.065, .116, "R / 15" if right_side else "L / 15", .013, INK)
        p.text(.31, 1.22, "PRINTSTREAM", .014, MID, width=.25)
        p.text(.32, 1.18, "OPTICAL / 015", .010, MID, width=.22)
        p.line([(.11, 1.08), (.23, 1.08)], PALE, .001)
        if right_side:
            p.text(.12, .58, "PS", .028, MID, "technical")
            p.text(.12, .53, "2020", .011, MID)
    save(image, "magazine.png", "4096 squared left/right magazine atlas; two open dotted columns at u=.75/.85, plus crosshairs and quiet indexing.")


def polymer(holo: Image.Image):
    image = coat_base(CHARCOAL, SEED + 4)
    save(image, "polymer.png", "4096 squared neutral charcoal pigment. Generic polymer uses its constant linear factor to avoid an unnecessary runtime color texture.")
    grip = image.copy()
    for right_side in (False, True):
        p = Paint(grip, (0, 0, .7, 1.0), (0, .52 if right_side else .02, 1, .98 if right_side else .48))
        qr(p, .27, .73, .165, (167, 171, 167))
        p.text(.17, .54, "P / S  —  015", .018, WHITE, "technical", width=.31)
        rows = ["PRINTSTREAM / WHITE SERIES", "THIN FILM INTERFERENCE", "CHROMATIC RESPONSE / 2020", "OPTICAL COATING STUDY", "ARCHIVE NO. 001", "UNOFFICIAL VISUAL EDITION"]
        for index, text in enumerate(rows):
            p.text(.17, .49 - index * .033, text, .009, (164, 169, 165), width=.34 - (index % 3) * .025)
        p.line([(.17, .275), (.51, .275)], WHITE, .0012)
        p.paste(holo, .17, .226, .51, .253)
        p.line([(.17, .208), (.51, .208)], (158, 186, 193), .002)
        p.text(.17, .186, "R / PS" if right_side else "L / PS", .010, (155, 162, 157))
    save(grip, "grip.png", "4096 squared charcoal grip atlas: white optical microtype, actual QR and pastel holographic identity stripe; left bottom/right top.")

    stock = image.copy()
    for right_side in (False, True):
        p = Paint(stock, (0, 0, 1.8, .85), (0, .52 if right_side else .02, 1, .98 if right_side else .48))
        circuits = [
            [( .11, .692), (.25, .692), (.31, .64), (.31, .584), (.43, .584)],
            [( .22, .742), (.38, .742), (.46, .68), (.61, .68)],
            [( .55, .584), (.66, .584), (.72, .63), (.85, .63)],
            [( .83, .742), (.83, .70), (.91, .655), (1.07, .655), (1.13, .70)],
            [(1.11, .55), (1.11, .59), (1.21, .62), (1.32, .62), (1.36, .68)],
            [(1.35, .735), (1.49, .735), (1.55, .685), (1.65, .685)],
        ]
        if right_side:
            circuits = [[(1.78 - x, z) for x, z in points] for points in circuits]
        for index, points in enumerate(circuits):
            p.line(points, WHITE if index % 2 == 0 else (148, 154, 149), .0023)
            p.circle(*points[0], .006, WHITE)
            p.circle(*points[-1], .009, fill=None, outline=WHITE, width=.002)
        p.text(.60, .754, "P R I N T S T R E A M", .014, WHITE, width=.40)
        p.text(.62, .567, "OPTICAL SYSTEM / 015", .010, (166, 173, 167), width=.30)
        for index, x in enumerate(np.linspace(.15, 1.65, 13)):
            p.cross(float(x), .53 + .019 * (index % 2), .006, (174, 180, 174), .0013)
            if index % 3 == 0:
                p.text(float(x) + .015, .536, f"{index:02}", .008, (148, 154, 149))
        p.corners(.10, .49, 1.70, .79, .026, (118, 125, 119), .0012)
        p.text(1.40, .46, "PS / R" if right_side else "PS / L", .012, WHITE, width=.17)
    save(stock, "stock.png", "4096 squared stock atlas; sparse white circuit routing and optical technical lettering, independently composed left/right.")


def smooth_noise(rng, size, cells, blur=0):
    coarse = Image.fromarray(rng.integers(0, 256, (cells, cells), dtype=np.uint8))
    image = coarse.resize((size, size), Image.Resampling.BICUBIC)
    if blur:
        image = image.filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(image, dtype=np.float32) / 255


def normal_from_height(height: np.ndarray, strength: float) -> Image.Image:
    # Image rows run down, whereas OpenGL tangent-space v runs up.
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength
    inverse_length = 1 / np.sqrt(dx * dx + dy * dy + 1)
    encoded = np.empty((*height.shape, 3), dtype=np.uint8)
    encoded[:, :, 0] = np.clip((-dx * inverse_length * .5 + .5) * 255 + .5, 0, 255)
    encoded[:, :, 1] = np.clip((dy * inverse_length * .5 + .5) * 255 + .5, 0, 255)
    encoded[:, :, 2] = np.clip((inverse_length * .5 + .5) * 255 + .5, 0, 255)
    return Image.fromarray(encoded)


def pbr_maps():
    rng = np.random.default_rng(SEED + 40)
    pearl = smooth_noise(rng, DATA_SIZE, 220, 1.1)
    rough = .32 + .08 * smooth_noise(rng, DATA_SIZE, 72, 2)
    save(Image.fromarray(np.clip(rough * 255 + .5, 0, 255).astype(np.uint8)), "pearl_roughness.png", "2048 squared linear absolute roughness, bounded .32-.40.", True)
    save(normal_from_height(pearl, .28), "pearl_normal.png", "2048 squared very subtle coated-surface OpenGL tangent normal.", True)
    grains = .76 * smooth_noise(rng, DATA_SIZE, 460, .6) + .24 * smooth_noise(rng, DATA_SIZE, 125, 1)
    grains = np.clip((grains - .28) * 1.7, 0, 1)
    save(normal_from_height(grains, 5.8), "polymer_normal.png", "2048 squared coarse irregular molded stipple, OpenGL tangent-space +Y.", True)
    rough = .70 + .10 * np.clip(grains, 0, 1)
    save(Image.fromarray((rough * 255 + .5).astype(np.uint8)), "polymer_roughness.png", "2048 squared linear absolute polymer roughness, bounded .70-.80.", True)
    u = np.linspace(0, 1, DATA_SIZE, dtype=np.float32)[None, :]
    v = np.linspace(1, 0, DATA_SIZE, dtype=np.float32)[:, None]
    film = .50 + .22 * np.sin(2 * math.pi * (u * 1.1 + v * .7)) + .17 * np.sin(2 * math.pi * (v * 1.8 - u * .22))
    save(Image.fromarray((np.clip(film, 0, 1) * 255 + .5).astype(np.uint8)), "pearl_film.png", "2048 squared linear thin-film thickness. G interpolates 250..450 nm; spatial film interference, not base-color rainbow or baked light.", True)
    v_holo = np.linspace(1, 0, 512, dtype=np.float32)[:, None]
    film_holo = .06 + .88 * np.mod(u * .87 + v_holo * .13, 1)
    save(Image.fromarray((film_holo * 255 + .5).astype(np.uint8)), "holo_film.png", "2048x512 linear optical stripe film thickness; G maps to 250..450 nm.", True)


def main():
    global OUTPUT, REFERENCE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "assets" / "textures")
    parser.add_argument("--font-dir", type=Path, default=Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts")
    parser.add_argument("--only", choices=("all", "cylinders"), default="all",
                        help="Regenerate all maps, or only suppressor.png and handguard.png")
    args = parser.parse_args()
    OUTPUT = args.output.resolve()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with (ROOT / "assets" / "materials.json").open(encoding="utf-8") as stream:
        REFERENCE = json.load(stream)["referenceImage"]
    for name, filename in FONT_FILES.items():
        path = args.font_dir / filename
        if not path.is_file():
            raise FileNotFoundError(f"Required font missing: {path}. Use --font-dir to point at the four named font files.")
        FONTS[name] = ImageFont.truetype(str(path), 128)
    if args.only == "cylinders":
        suppressor()
        handguard()
        print(json.dumps({"output": str(OUTPUT), "seed": SEED, "baseColorResolution": SIZE,
                          "authoredFiles": ["suppressor.png", "handguard.png"]}, indent=2))
        return
    holo = hologram()
    save(holo, "holo.png", "4096x1024 actual pastel rainbow optical stripe, with fine ruling and technical identifiers.")
    receiver(holo)
    suppressor()
    handguard()
    magazine()
    polymer(holo)
    pbr_maps()
    print(json.dumps({"output": str(OUTPUT), "seed": SEED, "baseColorResolution": SIZE, "dataResolution": DATA_SIZE,
                      "authoredFiles": ["receiver.png", "suppressor.png", "handguard.png", "magazine.png", "polymer.png", "grip.png", "stock.png", "holo.png", "pearl_roughness.png", "pearl_normal.png", "polymer_roughness.png", "polymer_normal.png", "pearl_film.png", "holo_film.png"]}, indent=2))


if __name__ == "__main__":
    main()
