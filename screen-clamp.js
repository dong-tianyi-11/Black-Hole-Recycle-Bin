/**
 * Multi-monitor work-area clamp (adapted from clawd-on-desk work-area.js).
 */
const SYNTHETIC = { x: 0, y: 0, width: 1920, height: 1080 };

function getDisplaysSafe(screen) {
  try {
    const list = screen.getAllDisplays();
    if (Array.isArray(list) && list.length) return list;
  } catch (_) {}
  try {
    return [screen.getPrimaryDisplay()];
  } catch (_) {
    return [];
  }
}

function primaryWorkArea(screen) {
  try {
    return screen.getPrimaryDisplay().workArea || SYNTHETIC;
  } catch (_) {
    return SYNTHETIC;
  }
}

/**
 * Keep at least ~25% of the window visible across the union of work areas.
 */
function clampToDisplays(screen, x, y, w, h) {
  const displays = getDisplaysSafe(screen);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const d of displays) {
    const wa = d.workArea || d.bounds;
    if (!wa) continue;
    minX = Math.min(minX, wa.x);
    minY = Math.min(minY, wa.y);
    maxX = Math.max(maxX, wa.x + wa.width);
    maxY = Math.max(maxY, wa.y + wa.height);
  }
  if (minX === Infinity) {
    const wa = primaryWorkArea(screen);
    minX = wa.x;
    minY = wa.y;
    maxX = wa.x + wa.width;
    maxY = wa.y + wa.height;
  }
  const mx = Math.round(w * 0.25);
  const my = Math.round(h * 0.25);
  return {
    x: Math.round(Math.max(minX - mx, Math.min(x, maxX - w + mx))),
    y: Math.round(Math.max(minY - my, Math.min(y, maxY - h + my))),
  };
}

function centerOnWorkArea(wa, w, h) {
  const area = wa || SYNTHETIC;
  return {
    x: Math.round(area.x + (area.width - w) / 2),
    y: Math.round(area.y + (area.height - h) / 2),
  };
}

function findDisplayById(screen, id) {
  return getDisplaysSafe(screen).find((d) => d.id === id) || null;
}

function displaySnapshot(display) {
  if (!display) return null;
  return {
    id: display.id,
    bounds: { ...display.bounds },
    workArea: { ...display.workArea },
  };
}

module.exports = {
  SYNTHETIC,
  getDisplaysSafe,
  primaryWorkArea,
  clampToDisplays,
  centerOnWorkArea,
  findDisplayById,
  displaySnapshot,
};
