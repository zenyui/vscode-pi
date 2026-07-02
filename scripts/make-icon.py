#!/usr/bin/env python3
"""Generate images/icon.png (128x128) with pure stdlib.

Design: dark gradient background, a bright "pi" glyph, and three broadcast
arcs in the upper-right hinting at context being shared with the agent.
"""
import math
import os
import struct
import zlib

W = H = 128


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def blend(dst, src, alpha):
    return tuple(round(dst[i] * (1 - alpha) + src[i] * alpha) for i in range(3))


# --- background gradient ---
TOP = (0x1E, 0x20, 0x30)
BOT = (0x2B, 0x2E, 0x48)
ACCENT = (0x8A, 0xB4, 0xF8)

px = [[lerp(TOP, BOT, y / (H - 1)) for _ in range(W)] for y in range(H)]


def fill_rect(x0, y0, x1, y1, color):
    for y in range(max(0, y0), min(H, y1)):
        for x in range(max(0, x0), min(W, x1)):
            px[y][x] = color


# --- pi glyph (thick strokes) ---
# top bar
fill_rect(30, 44, 100, 56, ACCENT)
# left leg
fill_rect(42, 56, 56, 96, ACCENT)
# right leg (slight foot flare)
fill_rect(78, 56, 92, 96, ACCENT)

# --- broadcast arcs, upper-right corner ---
cx, cy = 104, 26
for radius, alpha in ((14, 0.9), (24, 0.55), (34, 0.3)):
    thick = 3.0
    for y in range(H):
        for x in range(W):
            dx, dy = x - cx, y - cy
            d = math.hypot(dx, dy)
            if abs(d - radius) <= thick / 2:
                ang = math.atan2(dy, dx)  # 0 = +x (right)
                # draw the lower-left facing quarter so it "broadcasts" inward
                if math.radians(100) <= ang <= math.radians(190):
                    px[y][x] = blend(px[y][x], ACCENT, alpha)

# beacon dot
for y in range(H):
    for x in range(W):
        if math.hypot(x - cx, y - cy) <= 4:
            px[y][x] = ACCENT

# --- encode PNG (RGB, no filter) ---
raw = bytearray()
for y in range(H):
    raw.append(0)  # filter type 0
    for x in range(W):
        raw.extend(px[y][x])


def chunk(tag, data):
    c = tag + data
    return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)


png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
png += chunk(b"IEND", b"")

out = os.path.join(os.path.dirname(__file__), "..", "images", "icon.png")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "wb") as f:
    f.write(png)
print("wrote", os.path.abspath(out), len(png), "bytes")
