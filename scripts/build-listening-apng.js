/**
 * Process listening PNGs (watermark + black/checker → alpha),
 * build bobbing APNGs for danchen states + calico/danchen listening.
 *
 * Safe rules:
 * - Never flood pure white (sticker / white clothes / white fur)
 * - Watermark: drop pixels outside bright-sticker bbox + small islands
 * - White rim: peel only pure-white sticker touching transparency, stop at colored edge
 */
const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');
const { encodeApng } = require('./encode-apng');

const ROOT = path.join(__dirname, '..');
const ASSET_DIR = path.join(
  process.env.USERPROFILE || '',
  '.cursor/projects/d-my-program-Black-Hole-Recycle-Bin/assets'
);

function findSrc(fragment) {
  const hit = fs.readdirSync(ASSET_DIR).find((f) => f.includes(fragment));
  if (!hit) throw new Error('missing ' + fragment);
  return path.join(ASSET_DIR, hit);
}

function isFlatNeutral(r, g, b, a) {
  if (a < 12) return true;
  const avg = (r + g + b) / 3;
  const c = Math.max(r, g, b) - Math.min(r, g, b);
  if (c > 8) return false;
  if (Math.abs(r - g) > 5 || Math.abs(g - b) > 5 || Math.abs(r - b) > 5) return false;
  return avg >= 198 || avg <= 18;
}

/** Black / checker only — never pure white. */
function isBgPixel(data, x, y, width, height) {
  const i = (y * width + x) * 4;
  const a = data[i + 3];
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  if (a < 12) return true;
  const avg = (r + g + b) / 3;
  const c = Math.max(r, g, b) - Math.min(r, g, b);
  if (avg <= 28 && c <= 14) return true;
  if (!isFlatNeutral(r, g, b, a)) return false;
  if (avg >= 250) return false;
  let alt = 0;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
      alt++;
      continue;
    }
    const ni = (ny * width + nx) * 4;
    if (data[ni + 3] < 12) {
      alt++;
      continue;
    }
    const navg = (data[ni] + data[ni + 1] + data[ni + 2]) / 3;
    if (
      isFlatNeutral(data[ni], data[ni + 1], data[ni + 2], data[ni + 3]) &&
      Math.abs(navg - avg) >= 10
    ) {
      alt++;
    }
  }
  return avg >= 200 && avg <= 248 && alt >= 1;
}

function floodBgToAlpha(img) {
  const { width, height, data } = img.bitmap;
  const seen = new Uint8Array(width * height);
  const q = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (seen[p]) return;
    if (!isBgPixel(data, x, y, width, height)) return;
    seen[p] = 1;
    q.push(p);
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  let qi = 0;
  while (qi < q.length) {
    const p = q[qi++];
    data[p * 4 + 3] = 0;
    const x = p % width;
    const y = (p - x) / width;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
}

/** Clear Doubao caption outside the bright sticker bbox. */
function clearOutsideStickerBBox(img, pad = 2) {
  const { width, height, data } = img.bitmap;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 20) continue;
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const c =
        Math.max(data[i], data[i + 1], data[i + 2]) -
        Math.min(data[i], data[i + 1], data[i + 2]);
      if (avg < 230 || c > 30) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return 0;
  const x1 = Math.min(width - 1, maxX + pad);
  const y1 = Math.min(height - 1, maxY + pad);
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x <= x1 && y <= y1) continue;
      const i = (y * width + x) * 4;
      if (data[i + 3] < 8) continue;
      data[i + 3] = 0;
      n++;
    }
  }
  // also wipe residual mid/dark caption tucked under sticker BR corner
  const y0 = Math.max(0, maxY - Math.round(height * 0.04));
  const x0 = Math.max(0, Math.floor(width * 0.62));
  for (let y = y0; y < height; y++) {
    for (let x = x0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 8) continue;
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const c =
        Math.max(data[i], data[i + 1], data[i + 2]) -
        Math.min(data[i], data[i + 1], data[i + 2]);
      if (avg <= 220 && c <= 55) {
        data[i + 3] = 0;
        n++;
      }
    }
  }
  return n;
}

