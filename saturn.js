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
    return {
      id: seed,
      a: band,
      angle: opts.angle != null ? opts.angle : h2 * Math.PI * 2,
      speed: 0.12 + h3 * 0.22,
      size: 0.028 + hash(seed + 3) * 0.055,
      wobble: hash(seed + 9) * Math.PI * 2,
      hue: 28 + hash(seed + 5) * 28,
      sat: 35 + hash(seed + 7) * 40,
      lit: 42 + hash(seed + 11) * 38,
      life: opts.life != null ? opts.life : 1,
      dying: false,
      birth: opts.birth != null ? opts.birth : 1,
      spark: hash(seed + 13),
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
      // Perspective squash + slight foreshortening
      const depth = Math.sin(angle); // -1 back … +1 front
      return {
        x: cx + x * unit,
        y: cy + y * unit * 0.92,
        depth,
        scale: 0.72 + 0.28 * (depth * 0.5 + 0.5),
      };
    }

    _drawPlanet(ctx, cx, cy, R, t) {
      // Slow axial rotation (~22s per turn) — bands/storms scroll in longitude
      const spin = t * 0.28;

      // Soft glow
      const glow = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.55);
      glow.addColorStop(0, 'rgba(255, 210, 140, 0.22)');
      glow.addColorStop(0.45, 'rgba(255, 180, 90, 0.08)');
      glow.addColorStop(1, 'rgba(255, 160, 60, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.55, 0, Math.PI * 2);
      ctx.fill();

      // Body base
      const body = ctx.createRadialGradient(
        cx - R * 0.28,
        cy - R * 0.32,
        R * 0.1,
        cx,
        cy,
        R
      );
      body.addColorStop(0, '#fff1c8');
      body.addColorStop(0.35, '#e8c078');
      body.addColorStop(0.7, '#c4893a');
      body.addColorStop(1, '#6a3a14');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      // Rotating atmosphere (clipped to sphere)
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();

      const bands = 11;
      for (let i = 0; i < bands; i++) {
        const y = cy - R + (i + 0.5) * ((2 * R) / bands);
        const bandH = R * 0.1;
        const lat = (i / (bands - 1) - 0.5) * 2; // -1..1
        const dir = i % 2 === 0 ? 1 : -0.9; // alternating jet streams
        const alpha = 0.07 + (i % 2) * 0.075;
        ctx.fillStyle =
          i % 2 === 0
            ? `rgba(255, 236, 190, ${alpha})`
            : `rgba(120, 70, 30, ${alpha})`;
        ctx.beginPath();
        ctx.ellipse(cx, y, R * 1.05, bandH, 0, 0, Math.PI * 2);
        ctx.fill();

        // Longitudinal texture scrolling with spin (foreshortened near limbs)
        const blobs = 7;
        for (let k = 0; k < blobs; k++) {
          const lon = (k / blobs) * Math.PI * 2 + spin * dir + i * 0.35;
          const cosL = Math.cos(lon);
          const sinL = Math.sin(lon);
          if (cosL < -0.15) continue; // back side hidden
          const px = cx + sinL * R * Math.sqrt(Math.max(0.05, 1 - lat * lat * 0.85));
          const py = y + Math.sin(lon * 2 + spin) * bandH * 0.15;
          const foreshort = 0.25 + 0.75 * Math.max(0, cosL);
          const bw = R * (0.1 + hash(i * 17 + k) * 0.08) * foreshort;
          const bh = bandH * (0.55 + hash(i * 9 + k) * 0.4);
          ctx.fillStyle =
            i % 2 === 0
              ? `rgba(255, 220, 160, ${0.1 * foreshort})`
              : `rgba(90, 50, 20, ${0.14 * foreshort})`;
          ctx.beginPath();
          ctx.ellipse(px, py, bw, bh, sinL * 0.25, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Great storm — rides with rotation, fades on far limb
      const stormLon = spin * 0.95 + 0.8;
      const stormCos = Math.cos(stormLon);
      if (stormCos > -0.05) {
        const sx = cx + Math.sin(stormLon) * R * 0.4;
        const sy = cy + R * 0.16;
        const foreshort = 0.3 + 0.7 * Math.max(0, stormCos);
        const storm = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 0.2 * foreshort);
        storm.addColorStop(0, `rgba(255, 200, 140, ${0.4 * foreshort})`);
        storm.addColorStop(1, 'rgba(255, 180, 100, 0)');
        ctx.fillStyle = storm;
        ctx.beginPath();
        ctx.ellipse(sx, sy, R * 0.26 * foreshort, R * 0.13, 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Fixed terminator / limb light (sun side — does not spin with atmosphere)
      const shade = ctx.createLinearGradient(cx - R, cy, cx + R * 0.6, cy);
      shade.addColorStop(0, 'rgba(20, 10, 5, 0.38)');
      shade.addColorStop(0.55, 'rgba(20, 10, 5, 0)');
      shade.addColorStop(1, 'rgba(255, 230, 180, 0.08)');
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 240, 200, 0.35)';
      ctx.lineWidth = Math.max(1, R * 0.02);
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.985, -1.2, 0.8);
      ctx.stroke();
    }

    _drawRingBand(ctx, cx, cy, unit, t, front) {
      // Dust sheet
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, Math.sin(TILT));
      // Rings drift slowly with planetary spin for a living system feel
      ctx.rotate(-0.08 + t * 0.04);
      const inner = RING_INNER * unit;
      const outer = RING_OUTER * unit;
      const grad = ctx.createRadialGradient(0, 0, inner, 0, 0, outer);
      if (front) {
        grad.addColorStop(0, 'rgba(255, 220, 160, 0)');
        grad.addColorStop(0.15, 'rgba(255, 210, 150, 0.14)');
        grad.addColorStop(0.45, 'rgba(230, 190, 120, 0.28)');
        grad.addColorStop(0.62, 'rgba(40, 28, 18, 0.12)'); // Cassini-ish gap
        grad.addColorStop(0.78, 'rgba(255, 200, 130, 0.32)');
        grad.addColorStop(1, 'rgba(255, 180, 100, 0)');
      } else {
        grad.addColorStop(0, 'rgba(255, 220, 160, 0)');
        grad.addColorStop(0.2, 'rgba(200, 170, 120, 0.1)');
        grad.addColorStop(0.55, 'rgba(180, 150, 100, 0.18)');
        grad.addColorStop(1, 'rgba(255, 180, 100, 0)');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, outer, 0, Math.PI * 2);
      ctx.arc(0, 0, inner, 0, Math.PI * 2, true);
      ctx.fill('evenodd');

      // Bright edge lines
      ctx.strokeStyle = front
        ? `rgba(255, 230, 180, ${0.35 + this.feed * 0.1})`
        : 'rgba(255, 220, 170, 0.18)';
      ctx.lineWidth = Math.max(1, unit * 0.02);
      ctx.beginPath();
      ctx.arc(0, 0, (RING_INNER + 0.08) * unit, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, (RING_OUTER - 0.06) * unit, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Shimmer spokes (subtle)
      if (front && this.feed > 0.05) {
        ctx.save();
        ctx.globalAlpha = 0.12 * Math.min(1, this.feed);
        for (let i = 0; i < 5; i++) {
          const ang = t * 0.4 + i * 1.1;
          const p0 = this._ringPoint(RING_INNER + 0.1, ang, cx, cy, unit);
          const p1 = this._ringPoint(RING_OUTER - 0.08, ang + 0.08, cx, cy, unit);
          const g = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
          g.addColorStop(0, 'rgba(255,240,200,0)');
          g.addColorStop(0.5, 'rgba(255,230,180,0.9)');
          g.addColorStop(1, 'rgba(255,240,200,0)');
          ctx.strokeStyle = g;
          ctx.lineWidth = unit * 0.04;
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
      const s = rock.size * unit * p.scale * (0.55 + 0.45 * rock.birth) * rock.life;
      if (s < 0.4) return;
      const bob = Math.sin(t * 2.2 + rock.wobble) * unit * 0.012;
      const x = p.x;
      const y = p.y + bob;
      const alpha = Math.max(0, Math.min(1, rock.life * rock.birth * (0.55 + 0.45 * p.scale)));

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang * 0.6 + rock.wobble);
      ctx.globalAlpha = alpha;

      // Glow when newly born / feeding
      if (rock.birth < 0.95 || this.feed > 0.2) {
        ctx.fillStyle = `hsla(${rock.hue}, 80%, 70%, ${0.35 * (1 - rock.birth) + this.feed * 0.08})`;
        ctx.beginPath();
        ctx.arc(0, 0, s * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      const g = ctx.createRadialGradient(-s * 0.3, -s * 0.3, s * 0.1, 0, 0, s);
      g.addColorStop(0, `hsl(${rock.hue}, ${rock.sat}%, ${Math.min(85, rock.lit + 18)}%)`);
      g.addColorStop(0.55, `hsl(${rock.hue}, ${rock.sat}%, ${rock.lit}%)`);
      g.addColorStop(1, `hsl(${rock.hue - 8}, ${rock.sat + 10}%, ${Math.max(18, rock.lit - 22)}%)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      // Irregular pebble
      const spikes = 5 + Math.floor(rock.spark * 3);
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * Math.PI * 2;
        const rr = s * (0.65 + hash(rock.id + i) * 0.45);
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr * 0.85;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();

      // Specular
      ctx.fillStyle = 'rgba(255, 245, 220, 0.45)';
      ctx.beginPath();
      ctx.ellipse(-s * 0.25, -s * 0.28, s * 0.28, s * 0.18, -0.5, 0, Math.PI * 2);
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
        // Arc upward then settle
        const arc = Math.sin(u * Math.PI) * unit * 0.35;
        const s = rock.size * unit * (0.9 - u * 0.25);
        ctx.save();
        ctx.translate(x, y - arc);
        ctx.rotate(m.spin * u);
        // Trail
        ctx.strokeStyle = `hsla(${rock.hue}, 70%, 65%, ${0.45 * (1 - u)})`;
        ctx.lineWidth = Math.max(1, s * 0.5);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo((m.x0 - x) * 0.15, (m.y0 - (y - arc)) * 0.15);
        ctx.stroke();
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 1.8);
        g.addColorStop(0, `hsla(${rock.hue}, 80%, 75%, 0.95)`);
        g.addColorStop(0.4, `hsla(${rock.hue}, 70%, 55%, 0.85)`);
        g.addColorStop(1, 'rgba(255,180,80,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, s * 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `hsl(${rock.hue}, 50%, 55%)`;
        ctx.beginPath();
        ctx.arc(0, 0, s, 0, Math.PI * 2);
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

      // Back ring + back rocks
      this._drawRingBand(ctx, cx, cy, unit, this.time, false);
      const backRocks = [];
      const frontRocks = [];
      for (const rock of this.rocks) {
        const ang = rock.angle + this.time * rock.speed * 0.35;
        const depth = Math.sin(ang);
        if (depth < 0) backRocks.push(rock);
        else frontRocks.push(rock);
      }
      backRocks.sort((a, b) => Math.sin(a.angle) - Math.sin(b.angle));
      for (const rock of backRocks) this._drawRock(ctx, rock, cx, cy, unit, this.time);

      // Planet
      this._drawPlanet(ctx, cx, cy, Rp, this.time);

      // Front ring + front rocks
      this._drawRingBand(ctx, cx, cy, unit, this.time, true);
      frontRocks.sort((a, b) => Math.sin(a.angle) - Math.sin(b.angle));
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
