/**
 * Heavy interactive WebGL simulation.
 * - Touch / mouse drag to move the attractor
 * - Many particles + expensive background
 * - No knowledge of OpenScale
 */
(function () {
  "use strict";

  const canvas = document.getElementById("game");
  if (!canvas) return;

  // --- Input state (CSS pixel space 0..1) ---
  const input = {
    x: 0.5,
    y: 0.5,
    down: false,
    px: 0.5,
    py: 0.5
  };

  function eventToUV(e) {
    const r = canvas.getBoundingClientRect();
    const src = e.touches && e.touches[0] ? e.touches[0] : e;
    return {
      x: (src.clientX - r.left) / Math.max(1, r.width),
      y: (src.clientY - r.top) / Math.max(1, r.height)
    };
  }

  function onDown(e) {
    e.preventDefault();
    input.down = true;
    const p = eventToUV(e);
    input.x = input.px = p.x;
    input.y = input.py = p.y;
  }
  function onMove(e) {
    e.preventDefault();
    const p = eventToUV(e);
    if (input.down) {
      input.x = p.x;
      input.y = p.y;
    }
    input.px = p.x;
    input.py = p.y;
  }
  function onUp(e) {
    e.preventDefault();
    input.down = false;
  }

  canvas.addEventListener("mousedown", onDown, { passive: false });
  canvas.addEventListener("mousemove", onMove, { passive: false });
  window.addEventListener("mouseup", onUp, { passive: false });
  canvas.addEventListener("touchstart", onDown, { passive: false });
  canvas.addEventListener("touchmove", onMove, { passive: false });
  canvas.addEventListener("touchend", onUp, { passive: false });
  canvas.addEventListener("touchcancel", onUp, { passive: false });

  // --- Canvas size ---
  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Only set if OpenScale hasn't taken control of buffer size yet;
    // still safe: OpenScale will overwrite width/height each frame if active.
    if (!window.OpenScale || !window.OpenScale.getInstance || !window.OpenScale.getInstance()) {
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
    }
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
  }
  fit();
  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", fit);

  const gl =
    canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false
    }) ||
    canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      powerPreference: "high-performance"
    });

  if (!gl) {
    document.body.innerHTML = "<p style='color:#f66;padding:20px'>WebGL no disponible</p>";
    return;
  }

  // --- CPU particle simulation (interactive) ---
  const COUNT = 48;
  const particles = [];
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2;
    particles.push({
      x: 0.5 + Math.cos(a) * 0.25,
      y: 0.5 + Math.sin(a) * 0.2,
      vx: (Math.random() - 0.5) * 0.02,
      vy: (Math.random() - 0.5) * 0.02,
      r: 0.03 + Math.random() * 0.04,
      hue: i / COUNT
    });
  }

  // Pack as flat array for uniform (max ~16 orbs in shader for compatibility)
  const MAX_ORBS = 16;
  const orbData = new Float32Array(MAX_ORBS * 4); // x, y, radius, hue

  function simulate(dt) {
    const atrX = input.x;
    const atrY = input.y;
    const strength = input.down ? 1.8 : 0.55;
    const damp = 0.985;

    for (let i = 0; i < COUNT; i++) {
      const p = particles[i];
      const dx = atrX - p.x;
      const dy = atrY - p.y;
      const d2 = dx * dx + dy * dy + 0.0008;
      const inv = strength / d2;
      // attract toward pointer
      p.vx += dx * inv * dt * 0.15;
      p.vy += dy * inv * dt * 0.15;
      // mild swirl
      p.vx += -dy * 0.08 * dt;
      p.vy += dx * 0.08 * dt;
      p.vx *= damp;
      p.vy *= damp;
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      // soft bounds
      if (p.x < 0.02) { p.x = 0.02; p.vx *= -0.5; }
      if (p.x > 0.98) { p.x = 0.98; p.vx *= -0.5; }
      if (p.y < 0.02) { p.y = 0.02; p.vy *= -0.5; }
      if (p.y > 0.98) { p.y = 0.98; p.vy *= -0.5; }
    }

    // write first MAX_ORBS to uniform buffer layout
    for (let i = 0; i < MAX_ORBS; i++) {
      const p = particles[i];
      orbData[i * 4] = p.x;
      orbData[i * 4 + 1] = p.y;
      orbData[i * 4 + 2] = p.r;
      orbData[i * 4 + 3] = p.hue;
    }
  }

  // --- Shaders ---
  const vsSrc = `
    attribute vec2 a_pos;
    void main() {
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  const fsSrc = `
    precision highp float;
    uniform float u_time;
    uniform vec2  u_res;
    uniform vec2  u_attractor;
    uniform float u_down;
    // 16 orbs: xy = pos, z = radius, w = hue
    uniform vec4  u_orbs[16];

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
    }
    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
      for (int i = 0; i < 7; i++) {
        v += a * noise(p);
        p = m * p;
        a *= 0.5;
      }
      return v;
    }
    float warp(vec2 p, float t) {
      vec2 q = vec2(fbm(p + t * 0.05), fbm(p + vec2(5.2, 1.3) + t * 0.04));
      vec2 r = vec2(
        fbm(p + 3.5 * q + vec2(1.7, 9.2) + t * 0.03),
        fbm(p + 3.5 * q + vec2(8.3, 2.8) + t * 0.02)
      );
      return fbm(p + 3.5 * r);
    }
    vec3 hueColor(float h) {
      return 0.5 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67)));
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_res;
      // aspect-correct centered coords for background
      vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
      float t = u_time;

      // Heavy animated background
      float n = warp(p * 2.0 + vec2(t * 0.07, 0.0), t);
      vec3 col = mix(vec3(0.015, 0.03, 0.09), vec3(0.06, 0.2, 0.48), n);
      col += vec3(0.12, 0.04, 0.2) * fbm(p * 4.5 - t * 0.08);

      // Interactive attractor glow
      vec2 auv = u_attractor;
      float ad = length(uv - auv);
      float ar = mix(0.06, 0.11, u_down);
      col += vec3(0.3, 0.7, 1.0) * smoothstep(ar * 2.8, 0.0, ad) * (0.45 + 0.55 * u_down);
      col += vec3(1.0, 0.9, 0.5) * smoothstep(0.03, 0.0, ad) * 0.8;

      // Particles / orbs driven by CPU sim
      for (int i = 0; i < 16; i++) {
        vec4 o = u_orbs[i];
        float d = length(uv - o.xy);
        float glow = smoothstep(o.z * 3.2, o.z * 0.25, d);
        vec3 oc = hueColor(o.w + t * 0.02);
        col += oc * glow * 0.75;
        // core
        col += oc * smoothstep(o.z * 0.55, 0.0, d) * 0.5;
      }

      // Extra volumetric sheets (cost)
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float layer = fbm(p * (2.5 + fk) + vec2(t * (0.04 + fk * 0.015), fk));
        col += vec3(0.025, 0.04, 0.07) * layer * (1.0 - uv.y);
      }

      float vig = smoothstep(1.15, 0.35, length(uv - 0.5));
      col *= vig;
      col += (hash(gl_FragCoord.xy + t) - 0.5) * 0.035;

      gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(0.95)), 1.0);
    }
  `;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
    return;
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );
  const aPos = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uTime = gl.getUniformLocation(prog, "u_time");
  const uRes = gl.getUniformLocation(prog, "u_res");
  const uAttr = gl.getUniformLocation(prog, "u_attractor");
  const uDown = gl.getUniformLocation(prog, "u_down");
  const uOrbs = [];
  for (let i = 0; i < MAX_ORBS; i++) {
    uOrbs.push(gl.getUniformLocation(prog, "u_orbs[" + i + "]"));
  }

  // HUD
  const hud = document.createElement("div");
  hud.style.cssText =
    "position:fixed;top:8px;left:8px;z-index:20;background:rgba(0,30,0,0.82);color:#0f0;" +
    "font:12px/1.45 monospace;padding:8px 12px;border-radius:6px;pointer-events:none;white-space:pre;";
  document.body.appendChild(hud);

  const hint = document.getElementById("hint");
  if (hint) {
    hint.textContent =
      "Arrastra con el dedo o el ratón · las partículas siguen el atractor · escena cara a propósito";
  }

  let last = performance.now();
  let frames = 0;
  let fps = 0;
  let frameTime = 16.7;
  let prevSim = performance.now();

  function render(now) {
    const dt = Math.min(0.05, (now - prevSim) / 1000);
    prevSim = now;
    simulate(dt);

    frames++;
    const elapsed = now - last;
    if (elapsed >= 500) {
      fps = Math.round((frames * 1000) / elapsed);
      frameTime = elapsed / frames;
      frames = 0;
      last = now;
    }

    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;

    gl.viewport(0, 0, w, h);
    gl.uniform1f(uTime, now * 0.001);
    gl.uniform2f(uRes, w, h);
    gl.uniform2f(uAttr, input.x, input.y);
    gl.uniform1f(uDown, input.down ? 1.0 : 0.0);
    for (let i = 0; i < MAX_ORBS; i++) {
      gl.uniform4f(
        uOrbs[i],
        orbData[i * 4],
        orbData[i * 4 + 1],
        orbData[i * 4 + 2],
        orbData[i * 4 + 3]
      );
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    hud.textContent =
      "HeavyDemo interactivo\n" +
      "FPS: " + fps + "\n" +
      "Frame: " + frameTime.toFixed(2) + " ms\n" +
      "Render buffer: " + w + "×" + h + "\n" +
      "Pointer: " + input.x.toFixed(2) + ", " + input.y.toFixed(2) +
      (input.down ? "  [HOLD]" : "");

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
})();
