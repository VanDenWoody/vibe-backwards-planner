"""Generate the app icons. Run: python tools/make-icons.py"""

import os
import struct
import zlib

BACKGROUND = (31, 41, 55)  # #1f2937
FOREGROUND = (249, 250, 251)  # #f9fafb

# (x0, y0, x1, y1) as fractions of the canvas, inside the maskable safe zone.
BARS = [
    (0.22, 0.28, 0.78, 0.38),
    (0.22, 0.45, 0.62, 0.55),
    (0.22, 0.62, 0.46, 0.72),
]


def chunk(tag, data):
    body = tag + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def write_icon(path, size):
    rects = [
        (int(x0 * size), int(y0 * size), int(x1 * size), int(y1 * size))
        for x0, y0, x1, y1 in BARS
    ]

    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type: none
        for x in range(size):
            colour = BACKGROUND
            for x0, y0, x1, y1 in rects:
                if x0 <= x < x1 and y0 <= y < y1:
                    colour = FOREGROUND
                    break
            raw.extend(colour)

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    with open(path, "wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n")
        handle.write(chunk(b"IHDR", header))
        handle.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        handle.write(chunk(b"IEND", b""))
    print(f"wrote {path} ({size}x{size})")


if __name__ == "__main__":
    os.makedirs("icons", exist_ok=True)
    write_icon(os.path.join("icons", "icon-192.png"), 192)
    write_icon(os.path.join("icons", "icon-512.png"), 512)
