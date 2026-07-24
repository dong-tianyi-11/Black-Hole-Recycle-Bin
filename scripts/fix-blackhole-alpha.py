from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(r"d:\my-program\Black Hole Recycle Bin")
src = ROOT / "assets" / "blackhole-ref.png"
out = ROOT / "assets" / "blackhole.png"

img = Image.open(src).convert("RGBA")
arr = np.array(img).astype(np.float32)
h, w = arr.shape[:2]
yy, xx = np.mgrid[0:h, 0:w]
cx, cy = w * 0.5, h * 0.52
max_r = min(w, h) * 0.42
dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / max_r

r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
warm = r * 0.6 + g * 0.35 - b * 0.2

alpha = np.zeros((h, w), dtype=np.float32)

core = dist < 0.28
arr[core, 0:3] = 0
alpha[core] = 255

glow = ((lum > 40) | (warm > 28)) & (dist < 1.05)
fall = np.clip(1.15 - dist, 0, 1)
alpha[glow] = np.clip(
    fall[glow] * 255 * np.clip((lum[glow] + warm[glow]) / 80.0, 0.35, 1.0), 0, 255
)

corona = (warm > 12) & (lum > 18) & (dist < 1.15) & ~glow & ~core
alpha[corona] = np.clip((warm[corona] / 40.0) * fall[corona] * 160, 0, 180)

alpha[dist > 1.12] = 0
edge = (dist > 0.95) & (dist <= 1.12)
alpha[edge] *= np.clip((1.12 - dist[edge]) / 0.17, 0, 1)

arr[:, :, 3] = alpha
im = Image.fromarray(arr.astype(np.uint8), "RGBA")

a = np.array(im)
ys, xs = np.where(a[:, :, 3] > 8)
pad = 8
x0, x1 = max(0, int(xs.min()) - pad), min(w - 1, int(xs.max()) + pad)
y0, y1 = max(0, int(ys.min()) - pad), min(h - 1, int(ys.max()) + pad)
im = im.crop((x0, y0, x1 + 1, y1 + 1))
if max(im.size) > 720:
    ratio = 720 / max(im.size)
    im = im.resize((int(im.size[0] * ratio), int(im.size[1] * ratio)), Image.Resampling.LANCZOS)
im.save(out, "PNG")
a2 = np.array(im)
print(
    "saved",
    im.size,
    "alpha0%",
    round((a2[:, :, 3] == 0).mean() * 100, 1),
    "opaque%",
    round((a2[:, :, 3] > 200).mean() * 100, 1),
)
