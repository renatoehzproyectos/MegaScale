/**
 * Heavy WebGL demo – intentionally expensive per pixel.
 * No knowledge of OpenScale. Drop OpenScale.js next to index.html to speed it up.
 */
(function () {
  "use strict";

  const canvas = document.getElementById("game");
  if (!canvas) return;

  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
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

  const vsSrc = `
    attribute vec2 a_pos;
    void main() {
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  // Intentionally heavy fragment shader: layered fbm, many lights, soft particles
  const fsSrc = `
    precision highp float;
    uniform float u_time;
    uniform vec2  u_res;
    uniform float u_quality; // 1.0 = full cost

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

    // Expensive fbm – 8 octaves
    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
      for (int i = 0; i < 8; i++) {
        v += a * noise(p);
        p = m * p;
        a *= 0.5;
      }
      return v;
    }

    // Domain-warped fbm (very fill-rate heavy)
    float warp(vec2 p, float t) {
      vec2 q = vec2(fbm(p + t * 0.05), fbm(p + vec2(5.2, 1.3) + t * 0.04));
      vec2 r = vec2(
        fbm(p + 4.0 * q + vec2(1.7, 9.2) + t * 0.03),
        fbm(p + 4.0 * q + vec2(8.3, 2.8) + t * 0.02)
      );
      return fbm(p + 4.0 * r);
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_res;
      vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;

      float t = u_time;

      // Heavy background
      float n = warp(p * 2.2 + vec2(t * 0.08, 0.0), t);
      vec3 col = mix(vec3(0.02, 0.04, 0.12), vec3(0.08, 0.25, 0.55), n);
      col += vec3(0.15, 0.05, 0.25) * fbm(p * 5.0 - t * 0.1);

      // Many soft "particles" / orbs – each adds samples
      const int ORBS = 18;
      for (int i = 0; i < ORBS; i++) {
        float fi = float(i);
        float speed = 0.25 + fract(fi * 0.17) * 0.55;
        float phase = fi * 1.7;
        vec2 c = vec2(
          0.55 * sin(t * speed + phase),
          0.40 * cos(t * speed * 0.85 + phase * 1.3)
        );
        // slight noise offset so they are not perfect circles
        c += 0.08 * vec2(noise(c * 3.0 + t), noise(c * 3.0 - t));
        float d = length(p - c);
        float r = 0.04 + 0.03 * sin(t * 1.5 + fi);
        float glow = smoothstep(r * 3.5, r * 0.2, d);
        vec3 orbCol = 0.5 + 0.5 * cos(vec3(0.0, 2.0, 4.0) + fi * 0.5 + t * 0.3);
        col += orbCol * glow * (0.55 + 0.45 * n);
      }

      // Extra volumetric-ish layers
      for (int k = 0; k < 4; k++) {
        float fk = float(k);
        float layer = fbm(p * (3.0 + fk) + vec2(t * (0.05 + fk * 0.02), fk));
        col += vec3(0.03, 0.05, 0.09) * layer * (1.0 - uv.y);
      }

      // Vignette
      float vig = smoothstep(1.2, 0.3, length(uv - 0.5));
      col *= vig;

      // Cheap film grain (still costs)
      col += (hash(gl_FragCoord.xy + t) - 0.5) * 0.04;

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
  const uQuality = gl.getUniformLocation(prog, "u_quality");

  // Left HUD – game side only
  const hud = document.createElement("div");
  hud.style.cssText =
    "position:fixed;top:8px;left:8px;z-index:20;background:rgba(0,30,0,0.8);color:#0f0;" +
    "font:12px/1.45 monospace;padding:8px 12px;border-radius:6px;pointer-events:none;white-space:pre;";
  document.body.appendChild(hud);

  let last = performance.now();
  let frames = 0;
  let fps = 0;
  let frameTime = 16.7;

  function render(now) {
    frames++;
    const elapsed = now - last;
    if (elapsed >= 500) {
      fps = Math.round((frames * 1000) / elapsed);
      frameTime = elapsed / frames;
      frames = 0;
      last = now;
    }

    // If OpenScale resized the drawing buffer, we just follow it
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;

    gl.viewport(0, 0, w, h);
    gl.uniform1f(uTime, now * 0.001);
    gl.uniform2f(uRes, w, h);
    gl.uniform1f(uQuality, 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    hud.textContent =
      "HeavyDemo (sin OpenScale / o con pastilla)\n" +
      "FPS: " + fps + "\n" +
      "Frame: " + frameTime.toFixed(2) + " ms\n" +
      "Render buffer: " + w + "×" + h + "\n" +
      "CSS: " + canvas.clientWidth + "×" + canvas.clientHeight;

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
})();