/** Keep large components (body + notes); drop watermark islands. */
function dropSmallIslands(img, minKeep = 200) {
  const { width, height, data } = img.bitmap;
  const label = new Int32Array(width * height);
  const sizes = [];
  let lab = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (label[p] || data[p * 4 + 3] < 12) continue;
      lab++;
      let sz = 0;
      const q = [p];
      label[p] = lab;
      while (q.length) {
        const cur = q.pop();
        sz++;
        const cx = cur % width;
        const cy = (cur - cx) / width;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const np = ny * width + nx;
          if (label[np] || data[np * 4 + 3] < 12) continue;
          label[np] = lab;
          q.push(np);
        }
      }
      sizes[lab] = sz;
    }
  }
  let maxLab = 1;
  let maxSz = 0;
  for (let i = 1; i <= lab; i++) {
    if (sizes[i] > maxSz) {
      maxSz = sizes[i];
      maxLab = i;
    }
  }
  let killed = 0;
  for (let p = 0; p < width * height; p++) {
    const L = label[p];
    if (!L) continue;
    if (L === maxLab || sizes[L] >= minKeep) continue;
    data[p * 4 + 3] = 0;
    killed++;
  }
  return killed;
}

function isContentColored(r, g, b) {
  const avg = (r + g + b) / 3;
  const c = Math.max(r, g, b) - Math.min(r, g, b);
  if (c > 28) return true;
  if (avg < 215) return true;
  if (b > r + 8) return true;
  if (r > g + 10 && r > b + 10) return true;
  return false;
}

/** Peel pure-white sticker rim; stop when touching colored character pixels. */
function peelStickerRim(img, passes = 8) {
  const { width, height, data } = img.bitmap;
  let total = 0;
  for (let pass = 0; pass < passes; pass++) {
    const kill = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] < 8) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const avg = (r + g + b) / 3;
        const c = Math.max(r, g, b) - Math.min(r, g, b);
        if (avg < 246 || c > 16) continue;
        let t = 0;
        let colored = 0;
        let whiteN = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const ni = ((y + dy) * width + (x + dx)) * 4;
            if (data[ni + 3] < 20) {
              t++;
              continue;
            }
            if (isContentColored(data[ni], data[ni + 1], data[ni + 2])) colored++;
            else whiteN++;
          }
        }
        if (t < 2 || colored >= 1) continue;
        if (whiteN >= 1 || t >= 3) kill.push(i);
      }
    }
    for (const i of kill) data[i + 3] = 0;
    total += kill.length;
    if (!kill.length) break;
  }
  return total;
}

function defringeHair(img) {
  const { width, height, data } = img.bitmap;
  const out = Buffer.from(data);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      if (a < 24 || a > 250) continue;
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (avg < 195) continue;
      let t = 0;
      let dr = 0;
      let dg = 0;
      let db = 0;
      let dn = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = (ny * width + nx) * 4;
          if (data[ni + 3] < 20) {
            t++;
            continue;
          }
          const navg = (data[ni] + data[ni + 1] + data[ni + 2]) / 3;
          if (navg < 150 && data[ni] >= data[ni + 1] - 4 && data[ni] - data[ni + 2] > 6) {
            dr += data[ni];
            dg += data[ni + 1];
            db += data[ni + 2];
            dn++;
          }
        }
      }
      if (t < 2 || dn < 4) continue;
      const blend = 0.65;
      out[i] = Math.round(data[i] * (1 - blend) + (dr / dn) * blend);
      out[i + 1] = Math.round(data[i + 1] * (1 - blend) + (dg / dn) * blend);
      out[i + 2] = Math.round(data[i + 2] * (1 - blend) + (db / dn) * blend);
    }
  }
  data.set(out);
}

function contentBounds(img, alphaMin = 10) {
  const { width, height, data } = img.bitmap;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] >= alphaMin) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

async function placeOnCanvas(src, canvasSize, padBottom = 8, opts = {}) {
  let img = src.clone();
  floodBgToAlpha(img);
  const wiped = clearOutsideStickerBBox(img, 2);
  dropSmallIslands(img, opts.noteMin || 200);
  const peeled = peelStickerRim(img, opts.rimPasses ?? 8);
  if (opts.defringe) defringeHair(img);
  peelStickerRim(img, 2);
  dropSmallIslands(img, opts.noteMin || 200);
  clearOutsideStickerBBox(img, 1);

  const b = contentBounds(img);
  if (!b) throw new Error('empty after matte');
  const pad = 4;
  img = img.crop({
    x: Math.max(0, b.x - pad),
    y: Math.max(0, b.y - pad),
    w: Math.min(img.bitmap.width - Math.max(0, b.x - pad), b.w + pad * 2),
    h: Math.min(img.bitmap.height - Math.max(0, b.y - pad), b.h + pad * 2),
  });
  const max = canvasSize - padBottom - 4;
  const scale = Math.min(max / img.bitmap.width, max / img.bitmap.height, 1.15);
  const nw = Math.max(1, Math.round(img.bitmap.width * scale));
  const nh = Math.max(1, Math.round(img.bitmap.height * scale));
  img = img.resize({ w: nw, h: nh });
  const canvas = new Jimp({ width: canvasSize, height: canvasSize, color: 0x00000000 });
  canvas.composite(img, Math.round((canvasSize - nw) / 2), Math.max(0, canvasSize - padBottom - nh));
  peelStickerRim(canvas, opts.finalPeel ?? 2);
  dropSmallIslands(canvas, Math.max(60, Math.floor((opts.noteMin || 200) * scale * scale)));
  // wipe dust / caption remnants under feet
  {
    const { width, height, data } = canvas.bitmap;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] < 20) continue;
        if ((data[i] + data[i + 1] + data[i + 2]) / 3 >= 40) maxY = Math.max(maxY, y);
      }
    }
    for (let y = maxY + 3; y < height; y++) {
      for (let x = 0; x < width; x++) data[(y * width + x) * 4 + 3] = 0;
    }
  }
  console.log('matte wipe', wiped, 'peel', peeled);
  return canvas;
}

