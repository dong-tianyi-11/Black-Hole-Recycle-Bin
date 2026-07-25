/**
 * Import user cutout PNGs for danchen:
 * - PNG 已是「抠好」的立绘，但导出时常把棋盘格烤成不透明像素（无 alpha）
 * - 这里做：棋盘格/纯白底 → 透明、清头发白边/发缝棋盘格、去水印、缩放落画布、mini 镜像
 * - 不重抠角色本体、不吃白衣服
 */
const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const ROOT = path.join(__dirname, '..');
const ASSET_DIR =
  process.env.DANCHEN_SRC ||
  path.join(
    process.env.USERPROFILE || '',
    '.cursor/projects/d-my-program-Black-Hole-Recycle-Bin/assets'
  );
const OUT = path.join(ROOT, 'themes/danchen/assets');
const SRC_KEEP = path.join(ROOT, 'themes/danchen/src');
const CANVAS = 512;
const PAD_BOTTOM = 8;

const MAP = [
  { out: 'idle-1.png', src: 'images_2-7388b563-bc26-4491-9074-7c7617a2751d.png', kind: 'stand' },
  { out: 'idle-2.png', src: 'images_7-cb95f6fe-927b-4b94-bdf8-587d8e3070b3.png', kind: 'stand' },
  { out: 'funny.png', src: 'images_6-e34104c2-cf18-4a2c-8f26-bcf2a7616ad3.png', kind: 'stand' },
  { out: 'eat-open.png', src: 'images_5-bbe4d1ea-1082-4551-a35f-df9e9f28842d.png', kind: 'stand' },
  { out: 'eat-chew.png', src: 'images_4-58df6179-0408-45f5-84fc-e2cbf9d41dd0.png', kind: 'stand' },
  { out: 'alchemy.png', src: 'images_3-82eaafaa-98d4-43d5-b708-43093bf32a7b.png', kind: 'scene' },
  { out: 'mini.png', src: 'images_8-3c0cec81-d1c4-4acc-81c0-ef8b21a267d1.png', kind: 'mini', flip: true },
  { out: 'drag.png', src: 'images_1-6efb0277-e37a-4f6a-a7c9-93945cd7f6ea.png', kind: 'stand' },
  { out: 'sit.png', src: 'images_______PNG-7acba70d-a2b3-4e07-af7c-7a3e523fe370.png', kind: 'scene' },
];

function findSrc(fragment) {
  if (fs.existsSync(path.join(ASSET_DIR, fragment))) return path.join(ASSET_DIR, fragment);
  const hit = fs.readdirSync(ASSET_DIR).find((f) => f.includes(fragment) || f.endsWith(fragment));
  if (!hit) throw new Error(`missing source: ${fragment}`);
  return path.join(ASSET_DIR, hit);
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

/** Flat neutral sample (possible checker / export white). */
function isFlatNeutral(r, g, b, a) {
  if (a < 12) return true;
  const avg = (r + g + b) / 3;
  const c = Math.max(r, g, b) - Math.min(r, g, b);
  if (c > 8) return false;
  if (Math.abs(r - g) > 5 || Math.abs(g - b) > 5 || Math.abs(r - b) > 5) return false;
  return avg >= 198;
}

/**
 * Background only: pure export-white, or checker cell (flat gray with alternating neighbor).
 * Must NOT match shaded white robes (similar neighbors, no checker alternation).
 */
function isBgPixel(data, x, y, width, height) {
  const i = (y * width + x) * 4;
  const a = data[i + 3];
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  if (a < 12) return true;
  if (!isFlatNeutral(r, g, b, a)) return false;
  const avg = (r + g + b) / 3;
  // near-pure white export / checker light cell
  if (avg >= 252) return true;
  // checker gray: need a clearly lighter/darker flat neighbor (grid)
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
    if (!isFlatNeutral(data[ni], data[ni + 1], data[ni + 2], data[ni + 3])) continue;
    const navg = (data[ni] + data[ni + 1] + data[ni + 2]) / 3;
    if (Math.abs(navg - avg) >= 10) alt++;
  }
  return avg >= 200 && avg <= 250 && alt >= 1;
}

/**
 * Edge-flood: baked checker / pure white → alpha.
 * Stops at cloth/skin/hair — does not eat white robes.
 */
