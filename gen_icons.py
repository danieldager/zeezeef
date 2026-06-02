#!/usr/bin/env python3
"""Generate placeholder PNG icons (16/48/128) for the extension.

Pure stdlib (zlib + struct + crc32) so it runs without PIL/ImageMagick.
Draws a dark "card" with an X-blue accent block and two lighter text lines,
evoking a captured post. Placeholder only — replace with real art later.
"""
import struct
import zlib

BG = (21, 32, 43, 255)        # X dim navy  #15202B
ACCENT = (29, 155, 240, 255)  # X blue      #1D9BF0
LINE = (230, 236, 240, 255)   # near-white text line


def _px(x, y, n):
    """Return RGBA tuple for pixel (x, y) in an n*n icon."""
    m = max(1, n // 16)  # margin scaled to size
    # rounded-ish card region
    if m <= x < n - m and m <= y < n - m:
        inner_top = m + max(1, n // 8)
        # accent header bar
        if y < inner_top:
            return ACCENT
        # two "text lines"
        line_h = max(1, n // 16)
        gap = max(1, n // 12)
        l1 = inner_top + gap
        l2 = l1 + line_h + gap
        if l1 <= y < l1 + line_h and (m + gap) <= x < (n - m - gap):
            return LINE
        if l2 <= y < l2 + line_h and (m + gap) <= x < (n - 2 * gap):
            return LINE
        # card body
        return (32, 47, 61, 255)
    return BG


def make_png(n):
    raw = bytearray()
    for y in range(n):
        raw.append(0)  # filter type 0 (None) per scanline
        for x in range(n):
            raw.extend(_px(x, y, n))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return c + struct.pack(">I", crc)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(bytes(raw), 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


for size in (16, 48, 128):
    with open(f"icons/icon{size}.png", "wb") as f:
        f.write(make_png(size))
    print(f"wrote icons/icon{size}.png")
