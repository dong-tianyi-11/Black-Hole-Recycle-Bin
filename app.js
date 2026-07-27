(function () {
  const canvas = document.getElementById('bh');
  const saturnCanvas = document.getElementById('saturn');
  const hit = document.getElementById('hit');
  const toast = document.getElementById('toast');
  const petImg = document.getElementById('pet-img');
  const crumbs = document.getElementById('crumbs');
  let renderer;
  let saturn;
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
  let undockDragPending = false;

  function isPet() {
    return themeType === 'pet';
  }

  function isBlackhole() {
    return themeType === 'blackhole';
  }

  function isSaturn() {
    return themeType === 'saturn';
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

  /** Shared RAF orbit pool — avoids stacking many rAF loops while sucking. */
  const orbitPool = [];
  let orbitRaf = 0;
  const TEAR_CLASSES = ['', 'tear-a', 'tear-b', 'tear-c'];

  function placeOrbitShred(p, t) {
    const u = Math.max(0, Math.min(1, t));
    // Smoothstep — silkier spiral than hard quadratic crush
    const ease = u * u * u * (u * (u * 6 - 15) + 10);
    const r = p.r0 * Math.exp(-(p.pull || 2.2) * ease);
    const theta = p.theta0 + p.turns * Math.PI * 2 * ease;
    const x = p.tx + Math.cos(theta) * r;
    const y = p.ty + Math.sin(theta) * r;
    // Soft shear mid-flight, then gently crush into the horizon
    const tear = Math.pow(Math.max(0, (ease - 0.12) / 0.88), 1.15);
    const spin = p.rot0 + p.spin * ease * 360;
    const crush = 1 - ease * 0.9;
    const sx = p.size0 * crush * (1 + tear * p.stretchX);
    const sy = p.size0 * crush * (1 - tear * p.stretchY);
    const skew = tear * p.skew * 22;
    const opacity =
      t < 0
        ? 0
        : t < 0.06
          ? t / 0.06
          : Math.max(0, 1 - Math.pow(ease, 1.35) * 1.05);
    p.el.style.transform =
      `translate3d(${(x - p.hw).toFixed(1)}px,${(y - p.hh).toFixed(1)}px,0)` +
      ` rotate(${spin.toFixed(1)}deg) skewX(${skew.toFixed(1)}deg)` +
      ` scale(${sx.toFixed(3)},${sy.toFixed(3)})`;
    p.el.style.opacity = opacity.toFixed(2);
  }

  function pushOrbitShred(opts) {
    const el = document.createElement('div');
    const tearCls = opts.tear
      ? TEAR_CLASSES[Math.floor(Math.random() * TEAR_CLASSES.length)]
      : '';
    el.className = tearCls ? `orbit-shred ${tearCls}` : 'orbit-shred';
    el.style.opacity = '0';
    crumbs.appendChild(el);
    const hw = (el.offsetWidth || 14) * 0.5;
    const hh = (el.offsetHeight || 16) * 0.5;
    const p = {
      el,
      r0: opts.r0,
      theta0: opts.theta0,
      turns: opts.turns,
      duration: opts.duration,
      born: opts.born,
      size0: opts.size0,
      tx: opts.tx,
      ty: opts.ty,
      hw,
      hh,
      rot0: opts.rot0 ?? Math.random() * 360,
      spin: opts.spin,
      stretchX: opts.stretchX,
      stretchY: opts.stretchY,
      skew: opts.skew,
      pull: opts.pull ?? 2.5,
      cracked: false,
      canCrack: !!opts.canCrack,
    };
    // Park at start pose immediately so delayed pieces never sit at (0,0) / border
    placeOrbitShred(p, 0);
    p.el.style.opacity = '0';
    orbitPool.push(p);
    return p;
  }

  function ensureOrbitTick() {
    if (orbitRaf) return;
    const tick = (now) => {
      let alive = 0;
      for (let i = orbitPool.length - 1; i >= 0; i--) {
        const p = orbitPool[i];
        const t = (now - p.born) / p.duration;
        if (t < 0) {
          placeOrbitShred(p, 0);
          p.el.style.opacity = '0';
          alive += 1;
          continue;
        }
        if (t >= 1) {
          p.el.remove();
          orbitPool.splice(i, 1);
          continue;
        }
        alive += 1;
        placeOrbitShred(p, t);

        // Soft mid-flight split — fewer, gentler scraps
        if (p.canCrack && !p.cracked && t > 0.34 && t < 0.58 && orbitPool.length < 18) {
          p.cracked = true;
          const room = Math.max(0, 18 - orbitPool.length);
          const kids = Math.min(room, 1 + (Math.random() > 0.55 ? 1 : 0));
          for (let k = 0; k < kids; k++) {
            const kick = (Math.random() - 0.5) * 0.55;
            pushOrbitShred({
              tear: true,
              r0: Math.max(12, p.r0 * (0.62 + Math.random() * 0.28)),
              theta0: p.theta0 + kick,
              turns: p.turns * (0.75 + Math.random() * 0.45) * (Math.random() > 0.5 ? 1 : -1),
              duration: p.duration * (0.55 + Math.random() * 0.22),
              born: now,
              size0: p.size0 * (0.4 + Math.random() * 0.28),
              tx: p.tx,
              ty: p.ty,
              spin: (2.2 + Math.random() * 2.8) * (Math.random() > 0.5 ? 1 : -1),
              stretchX: 0.45 + Math.random() * 0.7,
              stretchY: 0.3 + Math.random() * 0.45,
              skew: (Math.random() - 0.5) * 1.6,
              pull: 2.4 + Math.random() * 0.8,
              canCrack: false,
            });
          }
        }
      }
      if (alive > 0 || orbitPool.length) {
        orbitRaf = requestAnimationFrame(tick);
      } else {
        orbitRaf = 0;
      }
    };
    orbitRaf = requestAnimationFrame(tick);
  }

  /** Log-spiral: files glide in, softly tear, and settle into the horizon / mouth. */
  function spawnOrbitSuck(count, clientX, clientY) {
    if (!crumbs) return;
    // Cap total live shreds so drop + drag never flood the compositor
    const room = Math.max(0, 14 - orbitPool.length);
    if (room <= 0) return;
    const bh = isBlackhole();
    const perFile = bh ? 3 : 2;
    const n = Math.min(room, Math.min(12, Math.max(3, (count || 1) * perFile)));
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const tx = w * 0.5;
    const ty = isPet() ? h * 0.42 : h * 0.5;
    // Prefer a ring around the hole — drop coords are often on the window edge
    const minDim = Math.min(w, h);
    const ring = minDim * (bh ? 0.34 : 0.28);
    let sx = typeof clientX === 'number' ? clientX : tx;
    let sy = typeof clientY === 'number' ? clientY : ty * 0.55;
    const fromEdge =
      sx < w * 0.12 || sx > w * 0.88 || sy < h * 0.12 || sy > h * 0.88;
    if (bh && (fromEdge || typeof clientX !== 'number')) {
      const a0 = Math.random() * Math.PI * 2;
      sx = tx + Math.cos(a0) * ring;
      sy = ty + Math.sin(a0) * ring;
    } else {
      sx = Math.max(minDim * 0.15, Math.min(w - minDim * 0.15, sx));
      sy = Math.max(minDim * 0.15, Math.min(h - minDim * 0.15, sy));
    }
    const now = performance.now();

    for (let i = 0; i < n; i++) {
      const jitter = (bh ? 8 : 12) + Math.random() * (bh ? 22 : 24);
      const jAng = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const x0 = sx + Math.cos(jAng) * jitter;
      const y0 = sy + Math.sin(jAng) * jitter;
      const r0 = Math.max(bh ? minDim * 0.22 : 20, Math.hypot(x0 - tx, y0 - ty));
      const theta0 = Math.atan2(y0 - ty, x0 - tx);
      const turns = (bh ? 1.05 : 0.75) + Math.random() * (bh ? 0.9 : 0.7);
      const dir = Math.random() > 0.22 ? 1 : -1;
      pushOrbitShred({
        tear: bh,
        r0,
        theta0,
        turns: turns * dir,
        duration: (bh ? 920 : 780) + Math.random() * (bh ? 280 : 260),
        born: now + i * (bh ? 28 : 36),
        size0: bh ? 0.95 + Math.random() * 0.55 : 0.8 + Math.random() * 0.45,
        tx,
        ty,
        spin: ((bh ? 2.4 : 1.5) + Math.random() * (bh ? 2.8 : 2.2)) * (Math.random() > 0.5 ? 1 : -1),
        stretchX: bh ? 0.4 + Math.random() * 0.65 : 0.22 + Math.random() * 0.35,
        stretchY: bh ? 0.28 + Math.random() * 0.45 : 0.16 + Math.random() * 0.28,
        skew: (Math.random() - 0.5) * (bh ? 1.6 : 1.1),
        pull: bh ? 2.35 + Math.random() * 0.7 : 2.05 + Math.random() * 0.45,
        canCrack: bh && i % 3 === 0,
      });
    }
    ensureOrbitTick();
  }

  function syncHungerFromSize(size, baseSize) {
    const s = Number(size) || 360;
    const b = Number(baseSize) || 360;
    const grown = Math.max(0, s - b);
    const hunger = Math.min(1, grown / 280);
    renderer?.setHunger?.(hunger);
  }

  function startBlackholeDragFx() {
    if (!isBlackhole() || doNotDisturb) return;
    // Hover only: mild lens pull — shred/spin waits until drop
    renderer?.triggerFeed(0.35);
    clearInterval(crumbBurstTimer);
    crumbBurstTimer = setInterval(() => {
      if (!document.body.classList.contains('drag-files')) {
        clearInterval(crumbBurstTimer);
        crumbBurstTimer = null;
        return;
      }
      renderer?.triggerFeed(0.12);
    }, 400);
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

  function syncSaturnRocks(n) {
    if (!isSaturn() || !saturn) return;
    if (Number.isFinite(n) && n >= 0) saturn.setRockCount(n);
  }

  function applyTheme(payload) {
    themeMeta = payload || null;
    theme = payload?.theme || payload?.id || 'blackhole';
    themeType =
      payload?.type ||
      (theme === 'blackhole' ? 'blackhole' : theme === 'saturn' ? 'saturn' : 'pet');
    doNotDisturb = !!payload?.doNotDisturb;
    clickThrough = payload?.clickThrough !== false;
    document.body.dataset.theme = theme;
    document.body.dataset.themeType = themeType;

    if (isPet() && payload) {
      pet?.applyTheme(payload);
    }
    renderer?.setEnabled(isBlackhole());
    saturn?.setEnabled(isSaturn());
    pet?.setEnabled(isPet());
    if (isPet()) pet?.setDoNotDisturb(doNotDisturb);
    renderer?.setLowPower?.(!!payload?.lowPowerIdle);
    saturn?.setLowPower?.(!!payload?.lowPowerIdle);
    renderer?.resize();
    saturn?.resize?.();
    syncPassthrough();
    if (isSaturn()) {
      window.blackHole.getRecycleBinCount?.()
        .then((n) => syncSaturnRocks(n))
        .catch(() => {});
    }
    // Theme/enable reset can race with activity IPC — re-sync faces
    if (isPet() && !doNotDisturb && !miniMode) syncPetAmbientActivity();
  }

  function syncPetAmbientActivity() {
    if (!isPet() || doNotDisturb || miniMode) return;
    Promise.all([
      window.blackHole.getMediaActivity?.().catch(() => false),
      window.blackHole.getTypingActivity?.().catch(() => false),
    ])
      .then(([playing, typing]) => {
        if (!isPet() || doNotDisturb || miniMode) return;
        // Typing wins over listening
        pet?.setTyping?.(!!typing);
        pet?.setListening?.(!!playing);
      })
      .catch(() => {});
  }

  async function init() {
    renderer = new window.BlackHoleRenderer(canvas);
    saturn = window.SaturnRenderer && saturnCanvas
      ? new window.SaturnRenderer(saturnCanvas)
      : null;
    pet = new window.PetController(petImg);

    const cfg = await window.blackHole.getConfig();
    if (cfg.themeMeta) {
      applyTheme(cfg.themeMeta);
    } else {
      theme = cfg.theme || 'blackhole';
      themeType =
        theme === 'blackhole' ? 'blackhole' : theme === 'saturn' ? 'saturn' : 'pet';
      document.body.dataset.theme = theme;
      document.body.dataset.themeType = themeType;
      renderer.setEnabled(isBlackhole());
      saturn?.setEnabled(isSaturn());
      pet.setEnabled(isPet());
    }

    syncHungerFromSize(cfg.size, cfg.baseSize ?? cfg.size);
    window.blackHole.onSizeChanged((size) => {
      renderer?.resize();
      saturn?.resize?.();
      window.blackHole.getConfig?.().then((c) => {
        syncHungerFromSize(size ?? c?.size, c?.baseSize ?? c?.size);
      }).catch(() => {});
    });
    window.blackHole.onPetGrown?.((payload) => {
      syncHungerFromSize(payload?.size, payload?.baseSize);
      if (isBlackhole()) renderer?.triggerFeed(0.45);
      if (isSaturn()) saturn?.triggerFeed?.(0.55);
    });
    window.blackHole.onPetShrunk?.((payload) => {
      syncHungerFromSize(payload?.size, payload?.baseSize);
      showToast(
        isPet()
          ? '消食了，变回原大小'
          : isSaturn()
            ? '光环消散，恢复原尺寸'
            : '引力消退，恢复原尺寸'
      );
    });
    window.blackHole.onRecycleBinCount?.((n) => syncSaturnRocks(n));
    window.blackHole.onThemeChanged((payload) => applyTheme(payload));
    window.blackHole.onDndChanged((on) => {
      doNotDisturb = !!on;
      pet?.setDoNotDisturb(doNotDisturb);
      if (doNotDisturb) showToast('已进入勿扰 / 睡眠');
      else {
        showToast('已唤醒');
        syncPetAmbientActivity();
      }
    });
    window.blackHole.onLowPowerChanged((on) => {
      renderer?.setLowPower?.(!!on);
      saturn?.setLowPower?.(!!on);
    });

    window.blackHole.onMiniModeChange?.((payload) => {
      miniMode = !!payload?.enabled;
      const edge = payload?.edge || 'right';
      const flipAssets = !!themeMeta?.miniMode?.flipAssets;
      document.body.classList.toggle('mini-mode', miniMode);
      document.body.classList.toggle('mini-left', miniMode && edge === 'left');
      document.body.classList.toggle('mini-flip-assets', miniMode && flipAssets);
      if (!miniMode) document.body.classList.remove('mini-peeking');
      if (isPet()) {
        pet?.setMiniMode(miniMode);
      }
      syncPassthrough();
    });

    window.blackHole.onMiniPetState?.((state) => {
      // Always forward — pet buffers if miniMode flag hasn't flipped yet
      if (isPet()) pet?.playMiniState(state);
    });

    window.blackHole.onMiniPeek?.((peeking) => {
      document.body.classList.toggle('mini-peeking', !!peeking);
    });
    window.blackHole.onMiniExited?.(() => {
      miniMode = false;
      document.body.classList.remove('mini-mode', 'mini-left', 'mini-flip-assets', 'mini-peeking');
      if (isPet()) pet?.setMiniMode(false);
      syncPassthrough();
      syncPetAmbientActivity();
    });

    window.blackHole.onTypingActivity?.((on) => {
      if (!isPet() || doNotDisturb || miniMode) return;
      pet?.setTyping?.(!!on);
    });
    window.blackHole.onMediaActivity?.((on) => {
      if (!isPet() || doNotDisturb || miniMode) return;
      pet?.setListening?.(!!on);
    });
    // Catch media/typing already active before the listener was registered
    try {
      const playing = await window.blackHole.getMediaActivity?.();
      const typing = await window.blackHole.getTypingActivity?.();
      if (isPet() && !doNotDisturb && !miniMode) {
        if (typing) pet?.setTyping?.(true);
        else pet?.setListening?.(!!playing);
      }
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
    const wasUndocking = undockDragPending;
    const pid = activePointerId;
    const clientX = e?.clientX;
    const clientY = e?.clientY;

    clearPointerWatch();
    activePointerId = null;
    pointerDown = false;
    dragging = false;
    undockDragPending = false;
    lastScreen = null;
    dragMoved = false;
    mainDragStarted = false;

    if (pid != null && hit.hasPointerCapture?.(pid)) {
      try {
        hit.releasePointerCapture(pid);
      } catch (_) {}
    }

    document.body.classList.remove('window-dragging');
    // Click to leave mini (no drag). Skip if a drag-undock is already in flight.
    if (miniMode && !wasUndocking && !moved) {
      if (!cancel) window.blackHole.exitMiniMode?.();
      syncPassthrough(clientX, clientY);
      return;
    }
    if (startedMain) {
      window.blackHole.dragEnd();
      if (moved) pet?.onWindowDragEnd();
    } else if (!cancel && !doNotDisturb && !miniMode && !wasUndocking) {
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
    if (miniMode && !dragging) {
      document.body.classList.add('mini-peeking');
      window.blackHole.miniPeekIn?.();
    }
  });
  hit.addEventListener('mouseleave', (e) => {
    if (dragging || pointerDown || contextMenuOpen || fileDragActive) return;
    if (miniMode) {
      document.body.classList.remove('mini-peeking');
      window.blackHole.miniPeekOut?.();
    }
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
        saturn?.resize?.();
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

    // Mini: wait for undock to finish in main, then start window drag
    if (miniMode || undockDragPending) {
      if (undockDragPending) return;
      dragMoved = true;
      undockDragPending = true;
      document.body.classList.remove('mini-peeking');
      document.body.classList.add('mini-undocking');
      const sx = e.screenX;
      const sy = e.screenY;
      void (async () => {
        try {
          await window.blackHole.exitMiniModeImmediate?.();
        } catch (_) {}
        if (!pointerDown) {
          undockDragPending = false;
          document.body.classList.remove('mini-undocking');
          return;
        }
        miniMode = false;
        document.body.classList.remove('mini-mode', 'mini-left', 'mini-flip-assets');
        pet?.setMiniMode?.(false);
        mainDragStarted = true;
        document.body.classList.add('window-dragging');
        window.blackHole.dragStart();
        pet?.onWindowDragStart();
        window.blackHole.dragMove();
        lastScreen = { x: sx, y: sy };
        undockDragPending = false;
        clearTimeout(endPointerDrag._undockFx);
        endPointerDrag._undockFx = setTimeout(() => {
          document.body.classList.remove('mini-undocking');
        }, 320);
      })();
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
      if (isSaturn()) saturn?.triggerFeed?.(0.35);
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
    if (e.clientX != null) lastPointer = { x: e.clientX, y: e.clientY };
    setFileDragActive(e);
    armFileDragWatch();
    if (!doNotDisturb && isBlackhole()) renderer?.triggerFeed(0.06);
    if (!doNotDisturb && isSaturn()) saturn?.triggerFeed?.(0.05);
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
    if (isSaturn()) {
      saturn?.ingest(paths.length, e.clientX, e.clientY);
    } else if (isBlackhole()) {
      spawnOrbitSuck(paths.length, e.clientX, e.clientY);
      renderer?.triggerFeed(1.2);
    } else {
      spawnOrbitSuck(paths.length, e.clientX, e.clientY);
      spawnCrumbs(Math.min(4, paths.length), { blackhole: false });
    }

    if (isPet()) pet?.startEating();

    const eatLabel =
      themeMeta?.eatLabel ||
      (theme === 'calico' ? '小猫' : theme === 'danchen' ? '丹童' : theme === 'saturn' ? '土星' : '宠物');
    const eatingLabel = isPet()
      ? `${eatLabel}吃掉了`
      : isSaturn()
        ? '正在镶进光环'
        : '正在吸入';
    showToast(`${eatingLabel} ${paths.length} 项…（大文件/文件夹可能需较久）`, 8000);

    try {
      const result = await window.blackHole.recyclePaths(paths);
      const ok = result.results.filter((r) => r.ok).length;
      const fail = result.results.length - ok;
      if (fail === 0) {
        if (isPet()) {
          const custom = themeMeta?.toastOk;
          showToast(custom || (ok === 1 ? `${eatLabel}～进回收站了` : `吃掉 ${ok} 项`));
        } else if (isSaturn()) {
          showToast(themeMeta?.toastOk || (ok === 1 ? '已镶进光环' : `${ok} 块碎石镶进光环`));
          saturn?.triggerFeed?.(0.8);
        } else {
          showToast(ok === 1 ? '已送入回收站' : `已送入回收站（${ok}）`);
        }
        if (isBlackhole()) {
          renderer?.triggerFeed(1.0);
        }
        if (isPet()) pet?.finishEating(true);
      } else {
        showToast(`成功 ${ok}，失败 ${fail}`);
        if (isPet()) pet?.finishEating(false);
      }
    } catch (err) {
      showToast(
        isPet()
          ? themeMeta?.toastFail || '吃不下…'
          : isSaturn()
            ? themeMeta?.toastFail || '没接住…'
            : '吸入失败'
      );
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
