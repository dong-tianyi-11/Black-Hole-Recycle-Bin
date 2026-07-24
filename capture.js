const { desktopCapturer, screen } = require('electron');

let capturing = false;
let plateImage = null;
let plateDisplayId = null;
let plateThumbSize = { width: 0, height: 0 };
let plateDisplayBounds = null;

const PAD_RATIO = 0.38;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickSource(sources, display) {
  const displayId = String(display.id);
  return (
    sources.find((s) => s.display_id === displayId) ||
    sources.find((s) => s.id.includes('screen')) ||
    sources[0]
  );
}

async function refreshDesktopPlate(display) {
  if (capturing) return false;
  capturing = true;
  try {
    const target = display || screen.getPrimaryDisplay();
    const sf = target.scaleFactor || 1;
    const physW = Math.round(target.size.width * sf);
    const physH = Math.round(target.size.height * sf);
    const maxW = 1920;
    const thumbW = Math.min(physW, maxW);
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

  let cropX = Math.floor(((relX - pad) * tw) / db.width);
  let cropY = Math.floor(((relY - pad) * th) / db.height);
  let cropW = Math.ceil(((bounds.width + pad * 2) * tw) / db.width);
  let cropH = Math.ceil(((bounds.height + pad * 2) * th) / db.height);

  cropX = Math.max(0, cropX);
  cropY = Math.max(0, cropY);
  cropW = Math.max(1, Math.min(cropW, tw - cropX));
  cropH = Math.max(1, Math.min(cropH, th - cropY));

  try {
    const cropped = plateImage.crop({ x: cropX, y: cropY, width: cropW, height: cropH });
    // JPEG is much faster than PNG — critical for smooth feel
    const jpeg = cropped.toJPEG(68);
    return {
      data: jpeg,
      mime: 'image/jpeg',
      padRatio: PAD_RATIO,
      width: cropW,
      height: cropH,
    };
  } catch (err) {
    console.error('[crop]', err);
    return null;
  }
}

async function refreshPlateHidden(win) {
  if (!win || win.isDestroyed() || capturing) return false;
  const display = screen.getDisplayMatching(win.getBounds());
  const wasVisible = win.isVisible();
  try {
    if (wasVisible) {
      win.hide();
      await sleep(40);
    }
    return await refreshDesktopPlate(display);
  } finally {
    if (wasVisible && win && !win.isDestroyed()) win.showInactive();
  }
}

module.exports = {
  PAD_RATIO,
  refreshDesktopPlate,
  refreshPlateHidden,
  cropPlateForWindow,
  hasPlate,
};
