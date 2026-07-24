"""Pad eat PNGs so the cat matches idle visual size (less tight crop)."""
from pathlib import Path
from PIL import Image

CALICO = Path(r"d:\my-program\Black Hole Recycle Bin\themes\calico\assets")
# Idle SVG has lots of margin; eat art was autocropped tight → looks bigger.
# Pad so subject ~68% of canvas (closer to idle framing).
TARGET_FILL = 0.68

FILES = [
    "calico-eat-open.png",
    "calico-eat-chew.png",
    "calico-eat-chew2.png",
    "calico-eat-chew3.png",
]


def pad_to_fill(path: Path, fill: float):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    # Current fill ≈ 1.0 after autocrop; expand canvas
    nw = int(w / fill)
    nh = int(h / fill)
    # Keep aspect similar to calico window (266:200 ≈ 1.33)
    aspect = 266 / 200
    if nw / nh > aspect:
        nh = int(nw / aspect)
    else:
        nw = int(nh * aspect)
    canvas = Image.new("RGBA", (nw, nh), (0, 0, 0, 0))
    x = (nw - w) // 2
    y = nh - h - int(nh * 0.06)  # sit near bottom like idle
    canvas.paste(im, (x, max(0, y)), im)
    canvas.save(path, "PNG")
    print(f"{path.name}: {w}x{h} -> {nw}x{nh}")


def main():
    for name in FILES:
        p = CALICO / name
        if p.exists():
            pad_to_fill(p, TARGET_FILL)


if __name__ == "__main__":
    main()
