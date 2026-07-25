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
  let feeding = false;
  let doNotDisturb = false;
  let clickThrough = true;
  let miniMode = false;
  let contextMenuOpen = false;
  let crumbBurstTimer = null;
  // Click-through state. Stuck ignore=true while cursor is still over #hit is the
  // usual "dead until I click the app" bug — mouseenter won't re-fire. Recover via
  // forwarded mousemove + focus wake.
  let passthroughOn = null;
  let lastPointer = { x: null, y: null };
  let pointerDown = false;
  let dragging = false;
  let fileDragActive = false;
  let fileDragWatch = null;

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

  function spawnCrumbs(count, { blackhole = false } = {}) {
    if (!crumbs) return;
    crumbs.innerHTML = '';
    const n = Math.min(blackhole ? 12 : 8, Math.max(3, count * (blackhole ? 2 : 1)));
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'crumb';
      const ang = Math.random() * Math.PI * 2;
      const dist = blackhole ? 38 + Math.random() * 42 : 0;
      const x = blackhole ? Math.cos(ang) * dist : (Math.random() - 0.5) * 70;
      const y = blackhole ? Math.sin(ang) * dist : -20 - Math.random() * 40;
      el.style.setProperty('--sx', `${x}%`);
      el.style.setProperty('--sy', `${y}%`);
      el.style.animationDelay = `${i * (blackhole ? 0.04 : 0.06)}s`;
      crumbs.appendChild(el);
    }
    clearTimeout(spawnCrumbs._t);
    spawnCrumbs._t = setTimeout(() => {
      crumbs.innerHTML = '';
    }, blackhole ? 1100 : 900);
  }

  function startBlackholeDragFx() {
    if (!isBlackhole() || doNotDisturb) return;
    renderer?.triggerFeed(0.35);
    spawnCrumbs(4, { blackhole: true });
    clearInterval(crumbBurstTimer);
    crumbBurstTimer = setInterval(() => {
      if (!document.body.classList.contains('drag-files')) {
        clearInterval(crumbBurstTimer);
        crumbBurstTimer = null;
        return;
      }
      renderer?.triggerFeed(0.12);
      spawnCrumbs(3, { blackhole: true });
    }, 280);
  }

  function stopBlackholeDragFx() {
    if (crumbBurstTimer) {
      clearInterval(crumbBurstTimer);
      crumbBurstTimer = null;
    }
  }

  function bumpActivity() {
    window.blackHole?.noteActivity?.();
  }

  function pointOverHit(clientX, clientY) {
    if (clientX == null || clientY == null) return false;
    // Use window bounds (matches main-process cursor watch), not only #hit —
    // after alt-tab, #hit :hover/leave is unreliable on transparent windows.
    return (
      clientX >= 0 &&
      clientY >= 0 &&
      clientX < window.innerWidth &&
      clientY < window.innerHeight
    );
  }

  function setPassthrough(ignore) {
    if (!clickThrough || miniMode) {
      if (passthroughOn !== false) {
        passthroughOn = false;
        window.blackHole.setIgnoreMouse(false);
      }
      return;
    }
    const next = !!ignore;
    if (passthroughOn === next) return;
    passthroughOn = next;
    window.blackHole.setIgnoreMouse(next);
  }

  function syncPassthrough(clientX, clientY) {
    if (clientX != null && clientY != null) {
      lastPointer = { x: clientX, y: clientY };
    }
    // While interacting / accepting drops, always capture mouse
    if (pointerDown || dragging || fileDragActive || feeding || contextMenuOpen || miniMode) {
      setPassthrough(false);
      return;
    }
    if (!clickThrough) {
      setPassthrough(false);
      return;
    }
    if (lastPointer.x == null) {
      setPassthrough(true);
      return;
    }
    setPassthrough(!pointOverHit(lastPointer.x, lastPointer.y));
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
    syncPassthrough();
    // Theme/enable reset can race with media IPC — re-sync listening face
    if (isPet() && !doNotDisturb && !miniMode) {
      window.blackHole.getMediaActivity?.()
        .then((playing) => pet?.setListening?.(!!playing))
        .catch(() => {});
    }
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
      else {
        showToast('已唤醒');
        if (isPet() && !miniMode) {
          window.blackHole.getMediaActivity?.()
            .then((playing) => pet?.setListening?.(!!playing))
            .catch(() => {});
        }
      }
    });
    window.blackHole.onLowPowerChanged((on) => {
      renderer?.setLowPower?.(!!on);
    });

    window.blackHole.onMiniModeChange?.((payload) => {
      miniMode = !!payload?.enabled;
      const edge = payload?.edge || 'right';
      const flipAssets = !!themeMeta?.miniMode?.flipAssets;
      document.body.classList.toggle('mini-mode', miniMode);
      document.body.classList.toggle('mini-left', miniMode && edge === 'left');
      document.body.classList.toggle('mini-flip-assets', miniMode && flipAssets);
      if (isPet()) {
        pet?.setMiniMode(miniMode);
      }
      syncPassthrough();
    });

    window.blackHole.onMiniPetState?.((state) => {
      if (isPet() && miniMode) pet?.playMiniState(state);
    });

    window.blackHole.onMiniExited?.(() => {
      miniMode = false;
      document.body.classList.remove('mini-mode', 'mini-left', 'mini-flip-assets');
      if (isPet()) pet?.setMiniMode(false);
      syncPassthrough();
      if (isPet() && !doNotDisturb) {
        window.blackHole.getMediaActivity?.()
          .then((playing) => pet?.setListening?.(!!playing))
          .catch(() => {});
      }
    });

    window.blackHole.onTypingActivity?.((on) => {
      if (!isPet() || doNotDisturb || miniMode) return;
      pet?.setTyping?.(!!on);
    });
    window.blackHole.onMediaActivity?.((on) => {
      if (!isPet() || doNotDisturb || miniMode) return;
      pet?.setListening?.(!!on);
    });
    // Catch media already playing before the listener was registered
    try {
      const playing = await window.blackHole.getMediaActivity?.();
      if (isPet() && !doNotDisturb && !miniMode) pet?.setListening?.(!!playing);
    } catch (_) {}

    let deskFrameBusy = false;
    let deskFramePending = null;
    window.blackHole.onDesktopFrame(async (frame) => {
      if (!isBlackhole() || doNotDisturb || !frame?.data) return;
      // Keep newest frame only — never drop the latest behind a busy decode
      deskFramePending = frame;
      if (deskFrameBusy) return;
      deskFrameBusy = true;
      try {
        while (deskFramePending) {
          const f = deskFramePending;
          deskFramePending = null;
          const bytes =
            f.data instanceof Uint8Array
              ? f.data
              : f.data?.type === 'Buffer'
                ? new Uint8Array(f.data.data)
                : new Uint8Array(f.data);
          await renderer.updateDesktopTexture(bytes, f.padRatio, f.mime || 'image/jpeg');
        }
      } finally {
        deskFrameBusy = false;
      }
    });

    window.blackHole.onClickThroughWake?.(() => {
      // Main confirmed cursor is over our window (or we gained focus).
      // Do NOT immediately re-sync from a stale lastPointer — that re-stuck ignore.
      const r = hit.getBoundingClientRect();
      lastPointer = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      setPassthrough(false);
    });

    syncPassthrough();
  }

  let dragMoved = false;
  let mainDragStarted = false;
  let lastScreen = null;
  let activePointerId = null;
  let pointerWatch = null;

  function armPointerWatch() {
    if (pointerWatch) clearTimeout(pointerWatch);
    pointerWatch = setTimeout(() => {
      pointerWatch = null;
      if (pointerDown || dragging) {
        endPointerDrag(null, { cancel: true });
      }
    }, 12000);
  }

  function clearPointerWatch() {
    if (pointerWatch) {
      clearTimeout(pointerWatch);
      pointerWatch = null;
    }
  }

  function endPointerDrag(e, { cancel = false } = {}) {
    if (!pointerDown && !dragging) return;
    const moved = dragMoved;
    const startedMain = mainDragStarted;
    const pid = activePointerId;
    const clientX = e?.clientX;
    const clientY = e?.clientY;

    clearPointerWatch();
    activePointerId = null;
    pointerDown = false;
    dragging = false;
    lastScreen = null;
    dragMoved = false;
    mainDragStarted = false;

    if (pid != null && hit.hasPointerCapture?.(pid)) {
      try {
        hit.releasePointerCapture(pid);
      } catch (_) {}
    }

    document.body.classList.remove('window-dragging');
    if (miniMode) {
      // Click OR failed drag attempt both undock — previously moving >3px
      // blocked exit and also blocked window drag → "stuck after update"
      if (!cancel) {
        window.blackHole.exitMiniMode?.();
      }
      syncPassthrough(clientX, clientY);
      return;
    }
    if (startedMain) {
      window.blackHole.dragEnd();
      if (moved) pet?.onWindowDragEnd();
    } else if (!cancel && !doNotDisturb) {
      pet?.poke();
    }

    syncPassthrough(clientX, clientY);
  }

  // Forwarded even when ignore=true — primary recovery from stuck passthrough
  window.addEventListener(
    'mousemove',
    (e) => {
      syncPassthrough(e.clientX, e.clientY);
    },
    { passive: true }
  );

  hit.addEventListener('mouseenter', () => {
    setPassthrough(false);
    if (miniMode && !dragging) window.blackHole.miniPeekIn?.();
  });
  hit.addEventListener('mouseleave', (e) => {
    if (dragging || pointerDown || contextMenuOpen || fileDragActive) return;
    if (miniMode) window.blackHole.miniPeekOut?.();
    // Alt-tab / focus change fabricates mouseleave while cursor is still on us
    if (!document.hasFocus()) return;
    syncPassthrough(e.clientX, e.clientY);
  });

  hit.addEventListener(
    'wheel',
    async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (dragging || pointerDown || miniMode) return;
      bumpActivity();
      pet?.notePointer();
      const config = await window.blackHole.getConfig();
      const current = config.size || 360;
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      const next = Math.round(Math.max(160, Math.min(720, current * factor)));
      if (next !== current) {
        await window.blackHole.setSize(next);
        renderer?.resize();
        setPassthrough(false);
      }
    },
    { passive: false }
  );

  window.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (dragging || pointerDown) {
      endPointerDrag(e, { cancel: true });
    }
    bumpActivity();
    pet?.notePointer();
    contextMenuOpen = true;
    setPassthrough(false);
    try {
      await window.blackHole.showContextMenu();
    } catch (_) {}
    contextMenuOpen = false;
    setPassthrough(false);
    setTimeout(() => syncPassthrough(e.clientX, e.clientY), 80);
  });

  hit.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pointerDown = true;
    dragging = true;
    dragMoved = false;
    mainDragStarted = false;
    activePointerId = e.pointerId;
    lastScreen = { x: e.screenX, y: e.screenY };
    bumpActivity();
    pet?.notePointer();
    setPassthrough(false);
    armPointerWatch();
    try {
      hit.setPointerCapture(e.pointerId);
    } catch (_) {}
    e.preventDefault();
  });

  hit.addEventListener('pointermove', (e) => {
    if (!dragging || !lastScreen) return;
    if (activePointerId != null && e.pointerId !== activePointerId) return;
    armPointerWatch();
    const dx = e.screenX - lastScreen.x;
    const dy = e.screenY - lastScreen.y;
    if (!dx && !dy) return;
    const dist = Math.hypot(dx, dy);
    if (!dragMoved && dist <= 3) return;

    // Mini: drag out undocks immediately, then continues as a normal window drag
    if (miniMode) {
      dragMoved = true;
      window.blackHole.exitMiniModeImmediate?.();
      miniMode = false;
      document.body.classList.remove('mini-mode', 'mini-left', 'mini-flip-assets');
      pet?.setMiniMode?.(false);
      mainDragStarted = true;
      document.body.classList.add('window-dragging');
      window.blackHole.dragStart();
      pet?.onWindowDragStart();
      window.blackHole.dragMove();
      lastScreen = { x: e.screenX, y: e.screenY };
      return;
    }

    if (!dragMoved) {
      dragMoved = true;
      mainDragStarted = true;
      document.body.classList.add('window-dragging');
      window.blackHole.dragStart();
      pet?.onWindowDragStart();
    }
    // Main process tracks screen.getCursorScreenPoint() — don't send CSS/DPI deltas
    window.blackHole.dragMove();
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
    // Don't end drag here — capture can drop while the button is still down
    // (fast moves / DPI). Main process keeps following the cursor until pointerup.
  });

  hit.addEventListener('click', (e) => {
    e.preventDefault();
  });

  function isFileDrag(e) {
    return Array.from(e.dataTransfer?.types || []).includes('Files');
  }

  function clearFileDragHover() {
    const was = fileDragActive;
    fileDragActive = false;
    if (fileDragWatch) {
      clearTimeout(fileDragWatch);
      fileDragWatch = null;
    }
    hit.classList.remove('drag-over');
    document.body.classList.remove('drag-files');
    stopBlackholeDragFx();
    if (!feeding) pet?.endFeedExpect();
    if (was) syncPassthrough();
  }

  function armFileDragWatch() {
    if (fileDragWatch) clearTimeout(fileDragWatch);
    fileDragWatch = setTimeout(() => {
      fileDragWatch = null;
      if (fileDragActive) clearFileDragHover();
    }, 200);
  }

  function setFileDragActive(e) {
    const first = !fileDragActive;
    fileDragActive = true;
    if (e && e.clientX != null) {
      lastPointer = { x: e.clientX, y: e.clientY };
    }
    hit.classList.add('drag-over');
    document.body.classList.add('drag-files');
    setPassthrough(false);
    bumpActivity();
    if (doNotDisturb) return;
    if (first) {
      if (isBlackhole()) startBlackholeDragFx();
      if (isPet() && !feeding) pet?.beginFeedExpect();
    }
  }

  function onFileDragEnter(e) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.dataTransfer.dropEffect = 'move';
    } catch (_) {}
    setFileDragActive(e);
    armFileDragWatch();
  }

  function onFileDragOver(e) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.dataTransfer.dropEffect = 'move';
    } catch (_) {}
    setFileDragActive(e);
    armFileDragWatch();
    if (!doNotDisturb && isBlackhole()) renderer?.triggerFeed(0.06);
  }

  function onFileDragLeave(e) {
    if (!isFileDrag(e)) return;
    armFileDragWatch();
  }

  window.addEventListener('dragenter', onFileDragEnter);
  window.addEventListener('dragover', onFileDragOver);
  window.addEventListener('dragleave', onFileDragLeave);
  window.addEventListener('dragend', clearFileDragHover);
  window.addEventListener('blur', () => {
    if (fileDragActive) clearFileDragHover();
    // Don't toggle passthrough here — blur mouseleave is unreliable; main cursor watch owns it
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && fileDragActive) clearFileDragHover();
  });

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const wasFile = isFileDrag(e);
    if (e.clientX != null) lastPointer = { x: e.clientX, y: e.clientY };
    clearFileDragHover();
    bumpActivity();

    if (!wasFile) return;

    if (doNotDisturb) {
      showToast('勿扰中，先唤醒再投喂');
      return;
    }

    setPassthrough(false);

    const files = Array.from(e.dataTransfer.files || []);
    const paths = files
      .map((f) => window.blackHole.getPathForFile(f))
      .filter(Boolean);

    if (!paths.length) {
      showToast('无法读取文件路径');
      syncPassthrough();
      return;
    }

    if (feeding) {
      showToast('还在消化上一次…');
      return;
    }

    feeding = true;
    document.body.classList.add('feeding');
    setPassthrough(false);
    spawnCrumbs(paths.length, { blackhole: isBlackhole() });

    if (isBlackhole()) renderer?.triggerFeed(1.6);
    if (isPet()) pet?.startEating();

    const eatLabel =
      themeMeta?.eatLabel ||
      (theme === 'calico' ? '小猫' : theme === 'danchen' ? '丹童' : '宠物');
    const eatingLabel = isPet() ? `${eatLabel}吃掉了` : '正在吸入';
    showToast(`${eatingLabel} ${paths.length} 项…（大文件/文件夹可能需较久）`, 8000);

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
        if (isBlackhole()) {
          renderer?.triggerFeed(1.0);
          spawnCrumbs(ok, { blackhole: true });
        }
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
        syncPassthrough();
      }, 400);
    }
  });

  init();
})();
