const { desktopCapturer, screen } = require('electron');

let capturing = false;
let plateImage = null;
let plateDisplayId = null;
let plateThumbSize = { width: 0, height: 0 };
let plateDisplayBounds = null;
/** Bumps whenever the full-screen plate is replaced — used to skip redundant crops. */
let plateGeneration = 0;

const PAD_RATIO = 0.42;

function pickSource(sources, display) {
  const displayId = String(display.id);
  return (
    sources.find((s) => s.display_id === displayId) ||
    sources.find((s) => s.id.includes('screen')) ||
    sources[0]
  );
}

function getPlateGeneration() {
  return plateGeneration;
}

async function refreshDesktopPlate(display, { maxWidth = 1600 } = {}) {
  if (capturing) return false;
  capturing = true;
  try {
    const target = display || screen.getPrimaryDisplay();
    const sf = target.scaleFactor || 1;
    const physW = Math.round(target.size.width * sf);
    const physH = Math.round(target.size.height * sf);
    const thumbW = Math.min(physW, maxWidth);
    const thumbH = Math.max(1, Math.round(physH * (thumbW / physW)));

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumbW, height: thumbH },
    });
    if (!sources.length) return false;

    const source = pickSource(sources, target);
    const thumb = source?.thumbnail;
    if (!thumb || thumb.isEmpty()) return false;

    plateImage = thumb;
    plateDisplayId = String(target.id);
    plateThumbSize = thumb.getSize();
    plateDisplayBounds = { ...target.bounds };
    plateGeneration += 1;
    return true;
  } catch (err) {
    console.error('[plate]', err);
    return false;
  } finally {
    capturing = false;
  }
}

function hasPlate() {
  return !!(plateImage && !plateImage.isEmpty());
}

function cropPlateForWindow(win) {
  if (!win || win.isDestroyed() || !hasPlate()) return null;

  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  if (plateDisplayId && String(display.id) !== plateDisplayId) return null;

  const db = plateDisplayBounds || display.bounds;
  const tw = plateThumbSize.width;
  const th = plateThumbSize.height;
  const pad = Math.ceil(bounds.width * PAD_RATIO);

  const relX = bounds.x - db.x;
  const relY = bounds.y - db.y;

  let cropX = Math.round(((relX - pad) * tw) / db.width);
  let cropY = Math.round(((relY - pad) * th) / db.height);
  let cropW = Math.round(((bounds.width + pad * 2) * tw) / db.width);
  let cropH = Math.round(((bounds.height + pad * 2) * th) / db.height);

  cropX = Math.max(0, cropX);
  cropY = Math.max(0, cropY);
  cropW = Math.max(1, Math.min(cropW, tw - cropX));
  cropH = Math.max(1, Math.min(cropH, th - cropY));

  try {
    const cropped = plateImage.crop({ x: cropX, y: cropY, width: cropW, height: cropH });
    const jpeg = cropped.toJPEG(82);
    return {
      data: jpeg,
      mime: 'image/jpeg',
      padRatio: PAD_RATIO,
      width: cropW,
      height: cropH,
      cropKey: `${plateGeneration}|${cropX}|${cropY}|${cropW}|${cropH}`,
    };
  } catch (err) {
    console.error('[crop]', err);
    return null;
  }
}

/**
 * Refresh desktop underlay WITHOUT hiding the window.
 * Relies on content protection while on blackhole theme (see
 * applyContentProtection in main.js) so Windows excludes this HWND
 * from capture and the desktop shows through.
 */
async function refreshPlateLive(win) {
  if (!win || win.isDestroyed() || capturing) return false;
  const display = screen.getDisplayMatching(win.getBounds());
  return refreshDesktopPlate(display, { maxWidth: 1600 });
}

// Back-compat alias — never hides
async function refreshPlateHidden(win) {
  return refreshPlateLive(win);
}

module.exports = {
  PAD_RATIO,
  refreshDesktopPlate,
  refreshPlateHidden,
  refreshPlateLive,
  cropPlateForWindow,
  hasPlate,
  getPlateGeneration,
};
