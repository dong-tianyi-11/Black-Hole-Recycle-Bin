/**
 * Generic desk-pet controller driven by theme payload (assetMap + timings).
 */
(function () {
  const CHEW_KEYS = ['eatChew', 'eatChew2', 'eatChew', 'eatChew3', 'eatChew2', 'eatChew'];
  // Slightly slower so cheek / mouth-corner frames read clearly (no whole-body CSS shake)
  const CHEW_FRAME_MS = 110;
  const EAT_KEYS = ['eatOpen', 'eatChew', 'eatChew2', 'eatChew3'];
  const SLEEP_KEYS = ['sleeping', 'dozing', 'collapsing', 'yawning', 'waking'];

  const CYCLE_CANDIDATES = [
    { state: 'idle', hold: 9000 },
    { state: 'idleAnim', hold: 5200 },
    { state: 'idle', hold: 7000 },
    { state: 'thinking', hold: 4500 },
    { state: 'idle', hold: 8000 },
    { state: 'working', hold: 4500 },
    { state: 'idle', hold: 6000 },
    { state: 'juggling', hold: 5200 },
    { state: 'idle', hold: 8000 },
    { state: 'attention', hold: 5000 },
    { state: 'idle', hold: 10000 },
    { state: 'sweeping', hold: 5500 },
    { state: 'idle', hold: 7000 },
    { state: 'carrying', hold: 4500 },
    { state: 'idle', hold: 9000 },
    { state: 'building', hold: 5400 },
    { state: 'idle', hold: 8000 },
    { state: 'conducting', hold: 6000 },
    { state: 'idle', hold: 7000 },
    { state: 'notification', hold: 5200 },
  ];

  class PetController {
    constructor(imgEl) {
      this.img = imgEl;
      this.enabled = false;
      this.state = 'idle';
      this.locked = false;
      this._feeding = false;
      this._dnd = false;
      this._cycleIdx = 0;
      this._timers = [];
      this._lastPointer = Date.now();
      this._busyUntil = 0;
      this._chewTimer = null;
      this._chewIdx = 0;
      this.assetBase = '';
      this.assetMap = {};
      this.timings = {};
      this.sleepMode = 'direct';
      this.idleCycle = [{ state: 'idle', hold: 9000 }];
    }

    applyTheme(payload) {
      this.assetBase = payload?.assetBase || '';
      this.assetMap = { ...(payload?.assetMap || {}) };
      this.timings = { ...(payload?.timings || {}) };
      this.sleepMode = payload?.sleepSequence?.mode === 'full' ? 'full' : 'direct';
      this.idleCycle = CYCLE_CANDIDATES.filter((e) => this.hasAsset(e.state));
      if (!this.idleCycle.length) this.idleCycle = [{ state: 'idle', hold: 9000 }];
      this._preload();
    }

    hasAsset(key) {
      return !!this.assetMap[key];
    }

    _resolveFile(key) {
      if (this.assetMap[key]) return this.assetMap[key];
      if (key === 'eatChew2' || key === 'eatChew3') return this.assetMap.eatChew || null;
      if (key === 'dozing' || key === 'collapsing') return this.assetMap.sleeping || null;
      if (key === 'yawning') return this.assetMap.yawning || this.assetMap.sleeping || null;
      if (key === 'waking') return this.assetMap.waking || this.assetMap.idle || null;
      if (key === 'reactDrag') return this.assetMap.reactDrag || this.assetMap.reactPoke || this.assetMap.idle || null;
      if (key === 'reactPoke') return this.assetMap.reactPoke || this.assetMap.attention || this.assetMap.idle || null;
      if (key === 'error') return this.assetMap.error || this.assetMap.yawning || this.assetMap.idle || null;
      if (key === 'attention' || key === 'notification' || key === 'thinking' || key === 'working') {
        return this.assetMap[key] || this.assetMap.reactPoke || this.assetMap.idle || null;
      }
      return this.assetMap.idle || null;
    }

    _preload() {
      ['eatOpen', 'eatChew', 'eatChew2', 'eatChew3', 'idle'].forEach((k) => {
        const file = this._resolveFile(k);
        if (!file || !this.assetBase) return;
        const im = new Image();
        im.src = this.assetBase + file;
      });
    }

    url(key) {
      const file = this._resolveFile(key);
      if (!file) return '';
      return this.assetBase + file;
    }

    clearTimers() {
      this._timers.forEach((id) => clearTimeout(id));
      this._timers = [];
      this.stopChewLoop();
    }

    later(fn, ms) {
      const id = setTimeout(() => {
        this._timers = this._timers.filter((t) => t !== id);
        fn();
      }, ms);
      this._timers.push(id);
      return id;
    }

    setEnabled(on) {
      this.enabled = !!on;
      this.clearTimers();
      if (this.img) {
        this.img.classList.remove('pet-chewing', 'pet-eating-open');
      }
      if (on) {
        this.locked = false;
        this._lastPointer = Date.now();
        this.play('idle');
        this.scheduleCycle();
        this.scheduleSleepWatch();
      } else if (this.img) {
        this.img.removeAttribute('src');
        this.img.removeAttribute('data-asset');
      }
    }

    play(state, { lock = false, holdMs = null, force = false } = {}) {
      if (!this.enabled || !this.img) return;
      if (this.locked && !lock && !force && state !== this.state) return;

      const key = state || 'idle';
      if (!EAT_KEYS.includes(key)) {
        this.stopChewLoop();
        this.img.classList.remove('pet-chewing', 'pet-eating-open');
      }

      const file = this._resolveFile(key);
      const next = this.url(key);
      if (!next) return;
      const bust = /\.apng$/i.test(file) ? `?t=${Date.now()}` : '';
      if (this.img.dataset.asset !== file || bust) {
        this.img.dataset.asset = file;
        this.img.src = next + bust;
      }
      this.state = key;
      this.locked = !!lock;
      if (lock) {
        const ms = holdMs != null ? holdMs : this.timings[this.state] || 2000;
        this._busyUntil = Date.now() + ms;
        this.later(() => {
          this.locked = false;
          if (this.enabled) this.play('idle');
        }, ms);
      }
    }

    startChewLoop() {
      this.stopChewLoop();
      if (!this.img) return;
      this.img.classList.add('pet-chewing');
      this.img.classList.remove('pet-eating-open');
      this._chewIdx = 0;
      const tick = () => {
        if (!this.enabled) return;
        const key = CHEW_KEYS[this._chewIdx % CHEW_KEYS.length];
        this._chewIdx += 1;
        const file = this._resolveFile(key);
        if (file && this.img.dataset.asset !== file) {
          this.img.dataset.asset = file;
          this.img.src = this.url(key);
        }
        this.state = 'eatChew';
        this._chewTimer = setTimeout(tick, CHEW_FRAME_MS);
      };
      tick();
    }

    stopChewLoop() {
      if (this._chewTimer) {
        clearTimeout(this._chewTimer);
        this._chewTimer = null;
      }
      if (this.img) this.img.classList.remove('pet-chewing');
    }

    notePointer() {
      this._lastPointer = Date.now();
    }

    scheduleCycle() {
      if (!this.enabled) return;
      const step = () => {
        if (!this.enabled) return;
        if (this.locked || Date.now() < this._busyUntil) {
          this.later(step, 800);
          return;
        }
        if ([...SLEEP_KEYS, ...EAT_KEYS].includes(this.state)) {
          this.later(step, 1000);
          return;
        }
        const entry = this.idleCycle[this._cycleIdx % this.idleCycle.length];
        this._cycleIdx += 1;
        this.play(entry.state);
        this.later(step, entry.hold || this.timings[entry.state] || 4000);
      };
      this.later(step, this.idleCycle[0].hold || 9000);
    }

    scheduleSleepWatch() {
      const tick = () => {
        if (!this.enabled || this._dnd) return;
        const idleMs = Date.now() - this._lastPointer;
        if (!this.locked && idleMs > 60000 && !SLEEP_KEYS.includes(this.state)) {
          this.startSleepSequence();
        } else if (
          this.sleepMode === 'full' &&
          !this.locked &&
          idleMs > 20000 &&
          this.state === 'idle' &&
          this._resolveFile('yawning')
        ) {
          this.play('yawning', { lock: true, holdMs: this.timings.yawning || 3500 });
        }
        this.later(tick, 4000);
      };
      this.later(tick, 5000);
    }

    startSleepSequence() {
      if (this.locked) return;
      this.clearTimers();
      if (this.sleepMode === 'direct' || !this._resolveFile('yawning')) {
        this.play('sleeping');
        this.scheduleSleepWatch();
        return;
      }
      const y = this.timings.yawning || 3500;
      const d = this.timings.dozing || 3000;
      const c = this.timings.collapsing || 2800;
      this.play('yawning', { lock: true, holdMs: y });
      this.later(() => {
        if (!this.enabled) return;
        this.locked = false;
        this.play('dozing', { lock: true, holdMs: d });
        this.later(() => {
          if (!this.enabled) return;
          this.locked = false;
          this.play('collapsing', { lock: true, holdMs: c });
          this.later(() => {
            if (!this.enabled) return;
            this.locked = false;
            this.play('sleeping');
            this.scheduleSleepWatch();
          }, c);
        }, d);
      }, y);
    }

    wake() {
      if (!this.enabled) return;
      if (!SLEEP_KEYS.includes(this.state)) return;
      this.clearTimers();
      this.locked = false;
      const w = this.timings.waking || 2000;
      if (this._resolveFile('waking') && this.assetMap.waking) {
        this.play('waking', { lock: true, holdMs: w });
        this.later(() => {
          this.scheduleCycle();
          this.scheduleSleepWatch();
        }, w + 50);
      } else {
        this.play('idle', { force: true });
        this.scheduleCycle();
        this.scheduleSleepWatch();
      }
    }

    setDoNotDisturb(on) {
      this._dnd = !!on;
      if (!this.enabled) return;
      if (this._dnd) {
        this.clearTimers();
        this.locked = false;
        this._feeding = false;
        this.play('sleeping', { force: true });
      } else {
        this.notePointer();
        this.locked = false;
        this.play('idle', { force: true });
        this.scheduleCycle();
        this.scheduleSleepWatch();
      }
    }

    poke() {
      if (!this.enabled) return;
      if (this._dnd) return;
      this.notePointer();
      if (['sleeping', 'dozing', 'collapsing', 'yawning'].includes(this.state)) {
        this.wake();
        return;
      }
      if (this.locked) return;
      this.play('reactPoke', { lock: true, holdMs: this.timings.reactPoke || 1400 });
    }

    onWindowDragStart() {
      if (!this.enabled || this._dnd) return;
      if (EAT_KEYS.includes(this.state)) return;
      // Freeze current frame — switching to reactDrag APNG looked larger than idle
      this._windowDragging = true;
      this.clearTimers();
      this.locked = true;
    }

    onWindowDragEnd() {
      if (!this.enabled) return;
      if (!this._windowDragging && this.state !== 'reactDrag') return;
      this._windowDragging = false;
      this.locked = false;
      if (this.state === 'reactDrag') this.play('idle');
      if (!this._dnd && !this._feeding) {
        this.scheduleCycle();
        this.scheduleSleepWatch();
      }
    }

    beginFeedExpect() {
      if (!this.enabled || this._feeding || this._dnd) return;
      if (this.state === 'eatOpen' && this.locked) {
        this._busyUntil = Date.now() + 60000;
        return;
      }
      this.notePointer();
      this.clearTimers();
      this.play('eatOpen', { force: true });
      this.img?.classList.add('pet-eating-open');
      this.img?.classList.remove('pet-chewing');
      this.locked = true;
      this._busyUntil = Date.now() + 60000;
    }

    endFeedExpect() {
      if (!this.enabled) return;
      if (this._feeding) return;
      if (!EAT_KEYS.includes(this.state) && !this.img?.classList.contains('pet-eating-open')) {
        return;
      }
      this.locked = false;
      this._busyUntil = 0;
      this.stopChewLoop();
      this.img?.classList.remove('pet-eating-open', 'pet-chewing');
      this.play('idle', { force: true });
      this.scheduleCycle();
      this.scheduleSleepWatch();
    }

    startEating() {
      if (!this.enabled || this._dnd) return;
      this._feeding = true;
      this.notePointer();
      this.clearTimers();
      this.locked = true;
      this._busyUntil = Date.now() + 120000;

      this.play('eatOpen', { force: true });
      this.img?.classList.add('pet-eating-open');

      this.later(() => {
        if (!this._feeding) return;
        this.img?.classList.remove('pet-eating-open');
        this.startChewLoop();
      }, 260);
    }

    finishEating(ok = true) {
      if (!this.enabled) return;
      this.stopChewLoop();
      this.img?.classList.remove('pet-eating-open', 'pet-chewing');
      this._feeding = false;
      this.locked = false;
      this._busyUntil = 0;

      if (ok) {
        this.play('idle', { force: true });
        this.scheduleCycle();
        this.scheduleSleepWatch();
      } else {
        const errMs = this.timings.error || 3500;
        this.play('error', { lock: true, holdMs: errMs, force: true });
        this.later(() => {
          this.scheduleCycle();
          this.scheduleSleepWatch();
        }, errMs + 50);
      }
    }
  }

  window.PetController = PetController;
  // Back-compat alias
  window.CalicoPet = PetController;
})();
