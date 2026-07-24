(function () {
  const canvas = document.getElementById('bh');
  const hit = document.getElementById('hit');
  const toast = document.getElementById('toast');
  const petImg = document.getElementById('pet-img');
  const crumbs = document.getElementById('crumbs');
  let renderer;
  let pet;
  let theme = 'blackhole';
  let themeType = 'blackhole';
  let themeMeta = null;
  let frameBusy = false;
  let feeding = false;
  let doNotDisturb = false;
  let clickThrough = true;

  function isPet() {
    return themeType === 'pet';
  }

  function isBlackhole() {
    return themeType === 'blackhole';
  }

  function showToast(msg, ms = 1600) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), ms);
  }

  function spawnCrumbs(count) {
    if (!crumbs) return;
    crumbs.innerHTML = '';
    const n = Math.min(8, Math.max(1, count));
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'crumb';
      const x = (Math.random() - 0.5) * 70;
      const y = -20 - Math.random() * 40;
      el.style.setProperty('--sx', `${x}%`);
      el.style.setProperty('--sy', `${y}%`);
      el.style.animationDelay = `${i * 0.06}s`;
      crumbs.appendChild(el);
    }
    setTimeout(() => {
      crumbs.innerHTML = '';
    }, 900);
  }

  function bumpActivity() {
    window.blackHole?.noteActivity?.();
  }

  function applyTheme(payload) {
    themeMeta = payload || null;
    theme = payload?.theme || payload?.id || 'blackhole';
    themeType = payload?.type || (theme === 'blackhole' ? 'blackhole' : 'pet');
    doNotDisturb = !!payload?.doNotDisturb;
    clickThrough = payload?.clickThrough !== false;
    document.body.dataset.theme = theme;
    document.body.dataset.themeType = themeType;

    if (isPet() && payload) {
      pet?.applyTheme(payload);
    }
    renderer?.setEnabled(isBlackhole());
    pet?.setEnabled(isPet());
    if (isPet()) pet?.setDoNotDisturb(doNotDisturb);
    renderer?.setLowPower?.(!!payload?.lowPowerIdle);
    renderer?.resize();
    if (clickThrough) window.blackHole.setIgnoreMouse(true);
    else window.blackHole.setIgnoreMouse(false);
  }

  async function init() {
    renderer = new window.BlackHoleRenderer(canvas);
    pet = new window.PetController(petImg);

    const cfg = await window.blackHole.getConfig();
    if (cfg.themeMeta) {
      applyTheme(cfg.themeMeta);
    } else {
      theme = cfg.theme || 'blackhole';
      themeType = theme === 'blackhole' ? 'blackhole' : 'pet';
      document.body.dataset.theme = theme;
      document.body.dataset.themeType = themeType;
      renderer.setEnabled(isBlackhole());
      pet.setEnabled(isPet());
    }

    window.blackHole.onSizeChanged(() => renderer?.resize());
    window.blackHole.onThemeChanged((payload) => applyTheme(payload));
    window.blackHole.onDndChanged((on) => {
      doNotDisturb = !!on;
      pet?.setDoNotDisturb(doNotDisturb);
      if (doNotDisturb) showToast('已进入勿扰 / 睡眠');
      else showToast('已唤醒');
    });
    window.blackHole.onLowPowerChanged((on) => {
      renderer?.setLowPower?.(!!on);
    });

    window.blackHole.onDesktopFrame(async (frame) => {
      if (!isBlackhole() || doNotDisturb || !frame?.data || frameBusy) return;
      frameBusy = true;
      try {
        const bytes =
          frame.data instanceof Uint8Array
            ? frame.data
            : frame.data?.type === 'Buffer'
              ? new Uint8Array(frame.data.data)
              : new Uint8Array(frame.data);
        await renderer.updateDesktopTexture(bytes, frame.padRatio, frame.mime || 'image/jpeg');
      } finally {
        frameBusy = false;
      }
    });

    if (clickThrough) window.blackHole.setIgnoreMouse(true);
  }

  let dragging = false;
  let dragMoved = false;
  let pointerDown = false;
  let lastScreen = null;
  let activePointerId = null;

  function endPointerDrag(e, { cancel = false } = {}) {
    if (!pointerDown && !dragging) return;
    const wasDragging = dragging;
    const moved = dragMoved;
    const pid = activePointerId;

    // Clear state before releasePointerCapture to avoid re-entry via lostpointercapture
    activePointerId = null;
    pointerDown = false;
    dragging = false;
    lastScreen = null;
    dragMoved = false;

    if (pid != null && hit.hasPointerCapture?.(pid)) {
      try {
        hit.releasePointerCapture(pid);
      } catch (_) {}
    }

    // Always clear main-process drag lock (dragStart runs on pointerdown)
    if (wasDragging) {
      document.body.classList.remove('window-dragging');
      window.blackHole.dragEnd();
      if (moved) pet?.onWindowDragEnd();
      else if (!cancel && !doNotDisturb) pet?.poke();
    }

    // After drag-end IPC, re-sync click-through from real hover (don't force ignore)
    if (clickThrough) {
      queueMicrotask(() => {
        if (pointerDown || dragging) return;
        const over = hit.matches(':hover');
        window.blackHole.setIgnoreMouse(!over);
      });
    }
  }

  // Click-through: only #hit captures mouse
  hit.addEventListener('mouseenter', () => {
    if (clickThrough && !dragging && !pointerDown) window.blackHole.setIgnoreMouse(false);
  });
  hit.addEventListener('mouseleave', () => {
    // Keep capturing while pointer is down / dragging (IME popups can fire leave)
    if (dragging || pointerDown) return;
    if (clickThrough && !feeding) window.blackHole.setIgnoreMouse(true);
  });

  // Wheel zoom only on the hit target, never while dragging
  hit.addEventListener(
    'wheel',
    async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (dragging || pointerDown) return;
      bumpActivity();
      pet?.notePointer();
      const config = await window.blackHole.getConfig();
      const current = config.size || 360;
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      const next = Math.round(Math.max(160, Math.min(720, current * factor)));
      if (next !== current) {
        await window.blackHole.setSize(next);
        renderer?.resize();
        if (clickThrough) window.blackHole.setIgnoreMouse(false);
      }
    },
    { passive: false }
  );

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (dragging || pointerDown) {
      endPointerDrag(e, { cancel: true });
    }
    bumpActivity();
    pet?.notePointer();
    window.blackHole?.showContextMenu();
  });

  // Pointer Events + setPointerCapture: survives IME / floating candidate windows
  hit.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pointerDown = true;
    dragging = true;
    dragMoved = false;
    activePointerId = e.pointerId;
    lastScreen = { x: e.screenX, y: e.screenY };
    bumpActivity();
    pet?.notePointer();
    window.blackHole.setIgnoreMouse(false);
    window.blackHole.dragStart();
    try {
      hit.setPointerCapture(e.pointerId);
    } catch (_) {}
    e.preventDefault();
  });

  hit.addEventListener('pointermove', (e) => {
    if (!dragging || !lastScreen) return;
    if (activePointerId != null && e.pointerId !== activePointerId) return;
    const dx = e.screenX - lastScreen.x;
    const dy = e.screenY - lastScreen.y;
    if (!dx && !dy) return;
    const dist = Math.hypot(dx, dy);
    // Start drag after a small threshold; once moving, apply every delta (no sticky lag)
    if (!dragMoved && dist <= 3) return;
    if (!dragMoved) {
      dragMoved = true;
      document.body.classList.add('window-dragging');
      pet?.onWindowDragStart();
    }
    window.blackHole.dragMove(dx, dy);
    lastScreen = { x: e.screenX, y: e.screenY };
  });

  hit.addEventListener('pointerup', (e) => {
    if (activePointerId != null && e.pointerId !== activePointerId) return;
    endPointerDrag(e);
  });

  hit.addEventListener('pointercancel', (e) => {
    if (activePointerId != null && e.pointerId !== activePointerId) return;
    endPointerDrag(e, { cancel: true });
  });

  hit.addEventListener('lostpointercapture', () => {
    // IME or OS stole capture — finish drag cleanly instead of stuck state
    if (pointerDown || dragging) {
      endPointerDrag(null, { cancel: true });
    }
  });

  hit.addEventListener('click', (e) => {
    e.preventDefault();
  });

  let fileDragDepth = 0;

  function isFileDrag(e) {
    return Array.from(e.dataTransfer?.types || []).includes('Files');
  }

  function onFileDragEnter(e) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (clickThrough) window.blackHole.setIgnoreMouse(false);
    const was = fileDragDepth;
    fileDragDepth += 1;
    hit.classList.add('drag-over');
    document.body.classList.add('drag-files');
    bumpActivity();
    if (doNotDisturb) return;
    if (isBlackhole()) renderer?.triggerFeed(0.08);
    if (was === 0 && isPet() && !feeding) pet?.beginFeedExpect();
  }

  function onFileDragOver(e) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (doNotDisturb) return;
    if (isBlackhole()) renderer?.triggerFeed(0.035);
  }

  function clearFileDragHover() {
    fileDragDepth = 0;
    hit.classList.remove('drag-over');
    document.body.classList.remove('drag-files');
    if (!feeding) pet?.endFeedExpect();
    if (clickThrough) window.blackHole.setIgnoreMouse(true);
  }

  function onFileDragLeave(e) {
    if (!isFileDrag(e)) return;
    fileDragDepth = Math.max(0, fileDragDepth - 1);
    if (fileDragDepth === 0) clearFileDragHover();
  }

  window.addEventListener('dragenter', onFileDragEnter);
  window.addEventListener('dragover', onFileDragOver);
  window.addEventListener('dragleave', onFileDragLeave);
  window.addEventListener('dragend', clearFileDragHover);

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    fileDragDepth = 0;
    hit.classList.remove('drag-over');
    document.body.classList.remove('drag-files');
    bumpActivity();
    if (clickThrough) window.blackHole.setIgnoreMouse(true);

    if (!isFileDrag(e)) {
      if (!feeding) pet?.endFeedExpect();
      return;
    }

    if (doNotDisturb) {
      pet?.endFeedExpect();
      showToast('勿扰中，先唤醒再投喂');
      return;
    }

    const files = Array.from(e.dataTransfer.files || []);
    const paths = files
      .map((f) => window.blackHole.getPathForFile(f))
      .filter(Boolean);

    if (!paths.length) {
      pet?.endFeedExpect();
      showToast('无法读取文件路径');
      return;
    }

    feeding = true;
    document.body.classList.add('feeding');
    spawnCrumbs(paths.length);

    if (isBlackhole()) renderer?.triggerFeed(1.2);
    if (isPet()) pet?.startEating();

    const eatLabel = themeMeta?.eatLabel || (theme === 'calico' ? '小猫' : '宠物');
    const eatingLabel = isPet() ? `${eatLabel}吃掉了` : '正在吸入';
    showToast(`${eatingLabel} ${paths.length} 项…`);

    try {
      const result = await window.blackHole.recyclePaths(paths);
      const ok = result.results.filter((r) => r.ok).length;
      const fail = result.results.length - ok;
      if (fail === 0) {
        if (isPet()) {
          const custom = themeMeta?.toastOk;
          showToast(custom || (ok === 1 ? `${eatLabel}～进回收站了` : `吃掉 ${ok} 项`));
        } else {
          showToast(ok === 1 ? '已送入回收站' : `已送入回收站（${ok}）`);
        }
        if (isBlackhole()) renderer?.triggerFeed(0.8);
        if (isPet()) pet?.finishEating(true);
      } else {
        showToast(`成功 ${ok}，失败 ${fail}`);
        if (isPet()) pet?.finishEating(false);
      }
    } catch (err) {
      showToast(isPet() ? themeMeta?.toastFail || '吃不下…' : '吸入失败');
      console.error(err);
      if (isPet()) pet?.finishEating(false);
    } finally {
      setTimeout(() => {
        document.body.classList.remove('feeding');
        feeding = false;
      }, 400);
    }
  });

  init();
})();
