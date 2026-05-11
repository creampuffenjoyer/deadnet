"""
VO1D — LSB Steganography Flag Embedder
Contract: DEAD MEN TELL NOT TALE (Contract 2)
Flag: V01D{pr3tty_b4s1c_f0r_a_d3ad_m4n}

Creates a 256x256 decorative DEADNET background image and embeds the flag
using LSB (Least Significant Bit) steganography in the red channel.

Usage:
    python scripts/embed_flag.py

Output:
    frontend/public/deadnet-bg.png  — committed carrier image

To verify:
    python scripts/embed_flag.py --verify

Re-run if the image is regenerated from scratch.
Tools to extract: zsteg, stegsolve, stegpy, or the LSB extraction snippet below.

Manual extraction (Python):
    from PIL import Image
    img = Image.open("frontend/public/deadnet-bg.png").convert("RGB")
    px = list(img.getdata())
    bits = ''.join(str(r & 1) for r, g, b in px)
    n = int(bits[:16], 2)
    chars = [chr(int(bits[16 + i*8:16 + i*8 + 8], 2)) for i in range(n)]
    print(''.join(chars))
"""

import argparse
import os
import random

try:
    from PIL import Image, ImageDraw
except ImportError:
    print("Install Pillow: pip install Pillow")
    raise

FLAG = "V01D{pr3tty_b4s1c_f0r_a_d3ad_m4n}"
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "deadnet-bg.png")
SIZE = 256

random.seed(0xDEAD)  # deterministic output


def make_carrier() -> Image.Image:
    """Create a 256x256 dark noise grid image — DEADNET aesthetic."""
    img = Image.new("RGB", (SIZE, SIZE), (8, 8, 16))
    draw = ImageDraw.Draw(img)

    # Subtle grid lines
    for x in range(0, SIZE, 16):
        col = (random.randint(12, 22), random.randint(12, 22), random.randint(18, 28))
        draw.line([(x, 0), (x, SIZE)], fill=col, width=1)
    for y in range(0, SIZE, 16):
        col = (random.randint(12, 22), random.randint(12, 22), random.randint(18, 28))
        draw.line([(0, y), (SIZE, y)], fill=col, width=1)

    # Random noise pixels — gives more steg capacity + authentic noise look
    pixels = img.load()
    for _ in range(SIZE * SIZE // 3):
        x = random.randint(0, SIZE - 1)
        y = random.randint(0, SIZE - 1)
        v = random.randint(8, 30)
        pixels[x, y] = (v, v, v + random.randint(0, 5))

    # Ember dot cluster (decorative, top-left corner, low-opacity)
    for _ in range(80):
        x = random.randint(0, 32)
        y = random.randint(0, 32)
        pixels[x, y] = (random.randint(40, 80), random.randint(10, 30), random.randint(0, 10))

    return img


def embed(img: Image.Image, message: str) -> Image.Image:
    """Embed message string into the red LSB channel of img."""
    pixels = list(img.getdata())
    total_pixels = len(pixels)

    length = len(message)
    # Store: 16-bit length header + 8 bits per char
    needed_bits = 16 + length * 8
    assert needed_bits <= total_pixels, f"Image too small: need {needed_bits} pixels, have {total_pixels}"

    bits = format(length, '016b') + ''.join(format(ord(c), '08b') for c in message)

    new_pixels = []
    for i, (r, g, b) in enumerate(pixels):
        if i < len(bits):
            r = (r & 0xFE) | int(bits[i])
        new_pixels.append((r, g, b))

    out = Image.new("RGB", img.size)
    out.putdata(new_pixels)
    return out


def extract(img: Image.Image) -> str:
    """Extract LSB-encoded message from red channel."""
    pixels = list(img.getdata())
    bits = ''.join(str(r & 1) for r, g, b in pixels)
    length = int(bits[:16], 2)
    chars = []
    for i in range(length):
        byte = bits[16 + i * 8: 16 + i * 8 + 8]
        chars.append(chr(int(byte, 2)))
    return ''.join(chars)


def main():
    parser = argparse.ArgumentParser(description="VO1D flag embedder")
    parser.add_argument("--verify", action="store_true", help="Extract and verify flag from existing image")
    args = parser.parse_args()

    out_path = os.path.normpath(OUT_PATH)

    if args.verify:
        img = Image.open(out_path).convert("RGB")
        extracted = extract(img)
        print(f"Extracted: {extracted}")
        print(f"Match: {extracted == FLAG}")
        return

    carrier = make_carrier()
    result = embed(carrier, FLAG)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    result.save(out_path, "PNG")
    print(f"Saved: {out_path}")
    print(f"Flag embedded: {FLAG}")

    # Quick self-check
    verified = extract(Image.open(out_path).convert("RGB"))
    assert verified == FLAG, f"Verification failed: got {verified!r}"
    print("Verification: OK")


if __name__ == "__main__":
    main()