function checkerToAlpha(img) {
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

/**
 * 「豆包AI生成」在最底部：裁掉底边细条，并清掉右下残留浅色字。
 * 不重抠角色。
 */
function wipeDoubaoWatermark(img) {
  // 只裁底边字幕条，避免误伤白裤子 / 袍摆
  const { width, height } = img.bitmap;
  const cut = Math.max(18, Math.round(height * 0.042));
  const keepH = height - cut;
  if (keepH >= 8) img.crop({ x: 0, y: 0, w: width, h: keepH });
}

function isProtectedClothOrSkin(r, g, b, avg, c) {
  // teal / cyan accent, warm skin, green accents — not hair halo
  if (b > r + 10 && c > 14) return true;
  if (r > g + 12 && r > b + 12 && avg < 200) return true;
  if (g > r + 10 && g > b - 4 && c > 16) return true;
  return false;
}

/** Brown / near-black hair strands (exclude teal cloth & pure black sash blocks). */
function isBrownHair(r, g, b, a) {
  if (a < 40) return false;
  const avg = (r + g + b) / 3;
  if (avg > 135) return false;
  if (b > r + 14) return false; // teal
  // near-black hair strands
  if (avg <= 40 && Math.max(r, g, b) - Math.min(r, g, b) <= 18) return true;
  // warm brown hair
  return avg >= 30 && r >= g - 4 && g >= b - 10 && r - b > 8;
}

function isCheckerLike(r, g, b, a) {
  if (a < 12) return true;
  const avg = (r + g + b) / 3;
  const c = Math.max(r, g, b) - Math.min(r, g, b);
  if (c > 12) return false;
  if (Math.abs(r - g) > 8 || Math.abs(g - b) > 8 || Math.abs(r - b) > 8) return false;
  return avg >= 175;
}

/**
 * Strip only outer bright AA rim next to transparency.
 * Never eat interior white cloth (requires many transparent neighbors).
 */
function cleanWhiteFringe(img, passes = 3) {
  const { width, height, data } = img.bitmap;
  for (let pass = 0; pass < passes; pass++) {
    const kill = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        const a = data[i + 3];
        if (a < 8) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const avg = (r + g + b) / 3;
        const c = Math.max(r, g, b) - Math.min(r, g, b);
        if (isProtectedClothOrSkin(r, g, b, avg, c)) continue;
        if (typeof isSkinTone === 'function' && isSkinTone(r, g, b, a)) continue;
        let t = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            if (data[((y + dy) * width + (x + dx)) * 4 + 3] < 20) t++;
          }
        }
        // only crunchy outer rim — interior cloth has t≈0
        if (t < 3) continue;
        if (avg >= 240 && c <= 18) kill.push(i);
        else if (avg >= 230 && c <= 12 && t >= 4) kill.push(i);
        else if (a < 140 && avg >= 220 && c <= 22 && t >= 4) kill.push(i);
      }
    }
    for (const i of kill) data[i + 3] = 0;
    if (!kill.length) break;
  }
}

/**
 * Clear small checker pockets trapped in hair.
 * Strict size + high hair contact so white robes are never flooded.
 */
function clearHairCheckerPockets(img) {
  const { width, height, data } = img.bitmap;
  const seen = new Uint8Array(width * height);
  const kill = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (seen[p]) continue;
      const i = p * 4;
      if (data[i + 3] < 12 || !isCheckerLike(data[i], data[i + 1], data[i + 2], data[i + 3])) {
        continue;
      }
      const q = [p];
      seen[p] = 1;
      const cells = [];
      let hairN = 0;
      let border = 0;
      while (q.length) {
        const cur = q.pop();
        cells.push(cur);
        const cx = cur % width;
        const cy = (cur - cx) / width;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const np = ny * width + nx;
          const ni = np * 4;
          if (data[ni + 3] < 20) {
            border++;
            continue;
          }
          if (isBrownHair(data[ni], data[ni + 1], data[ni + 2], data[ni + 3])) {
            hairN++;
          }
          if (seen[np]) continue;
          if (!isCheckerLike(data[ni], data[ni + 1], data[ni + 2], data[ni + 3])) continue;
          seen[np] = 1;
          q.push(np);
        }
      }
      const size = cells.length;
      // small islands mostly surrounded by hair (ponytail gaps)
      const hairRatio = hairN / Math.max(1, border + hairN);
      const nearHair =
        size <= 180 && hairN >= 8 && hairRatio >= 0.45 && hairN >= size * 0.08;
      if (nearHair) {
        for (const cell of cells) kill.push(cell * 4);
      }
    }
  }
  for (const i of kill) data[i + 3] = 0;
}

function isSkinTone(r, g, b, a) {
  if (a < 40) return false;
  const avg = (r + g + b) / 3;
  if (avg < 110 || avg > 245) return false;
  return r > g + 4 && r > b + 8 && g >= b - 6;
}

