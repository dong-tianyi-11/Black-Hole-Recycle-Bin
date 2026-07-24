"""Flood-fill remove paper background from cat JPEGs; punch space from black hole."""
from pathlib import Path
from collections import deque
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CALICO = ROOT / "themes" / "calico" / "assets"
ASSETS = ROOT / "assets"


def autocrop_rgba(img: Image.Image, pad=12) -> Image.Image:
    arr = np.array(img)
    alpha = arr[:, :, 3]
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        return img
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(arr.shape[1] - 1, x1 + pad)
    y1 = min(arr.shape[0] - 1, y1 + pad)
    return img.crop((x0, y0, x1 + 1, y1 + 1))


def is_paper(r, g, b, thr=248, sat=28):
    mx = max(r, g, b)
    mn = min(r, g, b)
    return mx >= thr and (mx - mn) <= sat


def flood_punch_paper(img: Image.Image) -> Image.Image:
    """Remove only background white connected to image edges (keeps cream fur)."""
    img = img.convert("RGBA")
    arr = np.array(img)
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3].astype(np.int16)
    paper = np.zeros((h, w), dtype=bool)
    for y in range(h):
        for x in range(w):
            r, g, b = rgb[y, x]
            paper[y, x] = is_paper(int(r), int(g), int(b))

    # Slightly looser near edges for fringe
    visited = np.zeros((h, w), dtype=bool)
    q = deque()

    def try_push(x, y):
        if x < 0 or y < 0 or x >= w or y >= h:
            return
        if visited[y, x]:
            return
        r, g, b = map(int, rgb[y, x])
        mx = max(r, g, b)
        mn = min(r, g, b)
        # Edge flood: pure paper OR very light fringe
        if (mx >= 248 and mx - mn <= 28) or (mx >= 235 and mx - mn <= 18):
            visited[y, x] = True
            q.append((x, y))

    for x in range(w):
        try_push(x, 0)
        try_push(x, h - 1)
    for y in range(h):
        try_push(0, y)
        try_push(w - 1, y)

    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            try_push(x + dx, y + dy)

    alpha = arr[:, :, 3].astype(np.float32)
    alpha[visited] = 0

    # Soften fringe: near-transparent neighbors of punched pixels that are still light
    from scipy import ndimage  # may not exist

    arr[:, :, 3] = alpha.astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def flood_punch_paper_nosci(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    arr = np.array(img)
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3].astype(np.int16)
    visited = np.zeros((h, w), dtype=bool)
    q = deque()

    def ok_bg(r, g, b, loose=False):
        mx = max(r, g, b)
        mn = min(r, g, b)
        if loose:
            return mx >= 230 and (mx - mn) <= 22
        return mx >= 246 and (mx - mn) <= 30

    def try_push(x, y, loose=False):
        if x < 0 or y < 0 or x >= w or y >= h or visited[y, x]:
            return
        r, g, b = map(int, rgb[y, x])
        if ok_bg(r, g, b, loose=loose):
            visited[y, x] = True
            q.append((x, y))

    for x in range(w):
        try_push(x, 0, True)
        try_push(x, h - 1, True)
    for y in range(h):
        try_push(0, y, True)
        try_push(w - 1, y, True)

    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, 1), (1, -1), (-1, -1)):
            nx, ny = x + dx, y + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h or visited[ny, nx]:
                continue
            r, g, b = map(int, rgb[ny, nx])
            # Once connected to bg, allow slightly creamier fringe only if very bright
            if ok_bg(r, g, b, loose=False) or (max(r, g, b) >= 250 and max(r, g, b) - min(r, g, b) <= 12):
                visited[ny, nx] = True
                q.append((nx, ny))

    alpha = arr[:, :, 3].astype(np.float32)
    alpha[visited] = 0

    # Anti-aliased edge: light pixels adjacent to punched get partial alpha
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if visited[y, x] or alpha[y, x] == 0:
                continue
            r, g, b = map(int, rgb[y, x])
            mx = max(r, g, b)
            mn = min(r, g, b)
            if mx < 220 or mx - mn > 40:
                continue
            near = visited[y - 1:y + 2, x - 1:x + 2].sum()
            if near > 0:
                t = min(1.0, near / 5.0) * ((mx - 220) / 35.0)
                alpha[y, x] *= max(0.0, 1.0 - t)

    arr[:, :, 3] = np.clip(alpha, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def chew_variant(img: Image.Image, scale_y=0.94, puff=1.04) -> Image.Image:
    w, h = img.size
    mid = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    nh = max(1, int(h * scale_y))
    scaled = img.resize((w, nh), Image.Resampling.LANCZOS)
    yoff = (h - nh) // 2 + int(h * 0.03)
    mid.paste(scaled, (0, yoff), scaled)
    nw = max(1, int(w * puff))
    puffed = mid.resize((nw, h), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(puffed, ((w - nw) // 2, 0), puffed)
    return out


def process_cat(src: Path, dst: Path):
    img = Image.open(src).convert("RGBA")
    img = flood_punch_paper_nosci(img)
    img = autocrop_rgba(img, 16)
    img.save(dst, "PNG")
    print(f"wrote {dst.name} {img.size}")
    return img


def punch_space(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    arr = np.array(img).astype(np.float32)
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = w * 0.5, h * 0.52
    max_r = min(w, h) * 0.46
    dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / max_r

    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    warm = r * 0.55 + g * 0.4 - b * 0.25
    alpha = np.full((h, w), 255.0, dtype=np.float32)

    core = (dist < 0.20) & (lum < 50)
    arr[core, 0:3] = 0

    # Keep bright accretion strongly
    bright = (lum > 48) | (warm > 40)
    # Space: dark + not warm
    space = (lum < 42) & (warm < 25) & ~core
    # Stronger remove far from center
    far = dist > 0.72
    alpha[space & far] = np.clip((lum[space & far] - 10) / 40.0, 0, 1) * 30
    alpha[space & ~far & (dist > 0.45)] = np.clip((lum[space & ~far & (dist > 0.45)] / 42.0), 0, 1) * 80
    # Soft outer glow keep for warm pixels
    alpha[bright] = 255
    alpha[bright & (dist > 0.9)] = np.clip(255 * (1.2 - dist[bright & (dist > 0.9)]), 0, 255)
    # Dim mid
    mid = ~bright & ~core & ~space
    alpha[mid] = np.clip(lum[mid] * 2.2, 0, 200)

    # Force core opaque black
    alpha[core] = 255

    arr[:, :, 3] = np.clip(alpha, 0, 255)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def main():
    open_img = process_cat(CALICO / "calico-eat-open-src.png", CALICO / "calico-eat-open.png")
    chew_img = process_cat(CALICO / "calico-eat-chew-src.png", CALICO / "calico-eat-chew.png")

    # Match sizes for smooth frame swap
    size = (
        max(open_img.size[0], chew_img.size[0]),
        max(open_img.size[1], chew_img.size[1]),
    )

    def fit(im):
        canvas = Image.new("RGBA", size, (0, 0, 0, 0))
        x = (size[0] - im.size[0]) // 2
        y = size[1] - im.size[1]  # bottom-align
        canvas.paste(im, (x, y), im)
        return canvas

    open_f = fit(open_img)
    chew_f = fit(chew_img)
    open_f.save(CALICO / "calico-eat-open.png", "PNG")
    chew_f.save(CALICO / "calico-eat-chew.png", "PNG")

    v2 = fit(autocrop_rgba(chew_variant(chew_img, 0.91, 1.06), 2))
    v3 = fit(autocrop_rgba(chew_variant(chew_img, 1.03, 0.97), 2))
    v2.save(CALICO / "calico-eat-chew2.png", "PNG")
    v3.save(CALICO / "calico-eat-chew3.png", "PNG")
    print("wrote aligned eat frames", size)

    bh = punch_space(Image.open(ASSETS / "blackhole-ref.png"))
    bh = autocrop_rgba(bh, 4)
    if max(bh.size) > 720:
        ratio = 720 / max(bh.size)
        bh = bh.resize((int(bh.size[0] * ratio), int(bh.size[1] * ratio)), Image.Resampling.LANCZOS)
    bh.save(ASSETS / "blackhole.png", "PNG")
    print(f"wrote blackhole.png {bh.size}")


if __name__ == "__main__":
    main()
