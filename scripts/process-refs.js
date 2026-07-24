/**
 * Punch out backgrounds from reference art → transparent PNG assets.
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const root = path.join(__dirname, '..');
const calico = path.join(root, 'themes', 'calico', 'assets');
const assets = path.join(root, 'assets');

function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

function writePng(file, png) {
  fs.writeFileSync(file, PNG.sync.write(png));
  console.log('wrote', path.relative(root, file), `${png.width}x${png.height}`);
}

/** Remove near-white / light-gray paper background from cat art */
function punchWhite(png, threshold = 245, soft = 18) {
  const { width, height, data } = png;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a === 0) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // Paper white / light gray (low saturation, high value)
    if (max >= threshold && max - min <= soft) {
      data[i + 3] = 0;
      continue;
    }
    // Soft fringe near white
    if (max > 220 && max - min < 30) {
      const t = (max - 220) / (255 - 220);
      data[i + 3] = Math.round(a * (1 - t * 0.95));
    }
  }
  return png;
}

/** Crop to non-transparent bounds with padding */
function autocrop(png, pad = 8) {
  const { width, height, data } = png;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a > 8) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return png;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((minY + y) * width + (minX + x)) * 4;
      const di = (y * w + x) * 4;
      out.data[di] = data[si];
      out.data[di + 1] = data[si + 1];
      out.data[di + 2] = data[si + 2];
      out.data[di + 3] = data[si + 3];
    }
  }
  return out;
}

/**
 * Black hole: keep glowing disk + event horizon; fade deep space/nebula/stars to transparent.
 * Tuned for Interstellar-style plates (golden disk, blue dust, starfield).
 */
function punchSpace(png) {
  const { width, height, data } = png;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const maxR = Math.min(width, height) * 0.5;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const warm = r * 0.55 + g * 0.4 - b * 0.35;
      const cool = b - Math.max(r, g) * 0.55;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / maxR;

      // Event horizon core — solid opaque black
      if (dist < 0.26 && lum < 48) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
        continue;
      }

      // Isolated star speckles / lens flares — punch out
      if (sat < 28 && lum > 140 && dist > 0.42) {
        data[i + 3] = 0;
        continue;
      }

      // Cool blue/grey nebula & dust — fade hard (desktop pet needs transparency)
      if (cool > 12 && warm < 35 && lum < 90) {
        const keep = Math.max(0, 1 - dist * 1.15) * Math.max(0, (lum - 25) / 70) * 0.22;
        data[i + 3] = Math.round(Math.min(data[i + 3], keep * 255));
        continue;
      }

      // Bright accretion / photon ring / lensed halo — keep
      if (lum > 48 || warm > 42) {
        let alpha = 255;
        if (dist > 0.78) alpha = Math.round(255 * Math.max(0, 1 - (dist - 0.78) / 0.42));
        if (lum < 70 && dist > 0.62) alpha = Math.min(alpha, Math.round((lum / 70) * 255));
        // Soft outer wisps of golden disk
        if (warm > 30 && lum > 28 && dist < 0.95) {
          alpha = Math.max(alpha, Math.round(Math.min(255, warm * 2.2 + lum)));
        }
        data[i + 3] = Math.min(data[i + 3], alpha);
        continue;
      }

      // Dim outer space — mostly transparent
      if (dist > 0.52) {
        const keep = Math.max(0, (lum - 22) / 55) * Math.max(0, 1.05 - dist) * (warm > 20 ? 0.55 : 0.2);
        data[i + 3] = Math.round(Math.min(data[i + 3], keep * 200));
        continue;
      }

      // Mid dark zones between disk filaments
      if (lum < 38) {
        if (dist < 0.36) {
          data[i + 3] = 255;
          data[i] = data[i + 1] = data[i + 2] = 0;
        } else {
          data[i + 3] = Math.round(Math.min(data[i + 3], (lum / 38) * 55));
        }
        continue;
      }

      // Soft keep for mid glow
      data[i + 3] = Math.round(Math.min(data[i + 3], 50 + lum * 2.0 + Math.max(0, warm) * 0.8));
    }
  }
  return png;
}

/** Slight vertical squash for a second chew frame (cheek bounce) */
function chewVariant(png, scaleY = 0.94) {
  const { width, height } = png;
  const out = new PNG({ width, height });
  out.data.fill(0);
  const cy = height * 0.55;
  for (let y = 0; y < height; y++) {
    const srcY = Math.round(cy + (y - cy) / scaleY);
    if (srcY < 0 || srcY >= height) continue;
    for (let x = 0; x < width; x++) {
      // Slight horizontal puff at cheeks
      const mid = width * 0.5;
      const puff = 1 + 0.03 * Math.exp(-Math.pow((y - cy) / (height * 0.15), 2));
      const srcX = Math.round(mid + (x - mid) / puff);
      if (srcX < 0 || srcX >= width) continue;
      const si = (srcY * width + srcX) * 4;
      const di = (y * width + x) * 4;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = png.data[si + 3];
    }
  }
  return out;
}

function processCat(srcName, outName) {
  let png = readPng(path.join(calico, srcName));
  png = punchWhite(png);
  png = autocrop(png, 12);
  writePng(path.join(calico, outName), png);
  return png;
}

function main() {
  const open = processCat('calico-eat-open-src.png', 'calico-eat-open.png');
  const chew = processCat('calico-eat-chew-src.png', 'calico-eat-chew.png');
  writePng(path.join(calico, 'calico-eat-chew2.png'), chewVariant(chew, 0.93));
  writePng(path.join(calico, 'calico-eat-chew3.png'), chewVariant(chew, 1.05));

  let bh = readPng(path.join(assets, 'blackhole-ref.png'));
  bh = punchSpace(bh);
  bh = autocrop(bh, 4);
  writePng(path.join(assets, 'blackhole.png'), bh);
}

main();