function isEyeIris(r, g, b, a) {
  if (a < 40) return false;
  const avg = (r + g + b) / 3;
  const c = Math.max(r, g, b) - Math.min(r, g, b);
  return avg > 45 && avg < 150 && c > 22 && r > b + 12 && r >= g;
}

/**
 * Per-pixel: only true checker white/gray sandwiched in hair.
 * Protects skin, eyes, teal ribbon, white clothes.
 */
function clearHairWedgedChecker(img) {
  const { width, height, data } = img.bitmap;
  for (let pass = 0; pass < 4; pass++) {
    const kill = [];
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] < 12) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const avg = (r + g + b) / 3;
        const c = Math.max(r, g, b) - Math.min(r, g, b);
        // only flat light gray / white (baked checker), not skin / ribbon
        if (avg < 190 || c > 16) continue;
        if (Math.abs(r - g) > 10 || Math.abs(g - b) > 10 || Math.abs(r - b) > 10) continue;
        if (b > r + 8) continue;
        if (isSkinTone(r, g, b, data[i + 3])) continue;

        let hair = 0;
        let skin = 0;
        let iris = 0;
        let left = 0;
        let right = 0;
        let up = 0;
        let down = 0;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            if (!dx && !dy) continue;
            const ni = ((y + dy) * width + (x + dx)) * 4;
            if (data[ni + 3] < 40) continue;
            const nr = data[ni];
            const ng = data[ni + 1];
            const nb = data[ni + 2];
            if (isSkinTone(nr, ng, nb, data[ni + 3])) skin++;
            if (isEyeIris(nr, ng, nb, data[ni + 3])) iris++;
            if (!isBrownHair(nr, ng, nb, data[ni + 3])) continue;
            hair++;
            if (dx < 0) left++;
            if (dx > 0) right++;
            if (dy < 0) up++;
            if (dy > 0) down++;
          }
        }
        // never eat face / eyes
        if (skin >= 2 || iris >= 2) continue;
        // must be sandwiched by hair on opposite sides
        const sandwiched = (left >= 1 && right >= 1) || (up >= 1 && down >= 1);
        if (sandwiched && hair >= 5) kill.push(i);
      }
    }
    for (const i of kill) data[i + 3] = 0;
    if (!kill.length) break;
  }
}

/**
 * After hair-gap holes open, grow transparency into adjacent flat checker
 * that still touches hair — never into skin / white clothes.
 */
function expandHairGapChecker(img, passes = 12) {
  const { width, height, data } = img.bitmap;
  for (let pass = 0; pass < passes; pass++) {
    const kill = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] < 12) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const avg = (r + g + b) / 3;
        const c = Math.max(r, g, b) - Math.min(r, g, b);
        if (avg < 185 || c > 18) continue;
        if (Math.abs(r - g) > 11 || Math.abs(g - b) > 11 || Math.abs(r - b) > 11) continue;
        if (isSkinTone(r, g, b, data[i + 3])) continue;
        let t = 0;
        let hair = 0;
        let skin = 0;
        let iris = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const ni = ((y + dy) * width + (x + dx)) * 4;
            if (data[ni + 3] < 20) {
              t++;
              continue;
            }
            if (isSkinTone(data[ni], data[ni + 1], data[ni + 2], data[ni + 3])) skin++;
            if (isEyeIris(data[ni], data[ni + 1], data[ni + 2], data[ni + 3])) iris++;
            if (isBrownHair(data[ni], data[ni + 1], data[ni + 2], data[ni + 3])) hair++;
          }
        }
        if (skin || iris) continue;
        if (t >= 1 && hair >= 2) kill.push(i);
      }
    }
    for (const i of kill) data[i + 3] = 0;
    if (!kill.length) break;
  }
}

/** Recolor leftover bright rim toward nearby hair (keeps silhouette, kills white halo). */
function defringeHairRim(img) {
  const { width, height, data } = img.bitmap;
  const out = Buffer.from(data);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      if (a < 24 || a > 250) continue;
      if (isSkinTone(data[i], data[i + 1], data[i + 2], a)) continue;
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const c =
        Math.max(data[i], data[i + 1], data[i + 2]) -
        Math.min(data[i], data[i + 1], data[i + 2]);
      if (avg < 165 || c > 40) continue;
      let t = 0;
      let hr = 0;
      let hg = 0;
      let hb = 0;
      let hn = 0;
      let skin = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (!dx && !dy) continue;
          const ni = ((y + dy) * width + (x + dx)) * 4;
          if (data[ni + 3] < 20) {
            t++;
            continue;
          }
          if (isSkinTone(data[ni], data[ni + 1], data[ni + 2], data[ni + 3])) skin++;
          if (isBrownHair(data[ni], data[ni + 1], data[ni + 2], data[ni + 3])) {
            hr += data[ni];
            hg += data[ni + 1];
            hb += data[ni + 2];
            hn++;
          }
        }
      }
      if (skin >= 2 || t < 1 || hn < 2) continue;
      const k = Math.min(0.9, (avg - 150) / 90);
      out[i] = Math.round(data[i] * (1 - k) + (hr / hn) * k);
      out[i + 1] = Math.round(data[i + 1] * (1 - k) + (hg / hn) * k);
      out[i + 2] = Math.round(data[i + 2] * (1 - k) + (hb / hn) * k);
      if (avg >= 210 && t >= 2) out[i + 3] = Math.max(0, Math.round(a * 0.45));
    }
  }
  data.set(out);
}

