/**
 * Saturn theme — canvas planet + dynamic ring rocks tied to Recycle Bin count.
 */
(function () {
  const MAX_ROCKS = 96;
  const RING_INNER = 1.55;
  const RING_OUTER = 2.35;
  const TILT = 0.48; // radians ~27°

  function hash(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function makeRock(seed, opts = {}) {
    const h = hash(seed);
    const h2 = hash(seed + 17);
    const h3 = hash(seed + 41);
    const band = RING_INNER + h * (RING_OUTER - RING_INNER);
    // Light-point palette: warm gold / amber / soft white (readable on light desks)
    const huePick = hash(seed + 5);
    const hue = huePick < 0.35 ? 42 + huePick * 20 : huePick < 0.7 ? 28 + huePick * 18 : 48;
    return {
      id: seed,
      a: band,
      angle: opts.angle != null ? opts.angle : h2 * Math.PI * 2,
      speed: 0.12 + h3 * 0.22,
      size: 0.036 + hash(seed + 3) * 0.05,
      wobble: hash(seed + 9) * Math.PI * 2,
      hue,
      sat: 55 + hash(seed + 7) * 35,
      lit: 72 + hash(seed + 11) * 22,
      life: opts.life != null ? opts.life : 1,
      dying: false,
      birth: opts.birth != null ? opts.birth : 1,
      spark: hash(seed + 13),
      pulse: 0.8 + hash(seed + 21) * 1.4,
    };
  }

  class SaturnRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: true });
      this.enabled = false;
      this.lowPower = false;
      this.targetCount = 0;
      this.rocks = [];
      this.incoming = [];
      this.feed = 0;
      this.time = 0;
      this._start = performance.now();
      this._last = this._start;
      this._skip = 0;
      this._seed = 1;
      this._raf = requestAnimationFrame((t) => this.frame(t));
    }

    setEnabled(on) {
      this.enabled = !!on;
      if (!on) {
        const ctx = this.ctx;
        if (ctx) {
          ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
      } else {
        this.resize();
      }
    }

    setLowPower(on) {
      this.lowPower = !!on;
    }

    triggerFeed(strength = 1) {
      this.feed = Math.min(2.4, this.feed + strength);
    }

    _aliveCount() {
      return this.rocks.filter((r) => !r.dying).length + this.incoming.length;
    }

    /** Sync ring rocks to live Recycle Bin item count. */
    setRockCount(n) {
      if (!Number.isFinite(n) || n < 0) return;
      const target = Math.min(MAX_ROCKS, Math.max(0, Math.floor(n)));
      this.targetCount = Math.max(0, Math.floor(n));
      let total = this._aliveCount();

      if (target > total) {
        const need = target - total;
        for (let i = 0; i < need; i++) {
          this._seed += 1;
          this.rocks.push(makeRock(this._seed, { birth: 0, angle: Math.random() * Math.PI * 2 }));
        }
      } else if (target < total) {
        let drop = total - target;
        // Cancel newest incoming first
        while (drop > 0 && this.incoming.length) {
          this.incoming.pop();
          drop -= 1;
        }
        if (drop > 0) {
          const alive = this.rocks.filter((r) => !r.dying);
          const sorted = alive.slice().sort((a, b) => a.spark - b.spark);
          for (let i = 0; i < drop && i < sorted.length; i++) {
            sorted[i].dying = true;
          }
        }
      }
    }

    /** File drop → meteors that settle onto the ring as rocks. */
    ingest(count, clientX, clientY) {
      if (!this.enabled) return;
      const n = Math.min(14, Math.max(1, count | 0));
      const rect = this.canvas.getBoundingClientRect();
      const w = rect.width || 1;
      const h = rect.height || 1;
      let sx = typeof clientX === 'number' ? clientX - rect.left : w * 0.2;
      let sy = typeof clientY === 'number' ? clientY - rect.top : h * 0.15;
      sx = Math.max(0, Math.min(w, sx));
      sy = Math.max(0, Math.min(h, sy));
      this.triggerFeed(0.9 + n * 0.12);
      this.targetCount += n;

      const room = Math.max(0, MAX_ROCKS - this._aliveCount());
      const spawn = Math.min(n, room);
      for (let i = 0; i < spawn; i++) {
        this._seed += 1;
        const rock = makeRock(this._seed, { birth: 0 });
        rock.angle = Math.PI * 0.15 + Math.random() * Math.PI * 0.7;
        this.incoming.push({
          rock,
          x0: sx + (Math.random() - 0.5) * 28,
          y0: sy + (Math.random() - 0.5) * 28,
          t: 0,
          dur: 0.55 + Math.random() * 0.45 + i * 0.04,
          spin: (Math.random() - 0.5) * 10,
        });
      }
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
    }

    _ringPoint(a, angle, cx, cy, unit) {
      const x = Math.cos(angle) * a;
      const y = Math.sin(angle) * a * Math.sin(TILT);
      const depth = Math.sin(angle); // -1 back … +1 front
      const z = depth * 0.5 + 0.5; // 0..1
      return {
        x: cx + x * unit,
        y: cy + y * unit * 0.92 - depth * unit * 0.02,
        depth,
        scale: 0.62 + 0.45 * z,
        shade: 0.7 + 0.3 * z,
      };
    }

    _drawPlanet(ctx, cx, cy, R, t) {
      // Matte gas giant — soft volume, no plastic specular
      const spin = t * 0.28;
      const lx = cx - R * 0.25;
      const ly = cy - R * 0.28;

      const bloom = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R * 1.45);
      bloom.addColorStop(0, 'rgba(255, 200, 130, 0.12)');
      bloom.addColorStop(0.55, 'rgba(255, 170, 90, 0.05)');
      bloom.addColorStop(1, 'rgba(255, 160, 60, 0)');
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.45, 0, Math.PI * 2);
      ctx.fill();

      // Flat-matte body (gentle limb falloff, not chrome ball)
      const body = ctx.createRadialGradient(lx, ly, R * 0.2, cx, cy, R);
      body.addColorStop(0, '#edd9a4');
      body.addColorStop(0.4, '#d4a85a');
      body.addColorStop(0.75, '#a86e2e');
      body.addColorStop(1, '#5c3414');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();

      const bands = 11;
      for (let i = 0; i < bands; i++) {
        const y = cy - R + (i + 0.5) * ((2 * R) / bands);
        const bandH = R * 0.1;
        const lat = (i / (bands - 1) - 0.5) * 2;
        const dir = i % 2 === 0 ? 1 : -0.9;
        const alpha = 0.06 + (i % 2) * 0.06;
        ctx.fillStyle =
          i % 2 === 0
            ? `rgba(255, 232, 185, ${alpha})`
            : `rgba(100, 58, 24, ${alpha})`;
        ctx.beginPath();
        ctx.ellipse(cx, y, R * 1.05, bandH, 0, 0, Math.PI * 2);
        ctx.fill();

        const blobs = 6;
        for (let k = 0; k < blobs; k++) {
          const lon = (k / blobs) * Math.PI * 2 + spin * dir + i * 0.35;
          const cosL = Math.cos(lon);
          const sinL = Math.sin(lon);
          if (cosL < -0.12) continue;
          const px = cx + sinL * R * Math.sqrt(Math.max(0.05, 1 - lat * lat * 0.85));
          const py = y + Math.sin(lon * 2 + spin) * bandH * 0.12;
          const foreshort = 0.3 + 0.7 * Math.max(0, cosL);
          const bw = R * (0.09 + hash(i * 17 + k) * 0.07) * foreshort;
          const bh = bandH * (0.5 + hash(i * 9 + k) * 0.35);
          ctx.fillStyle =
            i % 2 === 0
              ? `rgba(255, 220, 160, ${0.08 * foreshort})`
              : `rgba(85, 48, 20, ${0.1 * foreshort})`;
          ctx.beginPath();
          ctx.ellipse(px, py, bw, bh, sinL * 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const stormLon = spin * 0.95 + 0.8;
      const stormCos = Math.cos(stormLon);
      if (stormCos > -0.05) {
        const sx = cx + Math.sin(stormLon) * R * 0.4;
        const sy = cy + R * 0.16;
        const foreshort = 0.35 + 0.65 * Math.max(0, stormCos);
        const storm = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 0.2 * foreshort);
        storm.addColorStop(0, `rgba(230, 175, 110, ${0.28 * foreshort})`);
        storm.addColorStop(1, 'rgba(255, 180, 100, 0)');
        ctx.fillStyle = storm;
        ctx.beginPath();
        ctx.ellipse(sx, sy, R * 0.24 * foreshort, R * 0.12, 0.3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Soft terminator only (no hard night / plastic rim)
      const shade = ctx.createLinearGradient(cx - R * 0.9, cy, cx + R * 0.7, cy + R * 0.15);
      shade.addColorStop(0, 'rgba(40, 18, 8, 0.28)');
      shade.addColorStop(0.45, 'rgba(40, 18, 8, 0)');
      shade.addColorStop(1, 'rgba(255, 230, 190, 0.04)');
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Very subtle edge, not a chrome highlight
      ctx.strokeStyle = 'rgba(255, 230, 190, 0.18)';
      ctx.lineWidth = Math.max(1, R * 0.015);
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.99, -1.1, 0.5);
      ctx.stroke();
    }

    _drawRingBand(ctx, cx, cy, unit, t, front) {
      // Dusty matte rings — keep contrast low so light-points can sit on top
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, Math.sin(TILT));
      ctx.rotate(-0.08 + t * 0.035);
      const inner = RING_INNER * unit;
      const outer = RING_OUTER * unit;
      const grad = ctx.createRadialGradient(0, 0, inner, 0, 0, outer);
      if (front) {
        grad.addColorStop(0, 'rgba(200, 160, 100, 0)');
        grad.addColorStop(0.15, 'rgba(190, 145, 85, 0.16)');
        grad.addColorStop(0.45, 'rgba(170, 125, 70, 0.28)');
        grad.addColorStop(0.62, 'rgba(50, 32, 16, 0.14)');
        grad.addColorStop(0.8, 'rgba(185, 135, 75, 0.26)');
        grad.addColorStop(1, 'rgba(200, 150, 90, 0)');
      } else {
        grad.addColorStop(0, 'rgba(180, 140, 90, 0)');
        grad.addColorStop(0.25, 'rgba(150, 115, 70, 0.1)');
        grad.addColorStop(0.6, 'rgba(130, 95, 55, 0.14)');
        grad.addColorStop(1, 'rgba(160, 120, 70, 0)');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, outer, 0, Math.PI * 2);
      ctx.arc(0, 0, inner, 0, Math.PI * 2, true);
      ctx.fill('evenodd');

      ctx.strokeStyle = front
        ? `rgba(230, 190, 130, ${0.22 + this.feed * 0.06})`
        : 'rgba(200, 160, 110, 0.1)';
      ctx.lineWidth = Math.max(1, unit * 0.016);
      ctx.beginPath();
      ctx.arc(0, 0, (RING_INNER + 0.07) * unit, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, (RING_OUTER - 0.05) * unit, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      if (front && this.feed > 0.08) {
        ctx.save();
        ctx.globalAlpha = 0.06 * Math.min(1, this.feed);
        for (let i = 0; i < 4; i++) {
          const ang = t * 0.35 + i * 1.2;
          const p0 = this._ringPoint(RING_INNER + 0.1, ang, cx, cy, unit);
          const p1 = this._ringPoint(RING_OUTER - 0.08, ang + 0.06, cx, cy, unit);
          const g = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
          g.addColorStop(0, 'rgba(255,230,180,0)');
          g.addColorStop(0.5, 'rgba(255,220,160,0.8)');
          g.addColorStop(1, 'rgba(255,230,180,0)');
          ctx.strokeStyle = g;
          ctx.lineWidth = unit * 0.03;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    _drawRock(ctx, rock, cx, cy, unit, t) {
      const ang = rock.angle + t * rock.speed * 0.35;
      const p = this._ringPoint(rock.a, ang, cx, cy, unit);
      const twinkle = 0.9 + 0.1 * Math.sin(t * (rock.pulse || 1) * 2.4 + rock.wobble);
      const raw = rock.size * unit * p.scale * (0.75 + 0.25 * rock.birth) * rock.life * twinkle;
      // Opaque light dots with dark collar — readable on white AND dark desks
      const core = Math.max(2.6, raw * 0.85);
      const mid = core * 1.7;
      const collar = core * 2.35;
      if (rock.life < 0.05) return;
      const bob = Math.sin(t * 2.1 + rock.wobble) * unit * 0.008;
      const x = p.x;
      const y = p.y + bob;
      const depthLit = p.shade != null ? p.shade : 1;
      const alpha = Math.max(
        0.55,
        Math.min(1, rock.life * rock.birth * (0.8 + 0.2 * p.scale) * depthLit)
      );

      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'source-over';

      // Dark amber collar for contrast on light wallpapers
      const collarG = ctx.createRadialGradient(0, 0, core * 0.6, 0, 0, collar);
      collarG.addColorStop(0, 'rgba(90, 45, 10, 0)');
      collarG.addColorStop(0.45, 'rgba(70, 35, 8, 0.22)');
      collarG.addColorStop(0.75, 'rgba(40, 18, 4, 0.35)');
      collarG.addColorStop(1, 'rgba(20, 8, 2, 0)');
      ctx.fillStyle = collarG;
      ctx.beginPath();
      ctx.arc(0, 0, collar, 0, Math.PI * 2);
      ctx.fill();

      // Saturated gold body
      const midG = ctx.createRadialGradient(-core * 0.15, -core * 0.15, 0, 0, 0, mid);
      midG.addColorStop(0, `hsla(${rock.hue}, 90%, 68%, 0.95)`);
      midG.addColorStop(0.55, `hsla(${rock.hue}, 85%, 52%, 0.9)`);
      midG.addColorStop(1, `hsla(${rock.hue - 8}, 70%, 38%, 0)`);
      ctx.fillStyle = midG;
      ctx.beginPath();
      ctx.arc(0, 0, mid, 0, Math.PI * 2);
      ctx.fill();

      // Solid bright core (not additive — stays sharp on white)
      ctx.fillStyle = `rgba(255, 248, 230, ${0.92 + this.feed * 0.05})`;
      ctx.beginPath();
      ctx.arc(0, 0, core, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 252, 0.95)';
      ctx.beginPath();
      ctx.arc(-core * 0.15, -core * 0.15, Math.max(0.8, core * 0.4), 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    _drawIncoming(ctx, cx, cy, unit, dt) {
      for (let i = this.incoming.length - 1; i >= 0; i--) {
        const m = this.incoming[i];
        m.t += dt / m.dur;
        const rock = m.rock;
        const target = this._ringPoint(
          rock.a,
          rock.angle + this.time * rock.speed * 0.35,
          cx,
          cy,
          unit
        );
        const u = Math.min(1, m.t);
        const ease = 1 - Math.pow(1 - u, 2.4);
        const x = m.x0 + (target.x - m.x0) * ease;
        const y = m.y0 + (target.y - m.y0) * ease;
        const arc = Math.sin(u * Math.PI) * unit * 0.35;
        const s = Math.max(2.8, rock.size * unit * (1.15 - u * 0.2));
        ctx.save();
        ctx.translate(x, y - arc);
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = `hsla(${rock.hue}, 80%, 45%, ${0.55 * (1 - u)})`;
        ctx.lineWidth = Math.max(1.4, s * 0.5);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo((m.x0 - x) * 0.18, (m.y0 - (y - arc)) * 0.18);
        ctx.stroke();
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 2);
        g.addColorStop(0, 'rgba(255, 252, 240, 1)');
        g.addColorStop(0.35, `hsla(${rock.hue}, 85%, 58%, 0.95)`);
        g.addColorStop(0.7, `hsla(${rock.hue}, 70%, 40%, 0.35)`);
        g.addColorStop(1, 'rgba(80, 40, 10, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, s * 1.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        if (u >= 1) {
          rock.birth = 0;
          this.rocks.push(rock);
          this.incoming.splice(i, 1);
        }
      }
    }

    frame(now) {
      this._raf = requestAnimationFrame((nt) => this.frame(nt));
      if (!this.enabled) return;

      if (this.lowPower && this.feed < 0.02 && this.incoming.length === 0) {
        this._skip = (this._skip + 1) % 3;
        if (this._skip !== 0) return;
      }

      this.resize();
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;
      this.time = (now - this._start) / 1000;
      this.feed = Math.max(0, this.feed - dt * 0.85);

      // Animate birth / death
      for (let i = this.rocks.length - 1; i >= 0; i--) {
        const r = this.rocks[i];
        if (r.birth < 1) r.birth = Math.min(1, r.birth + dt * 2.2);
        if (r.dying) {
          r.life -= dt * 1.6;
          if (r.life <= 0) this.rocks.splice(i, 1);
        }
      }

      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      ctx.clearRect(0, 0, W, H);

      const cx = W * 0.5;
      const cy = H * 0.52;
      const R = Math.min(W, H) * 0.22;
      const unit = R;
      const pulse = 1 + this.feed * 0.04 * Math.sin(this.time * 10);
      const Rp = R * pulse;

      // Soft planet shade on the ring (matte, not dramatic)
      ctx.save();
      ctx.globalAlpha = 0.12;
      const pShadow = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 1.7);
      pShadow.addColorStop(0, 'rgba(20, 10, 4, 0.25)');
      pShadow.addColorStop(1, 'rgba(20, 10, 4, 0)');
      ctx.fillStyle = pShadow;
      ctx.beginPath();
      ctx.ellipse(cx + R * 0.05, cy, R * 1.7, R * 0.48, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Back ring + back rocks (far → near)
      this._drawRingBand(ctx, cx, cy, unit, this.time, false);
      const backRocks = [];
      const frontRocks = [];
      const depthOf = (rock) => Math.sin(rock.angle + this.time * rock.speed * 0.35);
      for (const rock of this.rocks) {
        if (depthOf(rock) < 0) backRocks.push(rock);
        else frontRocks.push(rock);
      }
      backRocks.sort((a, b) => depthOf(a) - depthOf(b));
      for (const rock of backRocks) this._drawRock(ctx, rock, cx, cy, unit, this.time);

      // Planet
      this._drawPlanet(ctx, cx, cy, Rp, this.time);

      // Front ring + front rocks
      this._drawRingBand(ctx, cx, cy, unit, this.time, true);
      frontRocks.sort((a, b) => depthOf(a) - depthOf(b));
      for (const rock of frontRocks) this._drawRock(ctx, rock, cx, cy, unit, this.time);

      // Incoming meteors
      this._drawIncoming(ctx, cx, cy, unit, dt);

    }

    destroy() {
      cancelAnimationFrame(this._raf);
    }
  }

  window.SaturnRenderer = SaturnRenderer;
})();
