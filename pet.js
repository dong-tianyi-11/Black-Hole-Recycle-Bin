/**
 * Generic desk-pet controller driven by theme payload (assetMap + timings).
 */
(function () {
  const CHEW_KEYS = ['eatChew', 'eatChew2', 'eatChew', 'eatChew3', 'eatChew2', 'eatChew'];
  // Slightly slower so cheek / mouth-corner frames read clearly (no whole-body CSS shake)
  const CHEW_FRAME_MS = 110;
  const EAT_KEYS = ['eatOpen', 'eatChew', 'eatChew2', 'eatChew3'];
  const SLEEP_KEYS = ['sleeping', 'dozing', 'collapsing', 'yawning', 'waking'];
  const MINI_KEYS = ['miniIdle', 'miniEnter', 'miniPeek', 'miniSleep'];

  // Note: `working` (typing / 炼丹) is NOT in the random cycle — only while user is typing.
  const CYCLE_CANDIDATES = [
    { state: 'idle', hold: 8000 },
    { state: 'idleAnim', hold: 6000 },
    { state: 'idle', hold: 7000 },
    { state: 'idleAnim', hold: 5500 },
    { state: 'idle', hold: 6000 },
    { state: 'attention', hold: 4200 },
    { state: 'idle', hold: 9000 },
    { state: 'thinking', hold: 4500 },
    { state: 'idle', hold: 7000 },
    { state: 'juggling', hold: 5200 },
    { state: 'idle', hold: 8000 },
    { state: 'notification', hold: 4200 },
    { state: 'idle', hold: 9000 },
    { state: 'sweeping', hold: 5500 },
    { state: 'idle', hold: 7000 },
    { state: 'carrying', hold: 4500 },
    { state: 'idle', hold: 8000 },
    { state: 'building', hold: 5400 },
    { state: 'idle', hold: 7000 },
    { state: 'conducting', hold: 6000 },
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
      this._miniMode = false;
      this._pendingMiniState = null;
      this._typing = false;
      this._listening = false;
      this._windowDragging = false;
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
      if (key === 'listening') {
        return this.assetMap.listening || this.assetMap.attention || this.assetMap.idle || null;
      }
      if (key === 'error') return this.assetMap.error || this.assetMap.yawning || this.assetMap.idle || null;
      if (key === 'miniIdle' || key === 'miniEnter' || key === 'miniPeek' || key === 'miniSleep') {
        return (
          this.assetMap[key] ||
          this.assetMap.miniIdle ||
          this.assetMap.idle ||
          null
        );
      }
      if (key === 'attention' || key === 'notification' || key === 'thinking' || key === 'working') {
        return this.assetMap[key] || this.assetMap.reactPoke || this.assetMap.idle || null;
      }
      return this.assetMap.idle || null;
    }

    _preload() {
      [
        'idle',
        'idleAnim',
        'attention',
        'working',
        'eatOpen',
        'eatChew',
        'eatChew2',
        'eatChew3',
        'reactPoke',
        'reactDrag',
        'miniIdle',
        'miniEnter',
        'miniPeek',
        'listening',
      ].forEach((k) => {
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
        this._busyUntil = 0;
        this._lastPointer = Date.now();
        // Keep typing/listening flags — monitors own them; just restore the right face
        if (this._miniMode) {
          this.play(this._dnd ? 'miniSleep' : 'miniIdle', { force: true });
          return;
        }
        if (this._dnd) {
          this.play('sleeping', { force: true });
        } else if (this._typing) {
          this.play('working', { force: true });
        } else if (this._listening && this._resolveFile('listening')) {
          this.play('listening', { force: true });
        } else {
          this.play('idle', { force: true });
        }
        this.scheduleCycle();
        this.scheduleSleepWatch();
      } else {
        this._typing = false;
        this._listening = false;
        if (this.img) {
          this.img.removeAttribute('src');
          this.img.removeAttribute('data-asset');
        }
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
      // Bust APNG cache only when switching assets (avoid restarting typing loop)
      const sameAsset = this.img.dataset.asset === file;
      if (!sameAsset || force) {
        const bust = /\.(apng|png)$/i.test(file) ? `?t=${Date.now()}` : '';
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
          if (!this.enabled) return;
          this.resumeAmbient();
        }, ms);
      }
    }

    /** Return to the correct ambient face after a lock / interruption. */
    resumeAmbient() {
      if (!this.enabled) return;
      this.locked = false;
      this._busyUntil = 0;
      if (this._miniMode) {
        this.play(this._dnd ? 'miniSleep' : 'miniIdle', { force: true });
        return;
      }
      if (this._dnd) {
        this.play('sleeping', { force: true });
        return;
      }
      if (this._feeding || this._windowDragging) return;
      if (this._typing && this._resolveFile('working')) {
        this.play('working', { force: true });
        this.scheduleCycle();
        this.scheduleSleepWatch();
        return;
      }
      if (this._listening && this._resolveFile('listening')) {
        this.play('listening', { force: true });
        this.scheduleCycle();
        this.scheduleSleepWatch();
        return;
      }
      this.play('idle', { force: true });
      this.scheduleCycle();
      this.scheduleSleepWatch();
    }

    setMiniMode(on) {
      const next = !!on;
      const was = this._miniMode;
      this._miniMode = next;
      if (!this.enabled) return;
      if (this._miniMode) {
        this.clearTimers();
        this.locked = false;
        this._feeding = false;
        // Keep _typing / _listening flags — restore on exit via resumeAmbient
        // Show a mini face immediately so idle/working isn't cropped as "broken mini"
        const pending = this._pendingMiniState;
        this._pendingMiniState = null;
        if (pending) {
          this.playMiniState(pending);
        } else {
          this.play(this._dnd ? 'miniSleep' : 'miniIdle', { force: true });
        }
      } else if (was) {
        this.locked = false;
        this.clearTimers();
        this.resumeAmbient();
      }
    }

    playMiniState(key) {
      if (!this.enabled) return;
      const k = key || 'miniIdle';
      // Buffer if mini-mode IPC hasn't landed yet (race with mini-pet-state)
      if (!this._miniMode) {
        this._pendingMiniState = k;
        return;
      }
      if (!this._resolveFile(k) && !this._resolveFile('miniIdle') && !this._resolveFile('idle')) {
        return;
      }
      if (k === 'miniEnter') {
        this.play('miniEnter', {
          lock: true,
          holdMs: this.timings.miniEnter || 1200,
          force: true,
        });
      } else {
        this.play(k, { force: true });
      }
    }

    hasMiniAssets() {
      return !!(this.assetMap.miniIdle || this.assetMap.miniEnter || this.assetMap.miniPeek);
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

    /**
     * Keyboard typing → show working (敲键盘); stop typing → listening or idle.
     * Does not interrupt eating / mini / DnD / drag reactions.
     */
    setTyping(on) {
      const next = !!on;
      if (this._typing === next) {
        if (next) this.notePointer();
        return;
      }
      this._typing = next;
      if (!this.enabled || this._dnd || this._miniMode || this._feeding) return;
      if (this._windowDragging) return;
      if (EAT_KEYS.includes(this.state) || this.state === 'eatOpen') return;

      if (next) {
        this.notePointer();
        // Wake from sleep on real typing
        if (SLEEP_KEYS.includes(this.state)) {
          this.clearTimers();
          this.locked = false;
        }
        if (this.locked && this.state !== 'working') return;
        this.clearTimers();
        this.locked = false;
        this._busyUntil = 0;
        this.play('working', { force: true });
        // Keep cycle alive so unlock/idle can't leave typing stuck off
        this.scheduleCycle();
        this.scheduleSleepWatch();
        return;
      }

      // Stopped typing → music listening takes over if active
      if (this.state === 'working' || this.state === 'idle') {
        this.resumeAmbient();
      }
    }

    /**
     * System music playing → listening pose; stop → idle (unless typing).
     */
    setListening(on) {
      const next = !!on;
      const changed = this._listening !== next;
      this._listening = next;
      if (!this.enabled || this._dnd || this._miniMode || this._feeding) return;
      if (this._windowDragging) return;
      // Typing always wins over music face
      if (this._typing) return;
      if (EAT_KEYS.includes(this.state) || this.state === 'eatOpen') return;
      if (!this._resolveFile('listening')) return;

      if (next) {
        // Already showing it and flag unchanged — nothing to do
        if (!changed && this.state === 'listening') return;
        this.notePointer();
        if (SLEEP_KEYS.includes(this.state)) {
          this.clearTimers();
          this.locked = false;
        }
        // Break out of short reaction locks so music can show
        this.clearTimers();
        this.locked = false;
        this._busyUntil = 0;
        this.play('listening', { force: true });
        this.scheduleCycle();
        this.scheduleSleepWatch();
        return;
      }

      if (changed && this.state === 'listening') {
        this.resumeAmbient();
      }
    }

    scheduleCycle() {
      if (!this.enabled) return;
      const step = () => {
        if (!this.enabled) return;
        if (this._miniMode) {
          this.later(step, 2000);
          return;
        }
        if (this._typing) {
          // Stay on working while keys are active
          if (this.state !== 'working' && !this.locked && !this._feeding) {
            this.play('working', { force: true });
          }
          this.later(step, 600);
          return;
        }
        if (this._listening && this._resolveFile('listening')) {
          if (this.state !== 'listening' && !this._feeding && this.state !== 'working') {
            this.locked = false;
            this.play('listening', { force: true });
          }
          this.later(step, 800);
          return;
        }
        if (this.locked || Date.now() < this._busyUntil) {
          this.later(step, 800);
          return;
        }
        if ([...SLEEP_KEYS, ...EAT_KEYS, ...MINI_KEYS, 'working', 'listening'].includes(this.state)) {
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
        if (!this.enabled || this._dnd || this._miniMode) {
          this.later(tick, 4000);
          return;
        }
        // Never sleep/yawn over typing or listening faces
        if (this._typing || this._listening) {
          this.later(tick, 4000);
          return;
        }
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
        // lock unlock → resumeAmbient (typing/listening aware)
      } else {
        this.resumeAmbient();
      }
    }

    setDoNotDisturb(on) {
      this._dnd = !!on;
      if (!this.enabled) return;
      if (this._dnd) {
        this.clearTimers();
        this.locked = false;
        this._feeding = false;
        this._typing = false;
        this._listening = false;
        this.play(this._miniMode ? 'miniSleep' : 'sleeping', { force: true });
      } else {
        this.notePointer();
        this.locked = false;
        this.resumeAmbient();
      }
    }

    poke() {
      if (!this.enabled) return;
      if (this._dnd) return;
      if (this._miniMode) return;
      this.notePointer();
      if (['sleeping', 'dozing', 'collapsing', 'yawning'].includes(this.state)) {
        this.wake();
        return;
      }
      if (this.locked) return;
      this.play('reactPoke', { lock: true, holdMs: this.timings.reactPoke || 1400 });
    }

    onWindowDragStart() {
      if (!this.enabled || this._dnd || this._miniMode) return;
      if (EAT_KEYS.includes(this.state)) return;
      this._windowDragging = true;
      this.clearTimers();
      // Prefer dedicated drag face; always force-swap so APNG/idle don't stick
      if (this.hasAsset('reactDrag') || this._resolveFile('reactDrag')) {
        this.play('reactDrag', { force: true });
      } else if (!['idle', 'idleAnim', 'working', 'listening'].includes(this.state)) {
        this.play('idle', { force: true });
      }
      // Keep locked for the whole drag (play() without lock would unlock)
      this.locked = true;
      this._busyUntil = Date.now() + 86400000;
    }

    onWindowDragEnd() {
      if (!this.enabled) return;
      if (!this._windowDragging && this.state !== 'reactDrag') return;
      this._windowDragging = false;
      this.locked = false;
      this._busyUntil = 0;
      this.resumeAmbient();
    }

    beginFeedExpect() {
      if (!this.enabled || this._feeding || this._dnd) return;
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
      this.locked = false;
      this._busyUntil = 0;
      this.stopChewLoop();
      this.img?.classList.remove('pet-eating-open', 'pet-chewing');
      this.resumeAmbient();
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
        this.resumeAmbient();
      } else {
        const errMs = this.timings.error || 3500;
        this.play('error', { lock: true, holdMs: errMs, force: true });
        // lock unlock → resumeAmbient
      }
    }
  }

  window.PetController = PetController;
  // Back-compat alias
  window.CalicoPet = PetController;
})();