async function jimpToPngBuffer(img) {
  return img.getBuffer('image/png');
}

async function makeBobApng(baseImg, outPath, { frames = 8, delayMs = 90, amp = 4 } = {}) {
  const w = baseImg.bitmap.width;
  const h = baseImg.bitmap.height;
  const pngFrames = [];
  for (let i = 0; i < frames; i++) {
    const t = (i / frames) * Math.PI * 2;
    const dy = Math.round(Math.sin(t) * amp);
    const canvas = new Jimp({ width: w, height: h, color: 0x00000000 });
    canvas.composite(baseImg, 0, dy);
    pngFrames.push(await jimpToPngBuffer(canvas));
  }
  const apng = encodeApng(pngFrames, { delayMs, numPlays: 0 });
  fs.writeFileSync(outPath, apng);
  console.log('apng', path.basename(outPath), (apng.length / 1024).toFixed(1) + 'KB');
}

async function processListening(srcPath, outPng, canvasSize, opts = {}) {
  const src = await Jimp.read(srcPath);
  const placed = await placeOnCanvas(src, canvasSize, 8, opts);
  await placed.write(outPng);
  console.log('png', path.basename(outPng));
  return placed;
}

async function main() {
  const danchenAssets = path.join(ROOT, 'themes/danchen/assets');
  const calicoAssets = path.join(ROOT, 'themes/calico/assets');
  fs.mkdirSync(danchenAssets, { recursive: true });
  fs.mkdirSync(calicoAssets, { recursive: true });

  const only = (process.env.ONLY || '').trim();
  const doDanchen = !only || only.includes('danchen') || only.includes('listening');
  const doCalico = !only || only.includes('calico');
  const doLoops = !only || only === 'loops';

  if (doDanchen) {
    const danchenMusicSrc = findSrc('2f0d1fcf-db82-4fa6-9e80-032f571d7d4a');
    const danchenListen = await processListening(
      danchenMusicSrc,
      path.join(danchenAssets, 'listening.png'),
      512,
      { rimPasses: 16, defringe: true, noteMin: 80, finalPeel: 4 }
    );
    await makeBobApng(danchenListen, path.join(danchenAssets, 'listening.apng'), {
      frames: 10,
      delayMs: 90,
      amp: 5,
    });
  }

  if (doCalico) {
    const calicoMusicSrc = findSrc('736010e2-45c2-4642-b466-c2c4587ddf53');
    const calicoListen = await processListening(
      calicoMusicSrc,
      path.join(calicoAssets, 'calico-listening.png'),
      512,
      { rimPasses: 3, noteMin: 180, finalPeel: 1 }
    );
    await makeBobApng(calicoListen, path.join(calicoAssets, 'calico-listening.apng'), {
      frames: 10,
      delayMs: 90,
      amp: 6,
    });
  }

  if (doLoops && !only) {
    const danchenLoops = [
      { src: 'idle-2.png', out: 'idle-2.apng', amp: 3 },
      { src: 'alchemy.png', out: 'alchemy.apng', amp: 4 },
      { src: 'funny.png', out: 'funny.apng', amp: 3 },
      { src: 'drag.png', out: 'drag.apng', amp: 5 },
      { src: 'sit.png', out: 'sit.apng', amp: 2 },
      { src: 'idle-1.png', out: 'idle-1.apng', amp: 2 },
    ];
    for (const item of danchenLoops) {
      const p = path.join(danchenAssets, item.src);
      if (!fs.existsSync(p)) {
        console.warn('skip missing', item.src);
        continue;
      }
      const im = await Jimp.read(p);
      await makeBobApng(im, path.join(danchenAssets, item.out), {
        frames: 8,
        delayMs: 100,
        amp: item.amp,
      });
    }
  }

  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
