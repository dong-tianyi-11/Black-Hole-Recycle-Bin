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
    // Size: many pebbles, fewer chunks (power curve)
    const sizeRoll = Math.pow(hash(seed + 3), 2.4);
    const size = 0.012 + sizeRoll * 0.11;
    // Brighter stone palette: warm sand / pale gold / soft grey
    const tone = hash(seed + 5);
    let baseR; let baseG; let baseB;
    if (tone < 0.34) {
      baseR = 175 + hash(seed + 6) * 50;
      baseG = 155 + hash(seed + 7) * 40;
      baseB = 120 + hash(seed + 8) * 35;
    } else if (tone < 0.68) {
      baseR = 205 + hash(seed + 6) * 40;
      baseG = 180 + hash(seed + 7) * 35;
      baseB = 130 + hash(seed + 8) * 30;
    } else {
      baseR = 168 + hash(seed + 6) * 45;
      baseG = 160 + hash(seed + 7) * 40;
      baseB = 145 + hash(seed + 8) * 35;
    }
    // Irregular pebble outline (5–8 verts)
    const n = 5 + Math.floor(hash(seed + 19) * 4);
    const verts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash(seed + 30 + i) * 0.45;
      const rr = 0.55 + hash(seed + 50 + i) * 0.55;
      verts.push({ a, r: rr });
    }
    return {
      id: seed,
      a: band,
      angle: opts.angle != null ? opts.angle : h2 * Math.PI * 2,
      speed: 0.1 + h3 * 0.2,
      size,
      wobble: hash(seed + 9) * Math.PI * 2,
      spin: hash(seed + 23) * Math.PI * 2,
      spinSpeed: (hash(seed + 27) - 0.5) * 0.35,
      aspect: 0.55 + hash(seed + 31) * 0.4,
      baseR,
      baseG,
      baseB,
      verts,
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
      this.triggerFeed(0.7 + n * 0.1);
      this.targetCount += n;

      const room = Math.max(0, MAX_ROCKS - this._aliveCount());
      const spawn = Math.min(n, room);
      for (let i = 0; i < spawn; i++) {
        this._seed += 1;
        const rock = makeRock(this._seed, { birth: 0 });
        // Land on the front arc of the ring for a clear settle path
        rock.angle = Math.PI * 0.12 + Math.random() * Math.PI * 0.76;
        const spread = 18 + i * 2.5;
        this.incoming.push({
          rock,
          x0: sx + (Math.random() - 0.5) * spread,
          y0: sy + (Math.random() - 0.5) * spread,
          t: 0,
          delay: i * 0.055,
          dur: 0.95 + Math.random() * 0.45,
          spin: (Math.random() - 0.5) * 5.5,
          swirl: (Math.random() > 0.5 ? 1 : -1) * (0.55 + Math.random() * 0.65),
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
      // Dusty matte rings — keep contrast low so rock grains can sit on top
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

    _rockPath(ctx, rock, r) {
      const verts = rock.verts || [{ a: 0, r: 1 }];
      ctx.beginPath();
      for (let i = 0; i < verts.length; i++) {
        const v = verts[i];
        const px = Math.cos(v.a) * v.r * r;
        const py = Math.sin(v.a) * v.r * r * (rock.aspect || 0.75);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }

    _drawRock(ctx, rock, cx, cy, unit, t) {
      const ang = rock.angle + t * rock.speed * 0.35;
      const p = this._ringPoint(rock.a, ang, cx, cy, unit);
      const raw = rock.size * unit * p.scale * (0.72 + 0.28 * rock.birth) * rock.life;
      // Tiny pebbles stay visible; large chunks read as real ring rocks
      const r = Math.max(1.4, raw * 1.05);
      if (rock.life < 0.05) return;
      const bob = Math.sin(t * 1.6 + rock.wobble) * unit * 0.004;
      const x = p.x;
      const y = p.y + bob;
      const depthLit = p.shade != null ? p.shade : 1;
      const alpha = Math.max(
        0.72,
        Math.min(1, rock.life * rock.birth * (0.85 + 0.15 * p.scale) * depthLit)
      );
      const shade = 0.9 + 0.1 * depthLit;
      const br = Math.round(rock.baseR * shade);
      const bg = Math.round(rock.baseG * shade);
      const bb = Math.round(rock.baseB * shade);
      const darkR = Math.max(0, br - 28);
      const darkG = Math.max(0, bg - 24);
      const darkB = Math.max(0, bb - 20);
      const litR = Math.min(255, br + 55);
      const litG = Math.min(255, bg + 48);
      const litB = Math.min(255, bb + 36);

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((rock.spin || 0) + t * (rock.spinSpeed || 0));
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'source-over';

      // Soft contact shadow so grains stay readable on light desks
      ctx.fillStyle = 'rgba(40, 22, 10, 0.14)';
      ctx.beginPath();
      ctx.ellipse(r * 0.12, r * 0.22, r * 1.05, r * 0.55, 0.2, 0, Math.PI * 2);
      ctx.fill();

      // Bright matte stone body
      const body = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r * 1.15);
      body.addColorStop(0, `rgb(${litR},${litG},${litB})`);
      body.addColorStop(0.4, `rgb(${br},${bg},${bb})`);
      body.addColorStop(1, `rgb(${darkR},${darkG},${darkB})`);
      ctx.fillStyle = body;
      this._rockPath(ctx, rock, r);
      ctx.fill();

      // Thin rocky rim
      ctx.strokeStyle = `rgba(${darkR},${darkG},${darkB},0.55)`;
      ctx.lineWidth = Math.max(0.55, r * 0.1);
      this._rockPath(ctx, rock, r);
      ctx.stroke();

      // Specular chip — keeps pebbles reading as lit stone
      if (r > 2.4) {
        ctx.fillStyle = `rgba(255, 248, 230, ${0.35 + Math.min(0.25, r * 0.02)})`;
        ctx.beginPath();
        ctx.ellipse(-r * 0.22, -r * 0.28, r * 0.24, r * 0.15, -0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    _drawIncoming(ctx, cx, cy, unit, dt) {
      for (let i = this.incoming.length - 1; i >= 0; i--) {
        const m = this.incoming[i];
        if (m.delay > 0) {
          m.delay -= dt;
          continue;
        }
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
        // Smoothstep — soft accelerate then settle
        const ease = u * u * u * (u * (u * 6 - 15) + 10);
        const midX = (m.x0 + target.x) * 0.5 + (target.y - m.y0) * 0.22 * (m.swirl || 1);
        const midY = (m.y0 + target.y) * 0.5 - unit * 0.42;
        const omt = 1 - ease;
        const x = omt * omt * m.x0 + 2 * omt * ease * midX + ease * ease * target.x;
        const y = omt * omt * m.y0 + 2 * omt * ease * midY + ease * ease * target.y;
        const s = Math.max(1.8, rock.size * unit * (1.15 - ease * 0.2) * (0.85 + 0.2 * Math.sin(u * Math.PI)));
        const fade = u < 0.08 ? u / 0.08 : 1;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(x, y);
        ctx.rotate(m.spin * ease);
        ctx.globalCompositeOperation = 'source-over';
        // Soft dust streak
        const trailA = 0.28 * (1 - ease);
        if (trailA > 0.02) {
          ctx.strokeStyle = `rgba(${rock.baseR},${rock.baseG},${rock.baseB},${trailA})`;
          ctx.lineWidth = Math.max(1, s * 0.4);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo((m.x0 - x) * 0.12, (m.y0 - y) * 0.12);
          ctx.stroke();
        }
        const br = Math.min(255, rock.baseR + 20);
        const bg = Math.min(255, rock.baseG + 16);
        const bb = Math.min(255, rock.baseB + 10);
        const g = ctx.createRadialGradient(-s * 0.25, -s * 0.3, 0, 0, 0, s * 1.4);
        g.addColorStop(0, `rgb(${Math.min(255, br + 50)},${Math.min(255, bg + 42)},${Math.min(255, bb + 28)})`);
        g.addColorStop(0.55, `rgb(${br},${bg},${bb})`);
        g.addColorStop(1, `rgb(${Math.max(0, br - 35)},${Math.max(0, bg - 30)},${Math.max(0, bb - 25)})`);
        ctx.fillStyle = g;
        this._rockPath(ctx, rock, s);
        ctx.fill();
        ctx.strokeStyle = `rgba(${Math.max(0, br - 40)},${Math.max(0, bg - 35)},${Math.max(0, bb - 30)},0.55)`;
        ctx.lineWidth = Math.max(0.55, s * 0.09);
        this._rockPath(ctx, rock, s);
        ctx.stroke();
        ctx.restore();

        if (u >= 1) {
          rock.birth = 0.15;
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
      this.feed = Math.max(0, this.feed - dt * 0.55);

      // Animate birth / death
      for (let i = this.rocks.length - 1; i >= 0; i--) {
        const r = this.rocks[i];
        if (r.birth < 1) r.birth = Math.min(1, r.birth + dt * 1.4);
        if (r.dying) {
          r.life -= dt * 1.1;
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
      const pulse = 1 + this.feed * 0.028 * Math.sin(this.time * 6.5);
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
