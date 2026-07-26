/**
 * Mini Mode — edge snap / half-hide / hover peek (left / right only).
 */
const { screen } = require('electron');

const PEEK_OFFSET = 52;
const SNAP_TOLERANCE = 30;
/** Fraction of width that must hang past the work-area edge to dock (drag intent). */
const MIN_OVERHANG_RATIO = 0.2;
const JUMP_PEAK_HEIGHT = 64;
const JUMP_DURATION = 480;
const MINI_ENTER_FALLBACK_MS = 1200;
const DEFAULT_OFFSET_RATIO = 0.486;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutQuint(t) {
  return 1 - Math.pow(1 - t, 5);
}

function normalizeEdge(edge) {
  return edge === 'left' ? 'left' : 'right';
}

function createMiniController(ctx) {
  let MINI_OFFSET_RATIO = DEFAULT_OFFSET_RATIO;
  let miniMode = false;
  let miniEdge = 'right';
  let miniTransitioning = false;
  let miniPeeked = false;
  let preMiniX = 0;
  let preMiniY = 0;
  let currentMiniX = 0;
  let currentMiniY = 0;
  let miniSnap = null; // { x, y, width, height }
  let lastMiniWorkArea = null;
  let miniTransitionTimer = null;
  let animTimer = null;
  let isAnimating = false;

  function win() {
    return typeof ctx.getWindow === 'function' ? ctx.getWindow() : null;
  }

  function refreshTheme(theme) {
    const ratio = theme?.miniMode?.offsetRatio;
    MINI_OFFSET_RATIO =
      typeof ratio === 'number' && ratio > 0 && ratio < 1 ? ratio : DEFAULT_OFFSET_RATIO;
  }

  function themeSupportsMini() {
    return true;
  }

  function getSize() {
    const w = win();
    if (!w || w.isDestroyed()) return { width: 360, height: 360 };
    const [width, height] = w.getSize();
    return { width, height };
  }

  function getBounds() {
    const w = win();
    if (!w || w.isDestroyed()) return { x: 0, y: 0, width: 360, height: 360 };
    return w.getBounds();
  }

  function nearestWorkArea(cx, cy) {
    if (typeof ctx.getNearestWorkArea === 'function') {
      return ctx.getNearestWorkArea(cx, cy);
    }
    const displays = screen.getAllDisplays();
    for (const d of displays) {
      const wa = d.workArea || d.bounds;
      if (
        cx >= wa.x &&
        cx <= wa.x + wa.width &&
        cy >= wa.y &&
        cy <= wa.y + wa.height
      ) {
        return wa;
      }
    }
    return screen.getPrimaryDisplay().workArea;
  }

  function clampPos(x, y, width, height) {
    if (typeof ctx.clampPosition === 'function') {
      return ctx.clampPosition(x, y, width, height);
    }
    return { x, y };
  }

  function persist() {
    if (typeof ctx.persistMiniState === 'function') {
      ctx.persistMiniState({
        miniMode,
        miniEdge,
        preMiniX,
        preMiniY,
      });
    }
  }

  function notifyRenderer() {
    if (typeof ctx.sendMiniModeChange === 'function') {
      ctx.sendMiniModeChange(miniMode, miniEdge);
    }
  }

  function notifyMenus() {
    if (typeof ctx.rebuildMenus === 'function') ctx.rebuildMenus();
  }

  function applyPetMiniState(state) {
    if (typeof ctx.applyMiniPetState === 'function') {
      ctx.applyMiniPetState(state);
    }
  }

  function cancelAnim() {
    if (animTimer) {
      clearTimeout(animTimer);
      animTimer = null;
    }
    isAnimating = false;
  }

  function cancelMiniTransition() {
    miniTransitioning = false;
    if (miniTransitionTimer) {
      clearTimeout(miniTransitionTimer);
      miniTransitionTimer = null;
    }
    cancelAnim();
  }

  function snapSize(bounds) {
    return {
      width: miniSnap ? miniSnap.width : bounds.width,
      height: miniSnap ? miniSnap.height : bounds.height,
    };
  }

  function animateWindowTo(targetX, targetY, durationMs, onDone) {
    cancelAnim();
    const w = win();
    if (!w || w.isDestroyed()) {
      if (onDone) onDone();
      return;
    }
    const bounds = w.getBounds();
    const startX = bounds.x;
    const startY = bounds.y;
    if (startX === targetX && startY === targetY) {
      if (onDone) onDone();
      return;
    }
    isAnimating = true;
    const startTime = Date.now();
    const { width: snapW, height: snapH } = snapSize(bounds);
    const step = () => {
      if (!w || w.isDestroyed()) {
        animTimer = null;
        isAnimating = false;
        if (onDone) onDone();
        return;
      }
      const t = Math.min(1, (Date.now() - startTime) / durationMs);
      const eased = easeOutCubic(t);
      const x = Math.round(startX + (targetX - startX) * eased);
      const y = Math.round(startY + (targetY - startY) * eased);
      try {
        w.setBounds({ x, y, width: snapW, height: snapH });
      } catch (_) {
        animTimer = null;
        isAnimating = false;
        if (onDone) onDone();
        return;
      }
      if (t < 1) {
        animTimer = setTimeout(step, 16);
      } else {
        animTimer = null;
        isAnimating = false;
        if (onDone) onDone();
      }
    };
    step();
  }

  function animateWindowParabola(targetX, targetY, durationMs, onDone) {
    cancelAnim();
    const w = win();
    if (!w || w.isDestroyed()) {
      if (onDone) onDone();
      return;
    }
    const bounds = w.getBounds();
    const startX = bounds.x;
    const startY = bounds.y;
    if (startX === targetX && startY === targetY) {
      if (onDone) onDone();
      return;
    }
    isAnimating = true;
    const startTime = Date.now();
    const { width: snapW, height: snapH } = snapSize(bounds);
    const step = () => {
      if (!w || w.isDestroyed()) {
        animTimer = null;
        isAnimating = false;
        if (onDone) onDone();
        return;
      }
      const t = Math.min(1, (Date.now() - startTime) / durationMs);
      const eased = easeOutQuint(t);
      const x = Math.round(startX + (targetX - startX) * eased);
      // Softer arc — peaks early, lands gently
      const arc = Math.sin(Math.PI * easeOutCubic(t)) * JUMP_PEAK_HEIGHT;
      const y = Math.round(startY + (targetY - startY) * eased - arc);
      try {
        w.setBounds({ x, y, width: snapW, height: snapH });
      } catch (_) {
        animTimer = null;
        isAnimating = false;
        if (onDone) onDone();
        return;
      }
      if (t < 1) {
        animTimer = setTimeout(step, 16);
      } else {
        animTimer = null;
        isAnimating = false;
        if (onDone) onDone();
      }
    };
    step();
  }

  function calcMiniPos(wa, size, edge, preferY) {
    const e = normalizeEdge(edge);
    if (e === 'left') {
      return {
        x: wa.x - Math.round(size.width * MINI_OFFSET_RATIO),
        y: preferY,
      };
    }
    return {
      x: wa.x + wa.width - Math.round(size.width * (1 - MINI_OFFSET_RATIO)),
      y: preferY,
    };
  }

  function finishMiniEntry(delayMs) {
    if (miniTransitionTimer) {
      clearTimeout(miniTransitionTimer);
      miniTransitionTimer = null;
    }
    const settleMs = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : MINI_ENTER_FALLBACK_MS;
    miniTransitionTimer = setTimeout(() => {
      miniTransitionTimer = null;
      miniTransitioning = false;
      applyPetMiniState(ctx.isDoNotDisturb?.() ? 'miniSleep' : 'miniIdle');
      persist();
      notifyMenus();
    }, settleMs);
  }

  function enterDurationMs() {
    if (typeof ctx.getMiniEnterDurationMs === 'function') {
      const ms = ctx.getMiniEnterDurationMs();
      if (Number.isFinite(ms) && ms > 0) return ms;
    }
    return MINI_ENTER_FALLBACK_MS;
  }

  function checkMiniModeSnap() {
    if (!themeSupportsMini()) return false;
    if (miniMode || miniTransitioning) return false;
    const bounds = getBounds();
    const size = { width: bounds.width, height: bounds.height };
    // Require a real overhang past the edge — "near the border" must not dock.
    const need = Math.max(36, Math.round(size.width * MIN_OVERHANG_RATIO));
    const centerY = bounds.y + size.height / 2;
    const displays = screen.getAllDisplays();

    for (const d of displays) {
      const wa = d.workArea || d.bounds;
      // Vertical: keep using the display the window mostly sits on
      if (centerY < wa.y || centerY > wa.y + wa.height) continue;

      const overhangRight = bounds.x + size.width - (wa.x + wa.width);
      const overhangLeft = wa.x - bounds.x;

      const hits = [];
      if (overhangRight >= need) {
        hits.push({ edge: 'right', depth: overhangRight });
      }
      if (overhangLeft >= need) {
        hits.push({ edge: 'left', depth: overhangLeft });
      }
      if (!hits.length) continue;

      hits.sort((a, b) => b.depth - a.depth);
      enterMiniMode(wa, false, hits[0].edge);
      return true;
    }
    return false;
  }

  function enterMiniMode(wa, viaMenu, edge) {
    if (!themeSupportsMini()) return;
    if (miniMode && !viaMenu) return;
    const w = win();
    if (!w || w.isDestroyed()) return;

    const bounds = w.getBounds();
    if (!viaMenu) {
      preMiniX = bounds.x;
      preMiniY = bounds.y;
    }

    miniMode = true;
    miniPeeked = false;
    if (edge) miniEdge = normalizeEdge(edge);
    const size = { width: bounds.width, height: bounds.height };
    const pos = calcMiniPos(wa, size, miniEdge, bounds.y);
    currentMiniX = pos.x;
    currentMiniY = pos.y;
    lastMiniWorkArea = wa;
    miniSnap = { x: pos.x, y: pos.y, width: size.width, height: size.height };
    miniTransitioning = true;

    notifyRenderer();
    notifyMenus();

    const enterState = ctx.isDoNotDisturb?.() ? 'miniSleep' : 'miniEnter';
    const slideMs = viaMenu ? 300 : 180;

    animateWindowTo(currentMiniX, currentMiniY, slideMs, () => {
      applyPetMiniState(enterState);
      finishMiniEntry(enterDurationMs());
    });
  }

  function exitMiniMode() {
    if (!miniMode) return;
    cancelMiniTransition();
    miniTransitioning = true;
    miniSnap = null;
    miniPeeked = false;

    const size = getSize();
    let targetX = preMiniX;
    let targetY = preMiniY;
    const clamped = clampPos(targetX, targetY, size.width, size.height);
    targetX = clamped.x;
    targetY = clamped.y;

    const wa = nearestWorkArea(targetX + size.width / 2, targetY + size.height / 2);
    const mEdgeW = Math.round(size.width * 0.25);

    if (targetX >= wa.x + wa.width - size.width + mEdgeW - SNAP_TOLERANCE) {
      targetX = wa.x + wa.width - size.width + mEdgeW - 100;
    }
    if (targetX <= wa.x - mEdgeW + SNAP_TOLERANCE) {
      targetX = wa.x - mEdgeW + SNAP_TOLERANCE + 100;
    }

    const b = getBounds();
    miniSnap = { x: b.x, y: b.y, width: b.width, height: b.height };

    animateWindowParabola(targetX, targetY, JUMP_DURATION, () => {
      miniMode = false;
      miniTransitioning = false;
      miniSnap = null;
      notifyRenderer();
      if (typeof ctx.onMiniExited === 'function') ctx.onMiniExited();
      persist();
      notifyMenus();
    });
  }

  /** Work area for a docked window (center may be off-screen). */
  function workAreaForDocked(bounds, edge) {
    const visibleX =
      edge === 'left'
        ? bounds.x + bounds.width - 8
        : bounds.x + 8;
    const cy = bounds.y + bounds.height / 2;
    return nearestWorkArea(visibleX, cy);
  }

  /** Drag-undock — pop fully onto the work area (drag follow owns motion after). */
  function exitMiniModeImmediate() {
    if (!miniMode && !miniTransitioning) return false;
    const edge = miniEdge;
    cancelMiniTransition();
    cancelAnim();
    miniPeeked = false;
    miniSnap = null;
    miniMode = false;
    miniTransitioning = false;

    const w = win();
    if (w && !w.isDestroyed()) {
      const b = w.getBounds();
      const size = { width: b.width, height: b.height };
      const wa = lastMiniWorkArea || workAreaForDocked(b, edge);
      // Pull well inside the work area so the whole hole is grabbable
      const inset = Math.round(size.width * 0.12);
      let x =
        edge === 'left'
          ? wa.x + inset
          : wa.x + wa.width - size.width - inset;
      let y = b.y;
      x = Math.min(Math.max(Math.round(x), wa.x), wa.x + wa.width - size.width);
      y = Math.min(Math.max(Math.round(y), wa.y), wa.y + wa.height - size.height);
      try {
        w.setBounds({ x, y, width: size.width, height: size.height });
      } catch (_) {}
    }

    notifyRenderer();
    if (typeof ctx.onMiniExited === 'function') ctx.onMiniExited();
    persist();
    notifyMenus();
    return true;
  }

  function enterMiniViaMenu() {
    if (!themeSupportsMini()) return;
    if (miniMode) {
      exitMiniMode();
      return;
    }
    const bounds = getBounds();
    const size = { width: bounds.width, height: bounds.height };
    preMiniX = bounds.x;
    preMiniY = bounds.y;
    const wa = nearestWorkArea(bounds.x + size.width / 2, bounds.y + size.height / 2);
    const centerX = bounds.x + size.width / 2;
    const edge = centerX <= wa.x + wa.width / 2 ? 'left' : 'right';
    enterMiniMode(wa, true, edge);
  }

  function miniPeekIn() {
    if (!miniMode || miniTransitioning || isAnimating) return;
    if (miniPeeked) return;
    miniPeeked = true;
    const dx = miniEdge === 'left' ? PEEK_OFFSET : -PEEK_OFFSET;
    animateWindowTo(currentMiniX + dx, currentMiniY, 280);
    applyPetMiniState('miniPeek');
    if (typeof ctx.sendMiniPeek === 'function') ctx.sendMiniPeek(true);
  }

  function miniPeekOut() {
    if (!miniMode || miniTransitioning) return;
    if (!miniPeeked) return;
    miniPeeked = false;
    if (typeof ctx.sendMiniPeek === 'function') ctx.sendMiniPeek(false);
    animateWindowTo(currentMiniX, currentMiniY, 240, () => {
      applyPetMiniState(ctx.isDoNotDisturb?.() ? 'miniSleep' : 'miniIdle');
    });
  }

  function handleDisplayChange() {
    if (!miniMode) return;
    const bounds = getBounds();
    const size = { width: bounds.width, height: bounds.height };
    const wa = nearestWorkArea(bounds.x + size.width / 2, bounds.y + size.height / 2);
    lastMiniWorkArea = wa;
    const pos = calcMiniPos(wa, size, miniEdge, bounds.y);
    currentMiniX = pos.x;
    currentMiniY = pos.y;
    miniSnap = { x: pos.x, y: pos.y, width: size.width, height: size.height };
    const w = win();
    if (w && !w.isDestroyed()) {
      w.setBounds({
        x: currentMiniX,
        y: currentMiniY,
        width: miniSnap.width,
        height: miniSnap.height,
      });
    }
  }

  function restoreFromPrefs(prefs) {
    if (!prefs?.miniMode) return;
    refreshTheme(ctx.getTheme?.());
    miniEdge = normalizeEdge(prefs.miniEdge);
    preMiniX = Number(prefs.preMiniX) || 0;
    preMiniY = Number(prefs.preMiniY) || 0;
    const bounds = getBounds();
    const size = { width: bounds.width, height: bounds.height };
    const wa = nearestWorkArea(bounds.x + size.width / 2, bounds.y + size.height / 2);
    miniMode = true;
    miniPeeked = false;
    const preferY = Number.isFinite(preMiniY) ? preMiniY : bounds.y;
    const pos = calcMiniPos(wa, size, miniEdge, preferY);
    currentMiniX = pos.x;
    currentMiniY = pos.y;
    lastMiniWorkArea = wa;
    miniSnap = { x: pos.x, y: pos.y, width: size.width, height: size.height };
    const w = win();
    if (w && !w.isDestroyed()) {
      w.setBounds({
        x: currentMiniX,
        y: currentMiniY,
        width: miniSnap.width,
        height: miniSnap.height,
      });
    }
    notifyRenderer();
    applyPetMiniState(ctx.isDoNotDisturb?.() ? 'miniSleep' : 'miniIdle');
    miniTransitioning = false;
  }

  return {
    refreshTheme,
    checkMiniModeSnap,
    enterMiniMode,
    exitMiniMode,
    exitMiniModeImmediate,
    enterMiniViaMenu,
    miniPeekIn,
    miniPeekOut,
    handleDisplayChange,
    restoreFromPrefs,
    cancelMiniTransition,
    getMiniMode: () => miniMode,
    getMiniEdge: () => miniEdge,
    getMiniTransitioning: () => miniTransitioning,
    isAnimating: () => isAnimating,
    getLastWorkArea: () => lastMiniWorkArea,
  };
}

module.exports = { createMiniController, normalizeEdge };
