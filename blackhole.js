/**
 * Photorealistic black hole — reference plate + animated lensing / Doppler disk.
 */
(function () {
  const VS = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = a_pos * 0.5 + 0.5;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  // Composite: reference blackhole texture (premultiplied look) + desktop lensing + feed
  const FS = `
    precision highp float;
    varying vec2 v_uv;

    uniform float u_time;
    uniform vec2  u_res;
    uniform float u_feed;
    uniform float u_hunger;
    uniform float u_intensity;
    uniform float u_hasDesktop;
    uniform float u_hasPlate;
    uniform float u_padRatio;
    uniform float u_deskMix;
    uniform float u_hasDesktopPrev;
    uniform sampler2D u_desktop;
    uniform sampler2D u_desktopPrev;
    uniform sampler2D u_plate;

    float hash(vec2 p) {
      p = fract(p * vec2(127.1, 311.7));
      p += dot(p, p + 19.19);
      return fract(p.x * p.y);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
      for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p = m * p;
        a *= 0.5;
      }
      return v;
    }

    vec2 windowToCaptureUV(vec2 uv) {
      float p = max(u_padRatio, 0.001);
      return (uv + p) / (1.0 + 2.0 * p);
    }

    // Convex prism + geodesic lens — warps a wide neighborhood of the desktop
    vec2 lensUV(vec2 p, float eh, float aspect) {
      float r = length(p);
      float rSafe = max(r, 1e-4);
      float feedBoost = 1.0 + u_feed * 1.15 + u_hunger * 0.4;
      vec2 dir = p / rSafe;

      // --- Convex magnifier concentrated in a thin ring around the hole ---
      float dome = smoothstep(0.72, eh * 1.15, rSafe) * smoothstep(eh * 0.95, eh * 1.25, rSafe);
      float convexK = (0.38 + u_feed * 0.22 + u_hunger * 0.1) * dome;
      float rLens = rSafe * (1.0 - convexK * (1.0 - rSafe * rSafe * 0.5));
      float barrel = 1.0 + (0.12 + u_feed * 0.1) * rSafe * rSafe * dome;
      rLens *= barrel;

      // Schwarzschild-like extra pull near the horizon
      float rs = eh * 0.95;
      float denom = max(1.0 - rs / max(rLens, 1e-4), 0.06);
      float pull = clamp((rs / max(rLens, 1e-4)) / denom * 1.7 * feedBoost, 0.0, 4.2);

      // Frame-dragging swirl
      float swirl = pull * 1.55 + u_time * 0.24 + 0.1 * sin(u_time * 0.5)
        + u_feed * 0.95 + u_hunger * 0.2;
      float s = sin(swirl), c = cos(swirl);
      mat2 rot = mat2(c, -s, s, c);

      float stretch = 1.0 + pull * 2.2 * smoothstep(eh * 6.0, eh * 0.7, rLens);
      float ringPinch = 1.0 - 0.34 * exp(-pow((rLens - eh * 1.36) / 0.05, 2.0));
      float fold = 1.0 + 0.5 * pull * exp(-pow((rLens - eh * 2.0) / 0.17, 2.0));

      vec2 bent = rot * dir * rLens * stretch * ringPinch * fold;
      float ang = atan(p.y, p.x);
      float shear = pull * 0.2 * sin(u_time * 0.4 + ang * 2.0);
      bent += vec2(-dir.y, dir.x) * (shear * rLens + pull * 0.035 * log(1.0 + rLens * 3.0));
      return vec2(bent.x / aspect, bent.y) * 0.5 + 0.5;
    }

    // Radial prism dispersion (R/G/B at slightly different radii + angles)
    vec3 sampleDesktopAt(sampler2D tex, vec2 pf, float eh, float aspect) {
      float r = max(length(pf), 1e-4);
      vec2 dir = pf / r;
      vec2 tang = vec2(-dir.y, dir.x);
      float prism = (0.018 + u_feed * 0.022) * smoothstep(0.95, eh * 1.1, r);
      prism *= (0.55 + 0.45 * smoothstep(eh * 1.15, 0.55, r));

      // Cheap path far out / low prism: one sample
      if (prism < 0.006) {
        vec2 lu = clamp(windowToCaptureUV(lensUV(pf, eh, aspect)), 0.001, 0.999);
        return texture2D(tex, lu).rgb;
      }

      vec2 pR = dir * (r + prism * 1.15) + tang * prism * 0.35;
      vec2 pG = pf;
      vec2 pB = dir * (r - prism * 1.15) - tang * prism * 0.35;
      vec2 luR = clamp(windowToCaptureUV(lensUV(pR, eh, aspect)), 0.001, 0.999);
      vec2 luG = clamp(windowToCaptureUV(lensUV(pG, eh, aspect)), 0.001, 0.999);
      vec2 luB = clamp(windowToCaptureUV(lensUV(pB, eh, aspect)), 0.001, 0.999);
      return vec3(
        texture2D(tex, luR).r,
        texture2D(tex, luG).g,
        texture2D(tex, luB).b
      );
    }

    vec3 sampleDesktopWarped(vec2 pf, float eh, float aspect) {
      vec3 cur = sampleDesktopAt(u_desktop, pf, eh, aspect);
      // Skip crossfade while feeding hard — halves texture work during suck
      if (u_hasDesktopPrev < 0.5 || u_feed > 0.35) return cur;
      vec3 prev = sampleDesktopAt(u_desktopPrev, pf, eh, aspect);
      return mix(prev, cur, clamp(u_deskMix, 0.0, 1.0));
    }

    // Reference plate palette: white → gold → amber → deep ember
    vec3 plasma(float t) {
      vec3 c0 = vec3(1.00, 0.98, 0.92);
      vec3 c1 = vec3(1.00, 0.88, 0.48);
      vec3 c2 = vec3(1.00, 0.62, 0.16);
      vec3 c3 = vec3(0.95, 0.38, 0.06);
      vec3 c4 = vec3(0.32, 0.07, 0.01);
      float x = clamp(t, 0.0, 1.0);
      if (x < 0.2) return mix(c0, c1, x / 0.2);
      if (x < 0.45) return mix(c1, c2, (x - 0.2) / 0.25);
      if (x < 0.72) return mix(c2, c3, (x - 0.45) / 0.27);
      return mix(c3, c4, (x - 0.72) / 0.28);
    }

    void main() {
      vec2 uv = v_uv;
      vec2 p = (uv - 0.5) * 2.0;
      float aspect = u_res.x / max(u_res.y, 1.0);
      p.x *= aspect;

      float pulse = 1.0 + u_feed * 0.09 * sin(u_time * 15.0) + u_hunger * 0.02;
      vec2 pf = p / pulse;
      float r = length(pf);
      float ang = atan(pf.y, pf.x);

      // Match reference plate silhouette (large EH + lensed halo)
      float eh = 0.30 + u_hunger * 0.018;
      float ph = eh * 1.22;

      // Tight circular window — thin lens ring around the plate
      float circleMask = 1.0 - smoothstep(0.76, 0.90, r);
      if (circleMask < 0.001) {
        gl_FragColor = vec4(0.0);
        return;
      }

      vec3 col = vec3(0.0);
      float alpha = 0.0;

      // ===== 1) Desktop through convex prism — narrow warped ring =====
      if (u_hasDesktop > 0.5) {
        vec3 desk = sampleDesktopWarped(pf, eh * 0.88, aspect);

        float warpInner = smoothstep(eh * 1.05, eh * 1.4, r);
        float warpOuter = 1.0 - smoothstep(0.56, 0.74, r);
        float warp = pow(max(warpInner * warpOuter, 0.0), 0.55);
        // Thin glass lip only near the photon ring (not a wide dome)
        float domeA = exp(-pow((r - ph) / 0.085, 2.0)) * smoothstep(eh * 1.05, eh * 1.3, r);
        warp = max(warp, domeA * (0.4 + u_feed * 0.2));

        float mag = 1.0
          + (2.1 + u_hunger * 0.4) * exp(-pow((r - ph) / 0.038, 2.0))
          + 0.85 * exp(-pow((r - eh * 1.12) / 0.028, 2.0))
          + 0.45 * exp(-pow((r - ph * 1.45) / 0.08, 2.0));

        float deskA = clamp(warp * 0.98, 0.0, 1.0);
        col = mix(col, desk * mag, deskA);
        alpha = max(alpha, deskA);

        // Prism fringe hugging the photon ring
        float rim = exp(-pow((r - ph) / 0.045, 2.0)) * (0.22 + u_feed * 0.3);
        col += vec3(0.55, 0.75, 1.0) * rim * 0.12;
        col += vec3(1.0, 0.45, 0.35) * rim * 0.08;
        alpha = max(alpha, rim * 0.28);

        float deskLum = dot(desk, vec3(0.3, 0.59, 0.11));
        float swirlBand = pow(abs(sin(ang * 5.0 - u_time * 1.7 - log(max(r, 0.05)) * 6.5)), 8.0);
        swirlBand *= warp * smoothstep(eh * 1.12, 0.72, r) * (0.3 + 0.7 * deskLum);
        col += desk * swirlBand * (0.45 + u_feed * 0.3);
        alpha = max(alpha, swirlBand * 0.4);
      }

      // ===== 2) Accretion plate — preserve reference composition =====
      if (u_hasPlate > 0.5) {
        // Very slow frame-drag; keep diagonal disk orientation from the plate
        float spin = u_time * 0.08 + u_feed * 0.35;
        float cs = cos(spin), sn = sin(spin);
        vec2 q = mat2(cs, -sn, sn, cs) * pf;

        float rr = length(q);
        float aa = atan(q.y, q.x);
        float flow = fbm(vec2(aa * 1.8 - u_time * 0.55, log(max(rr, 0.05)) * 3.2));
        // Gentle filament shimmer — do not reshape the silhouette
        aa += (flow - 0.5) * 0.06;
        rr *= 1.0 + 0.012 * sin(u_time * 0.7 + aa * 2.0);
        q = vec2(cos(aa), sin(aa)) * rr;

        // Fill the window with the plate (tight crop already punched)
        vec2 tuv = vec2(q.x / aspect, q.y) * 0.5 + 0.5;
        tuv = (tuv - 0.5) / 0.88 + 0.5;

        if (tuv.x > 0.001 && tuv.x < 0.999 && tuv.y > 0.001 && tuv.y < 0.999) {
          vec4 plate = texture2D(u_plate, tuv);
          float plateZone = 1.0 - smoothstep(0.62, 0.82, rr);
          float pa = plate.a * plateZone;
          float plLum = dot(plate.rgb, vec3(0.3, 0.59, 0.11));
          // Drop empty near-black leftovers outside the horizon
          if (plLum < 0.035 && plate.a > 0.5 && rr > eh * 1.08) {
            pa *= 0.0;
          }

          // Keep plate colors faithful to the reference (gold / amber / white)
          vec3 prgb = plate.rgb;
          prgb = mix(prgb, prgb * vec3(1.06, 0.98, 0.88), 0.18);

          // Photon-ring breath (critical curve glow)
          float ringPulse = 0.08 * sin(u_time * 1.9) + 0.05 * sin(u_time * 3.8 + aa);
          float nearRing = exp(-pow(abs(rr - ph) / 0.065, 2.0));
          float secondary = exp(-pow(abs(rr - ph * 1.55) / 0.09, 2.0)) * 0.35;
          prgb += vec3(1.0, 0.93, 0.72) * (nearRing + secondary) * (ringPulse + 0.08 * u_hunger) * plate.a;

          // Doppler: approaching limb brighter / blueshifted edge
          float doppler = 0.92 + 0.16 * clamp(q.x * 0.75 + 0.1 * sin(u_time * 0.45), -0.4, 0.75);
          prgb *= doppler;
          prgb *= mix(vec3(1.06, 0.96, 0.88), vec3(0.92, 0.96, 1.08), clamp(0.5 + q.x * 0.35, 0.0, 1.0));

          // Mild HDR lift so bloom reads like the reference
          prgb *= 1.0 + 0.12 * smoothstep(0.25, 0.85, plLum) * u_intensity;

          col = mix(col, prgb, clamp(pa, 0.0, 1.0));
          alpha = max(alpha, clamp(pa, 0.0, 1.0));
        }
      } else {
        // Procedural fallback (tilted Interstellar disk)
        float fil = fbm(vec2(ang * 2.2 - u_time * 0.65, log(max(r, 0.04)) * 5.0));
        fil = pow(smoothstep(0.18, 0.88, fil), 1.15);
        float tilt = abs(pf.y * 0.55 + pf.x * 0.28);
        float dRing = abs(r - ph);
        float ringW = mix(0.018, 0.06, smoothstep(0.0, 0.35, tilt));
        float ring = exp(-pow(dRing / ringW, 2.0));
        float disk = exp(-pow(tilt / 0.14, 2.0)) * smoothstep(eh * 0.95, 0.55, r);
        float halo = (ring * 1.1 + disk * 0.85) * (0.5 + 0.5 * fil);
        col += plasma(0.12 + 0.3 * (1.0 - fil)) * halo * 2.0 * u_intensity;
        alpha = max(alpha, clamp(halo * 1.35, 0.0, 1.0));
        float core = 1.0 - smoothstep(eh * 0.94, eh * 1.04, r);
        col = mix(col, vec3(0.0), core);
        alpha = max(alpha, core * 0.999);
      }

      // Event horizon punch — crisp black sphere like the plate
      float coreMask = 1.0 - smoothstep(eh * 0.93, eh * 1.05, r);
      col = mix(col, vec3(0.0), coreMask);
      alpha = max(alpha, coreMask * 0.995);

      // Thin bright lip at the shadow edge
      float lip = exp(-pow(abs(r - eh * 1.02) / 0.008, 2.0));
      float lipPulse = 0.65 + 0.35 * sin(u_time * 2.2);
      col += vec3(1.0, 0.94, 0.75) * lip * 0.55 * lipPulse;
      alpha = max(alpha, lip * 0.5);

      // Feed: slight horizon darken only — file shred FX is DOM, not light particles
      if (u_feed > 0.01) {
        float pullShade = u_feed * 0.22 * smoothstep(0.85, eh * 0.9, r);
        col *= 1.0 - pullShade;
        alpha = max(alpha, pullShade * 0.35);
      }

      alpha *= circleMask;
      col = max(col, vec3(0.0)) * alpha;
      // Soft filmic roll-off (keeps gold hot without clipping to white)
      col = col / (1.0 + col * 0.22);
      gl_FragColor = vec4(col, alpha);
    }
  `;

  function createShader(gl, type, source) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function createProgram(gl, vsSrc, fsSrc) {
    const vs = createShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  }

  class BlackHoleRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: true,
        preserveDrawingBuffer: false,
      });
      if (!this.gl) throw new Error('WebGL not available');

      const gl = this.gl;
      this.program = createProgram(gl, VS, FS);
      this.feed = 0;
      this.hunger = 0;
      this.intensity = 1.15;
      this.hasDesktop = 0;
      this.hasDesktopPrev = 0;
      this.hasPlate = 0;
      this.padRatio = 0.42;
      this.deskMix = 1;
      this._lastFrameTime = 0;
      this.enabled = true;
      this.lowPower = false;
      this._skipFrames = 0;
      this._start = performance.now();

      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
      );

      const makeTex = () => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
        return tex;
      };

      this.desktopTex = makeTex();
      this.desktopTexPrev = makeTex();

      this.plateTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.plateTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

      this.attribs = { pos: gl.getAttribLocation(this.program, 'a_pos') };
      this.uniforms = {
        time: gl.getUniformLocation(this.program, 'u_time'),
        res: gl.getUniformLocation(this.program, 'u_res'),
        feed: gl.getUniformLocation(this.program, 'u_feed'),
        hunger: gl.getUniformLocation(this.program, 'u_hunger'),
        intensity: gl.getUniformLocation(this.program, 'u_intensity'),
        hasDesktop: gl.getUniformLocation(this.program, 'u_hasDesktop'),
        hasDesktopPrev: gl.getUniformLocation(this.program, 'u_hasDesktopPrev'),
        hasPlate: gl.getUniformLocation(this.program, 'u_hasPlate'),
        padRatio: gl.getUniformLocation(this.program, 'u_padRatio'),
        deskMix: gl.getUniformLocation(this.program, 'u_deskMix'),
        desktop: gl.getUniformLocation(this.program, 'u_desktop'),
        desktopPrev: gl.getUniformLocation(this.program, 'u_desktopPrev'),
        plate: gl.getUniformLocation(this.program, 'u_plate'),
      };

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.resize();
      this.loadPlate('assets/blackhole.png');
      this._raf = requestAnimationFrame((t) => this.frame(t));
    }

    loadPlate(url) {
      const img = new Image();
      img.onload = () => {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.plateTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        this.hasPlate = 1;
      };
      img.onerror = () => {
        console.warn('blackhole plate missing, using procedural fallback');
        this.hasPlate = 0;
      };
      img.src = url;
    }

    setEnabled(on) {
      this.enabled = !!on;
      if (!on) {
        const gl = this.gl;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    }

    setLowPower(on) {
      this.lowPower = !!on;
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.gl.viewport(0, 0, w, h);
      }
    }

    triggerFeed(strength = 1) {
      this.feed = Math.min(1.85, this.feed + strength * 0.85);
      // Keep animation alive longer while feeding
      if (this.lowPower) this._skipFrames = 0;
    }

    setHunger(h = 0) {
      this.hunger = Math.max(0, Math.min(1, h));
    }

    async updateDesktopTexture(uint8Array, padRatio, mime = 'image/jpeg') {
      if (!uint8Array || !uint8Array.length) return;
      try {
        const blob = new Blob([uint8Array], { type: mime });
        const bitmap = await createImageBitmap(blob);
        const gl = this.gl;

        const midFade = this.hasDesktopPrev && this.deskMix < 0.92;
        if (this.hasDesktop && !midFade) {
          // Ping-pong: keep previous desktop for a short crossfade
          const tmp = this.desktopTexPrev;
          this.desktopTexPrev = this.desktopTex;
          this.desktopTex = tmp;
          this.hasDesktopPrev = 1;
          this.deskMix = 0;
        }
        // Mid-fade: only replace the fade *target* so rapid plate refreshes
        // (alt-tab / window switch) don't restart the blend and pop.

        gl.bindTexture(gl.TEXTURE_2D, this.desktopTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        bitmap.close?.();
        this.hasDesktop = 1;
        if (!this.hasDesktopPrev) this.deskMix = 1;
        if (typeof padRatio === 'number') this.padRatio = padRatio;
      } catch (err) {
        console.error('desktop texture update failed', err);
      }
    }

    frame(now) {
      this.resize();
      const gl = this.gl;
      if (!this.enabled) {
        this._raf = requestAnimationFrame((nt) => this.frame(nt));
        return;
      }

      // Low-power: skip most frames when idle (no feed pulse)
      if (this.lowPower && this.feed < 0.02 && !(this.hasDesktopPrev && this.deskMix < 1)) {
        this._skipFrames = (this._skipFrames + 1) % 4;
        if (this._skipFrames !== 0) {
          this._raf = requestAnimationFrame((nt) => this.frame(nt));
          return;
        }
      }

      const t = (now - this._start) / 1000;
      const dt = this._lastFrameTime ? Math.min(0.05, (now - this._lastFrameTime) / 1000) : 0.016;
      this._lastFrameTime = now;
      // Gentler decay so the suck pulse eases out instead of snapping off
      this.feed = Math.max(0, this.feed - (this.feed > 0.7 ? 0.008 : 0.012));

      // Ease desktop crossfade (~650ms, smoothstep) so window-switch updates don't pop
      let deskMixUniform = this.deskMix;
      if (this.hasDesktopPrev && this.deskMix < 1) {
        this.deskMix = Math.min(1, this.deskMix + dt / 0.65);
        const u = this.deskMix;
        deskMixUniform = u * u * (3 - 2 * u);
        if (this.deskMix >= 1) this.hasDesktopPrev = 0;
      }

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.enableVertexAttribArray(this.attribs.pos);
      gl.vertexAttribPointer(this.attribs.pos, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.desktopTex);
      gl.uniform1i(this.uniforms.desktop, 0);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.desktopTexPrev);
      gl.uniform1i(this.uniforms.desktopPrev, 2);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.plateTex);
      gl.uniform1i(this.uniforms.plate, 1);

      gl.uniform1f(this.uniforms.time, t);
      gl.uniform2f(this.uniforms.res, this.canvas.width, this.canvas.height);
      gl.uniform1f(this.uniforms.feed, this.feed);
      gl.uniform1f(this.uniforms.hunger, this.hunger);
      gl.uniform1f(this.uniforms.intensity, this.intensity);
      gl.uniform1f(this.uniforms.hasDesktop, this.hasDesktop);
      // Drop ping-pong blend while sucking — cheaper + snappier warp
      gl.uniform1f(
        this.uniforms.hasDesktopPrev,
        this.feed > 0.3 ? 0 : this.hasDesktopPrev
      );
      gl.uniform1f(this.uniforms.hasPlate, this.hasPlate);
      gl.uniform1f(this.uniforms.padRatio, this.padRatio);
      gl.uniform1f(this.uniforms.deskMix, deskMixUniform);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      this._raf = requestAnimationFrame((nt) => this.frame(nt));
    }

    destroy() {
      cancelAnimationFrame(this._raf);
    }
  }

  window.BlackHoleRenderer = BlackHoleRenderer;
})();