/** Safe default: outer rim only — never punch holes in white clothes. */
function matteCleanup(img) {
  cleanWhiteFringe(img, 3);
}

async function placeOnCanvas(src, kind) {
  let img = src.clone();
  // 1) 水印  2) 棋盘格→透明（不吃白衣服）  3) 仅去最外圈亮边
  wipeDoubaoWatermark(img);
  checkerToAlpha(img);
  matteCleanup(img);

  const bounds = contentBounds(img);
  if (!bounds) throw new Error('no content after cleanup');

  const pad = 4;
  const tx = Math.max(0, bounds.x - pad);
  const ty = Math.max(0, bounds.y - pad);
  const tw = Math.min(img.bitmap.width - tx, bounds.w + pad * 2);
  const th = Math.min(img.bitmap.height - ty, bounds.h + pad * 2);
  img = img.crop({ x: tx, y: ty, w: tw, h: th });

  const maxW = kind === 'mini' || kind === 'scene' ? 500 : 460;
  const maxH = kind === 'mini' || kind === 'scene' ? 500 : 490;
  const scale = Math.min(maxW / img.bitmap.width, maxH / img.bitmap.height, 1.2);
  const nw = Math.max(1, Math.round(img.bitmap.width * scale));
  const nh = Math.max(1, Math.round(img.bitmap.height * scale));
  img = img.resize({ w: nw, h: nh });

  const canvas = new Jimp({ width: CANVAS, height: CANVAS, color: 0x00000000 });
  const x = Math.round((CANVAS - nw) / 2);
  const y =
    kind === 'mini'
      ? Math.max(4, Math.round((CANVAS - nh) * 0.18))
      : Math.max(0, CANVAS - PAD_BOTTOM - nh);
  canvas.composite(img, x, y);
  matteCleanup(canvas);
  return canvas;
}

async function makeChewNudge(base, dy) {
  const canvas = new Jimp({ width: CANVAS, height: CANVAS, color: 0x00000000 });
  canvas.composite(base, 0, dy);
  return canvas;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(SRC_KEEP, { recursive: true });

  const onlyArg = (process.env.ONLY || process.argv.slice(2).join(',') || '').trim();
  const onlyList = onlyArg
    ? onlyArg
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (s.endsWith('.png') ? s : `${s}.png`))
    : null;
  const items = onlyList ? MAP.filter((m) => onlyList.includes(m.out)) : MAP;
  if (!items.length) throw new Error(`no MAP entry for ONLY=${onlyArg}`);

  if (!onlyList) {
    for (const name of fs.readdirSync(OUT)) {
      if (name.startsWith('_test-') || /^eat-chew\d*\.png$/i.test(name)) {
        fs.unlinkSync(path.join(OUT, name));
      }
    }
  }

  const built = {};
  for (const item of items) {
    const srcPath = findSrc(item.src);
    console.log('import', path.basename(srcPath), '→', item.out);
    fs.copyFileSync(srcPath, path.join(SRC_KEEP, item.out.replace('.png', '-src.png')));

    let img = await Jimp.read(srcPath);
    if (item.flip) img = img.flip({ horizontal: true, vertical: false });
    const placed = await placeOnCanvas(img, item.kind);
    await placed.write(path.join(OUT, item.out));
    built[item.out] = placed;
    console.log('  bbox', contentBounds(placed));
  }

  const needChew =
    built['eat-chew.png'] && (!onlyList || onlyList.some((n) => /^eat-chew/i.test(n)));
  if (needChew) {
    const chew = built['eat-chew.png'];
    for (const [name, dy] of [
      ['eat-chew.png', 0],
      ['eat-chew2.png', 2],
      ['eat-chew3.png', -2],
    ]) {
      await (await makeChewNudge(chew, dy)).write(path.join(OUT, name));
      console.log('nudge', name);
    }
  }

  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
