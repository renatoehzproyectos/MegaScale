/**
 * OpenScale v1.0.1 – Dynamic Resolution pastilla (stable path)
 *
 * Zero-config: <script src="./OpenScale.js"></script>
 *
 * Uses Phase-1 stable approach:
 *  - Lowers canvas drawingBuffer (simulation size)
 *  - Keeps CSS size at full display
 *  - Browser does free bilinear upscale
 *  - Does NOT hide the game canvas (avoids dual-canvas freeze)
 *
 * Manual: FPS-first, mobile-first, no game code changes.
 */
(function (global) {
  "use strict";

  var CFG = {
    INITIAL_SCALE: 0.50,
    MIN_SCALE: 0.30,
    MAX_SCALE: 1.00,
    DYNAMIC_RESOLUTION: true,
    SHOW_OVERLAY: true,
    DEBUG: false,
    COOLDOWN_MS: 800,
    STEP: 0.05,
    HIGH_MS: 18.5,  // ~54 FPS → try higher res
    LOW_MS: 22.0,   // ~45 FPS → lower res
    STABLE_FRAMES: 10
  };

  function FrameTiming() {
    this.times = [];
    this.last = 0;
    this.size = 30;
  }
  FrameTiming.prototype.update = function (now) {
    if (!this.last) { this.last = now; return { fps: 60, avg: 16.67 }; }
    var d = now - this.last;
    this.last = now;
    if (d < 1 || d > 120) return this.stats();
    this.times.push(d);
    if (this.times.length > this.size) this.times.shift();
    return this.stats();
  };
  FrameTiming.prototype.stats = function () {
    if (!this.times.length) return { fps: 60, avg: 16.67 };
    var s = 0, i;
    for (i = 0; i < this.times.length; i++) s += this.times[i];
    var avg = s / this.times.length;
    return { fps: Math.round((1000 / avg) * 10) / 10, avg: Math.round(avg * 100) / 100 };
  };

  function Controller(cfg) {
    this.cfg = cfg;
    this.scale = cfg.INITIAL_SCALE;
    this.cdUntil = 0;
    this.stable = 0;
  }
  Controller.prototype.update = function (avg, now) {
    if (!this.cfg.DYNAMIC_RESOLUTION || now < this.cdUntil) return this.scale;
    var changed = false;
    if (avg < this.cfg.HIGH_MS) {
      this.stable++;
      if (this.stable >= this.cfg.STABLE_FRAMES) {
        var n = Math.min(this.cfg.MAX_SCALE, Math.round((this.scale + this.cfg.STEP) * 100) / 100);
        if (n > this.scale) { this.scale = n; changed = true; }
        this.stable = 0;
      }
    } else if (avg > this.cfg.LOW_MS) {
      this.stable++;
      if (this.stable >= this.cfg.STABLE_FRAMES) {
        var n2 = Math.max(this.cfg.MIN_SCALE, Math.round((this.scale - this.cfg.STEP) * 100) / 100);
        if (n2 < this.scale) { this.scale = n2; changed = true; }
        this.stable = 0;
      }
    } else this.stable = 0;
    if (changed) this.cdUntil = now + this.cfg.COOLDOWN_MS;
    return this.scale;
  };
  Controller.prototype.setScale = function (v) {
    this.scale = Math.max(this.cfg.MIN_SCALE, Math.min(this.cfg.MAX_SCALE, v));
    this.cdUntil = performance.now() + this.cfg.COOLDOWN_MS;
  };

  function findCanvas() {
    var list = document.querySelectorAll("canvas");
    var best = null, bestArea = 0, i, c, a, has;
    for (i = 0; i < list.length; i++) {
      c = list[i];
      a = (c.width || c.clientWidth) * (c.height || c.clientHeight);
      try {
        has = c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl");
      } catch (e) { has = null; }
      if (has && a >= bestArea) { best = c; bestArea = a; }
    }
    if (!best && list.length) best = list[0];
    return best;
  }

  function OpenScale(userCfg) {
    this.cfg = {};
    var k;
    for (k in CFG) this.cfg[k] = CFG[k];
    if (userCfg) for (k in userCfg) this.cfg[k] = userCfg[k];

    this.canvas = null;
    this.dpr = window.devicePixelRatio || 1;
    this.displayW = 0;
    this.displayH = 0;
    this.simW = 0;
    this.simH = 0;
    this.scale = this.cfg.INITIAL_SCALE;
    this.ft = new FrameTiming();
    this.ctrl = new Controller(this.cfg);
    this.running = false;
    this.overlay = null;
    this.raf = null;
    this._onResize = this._onResize.bind(this);
    this._loop = this._loop.bind(this);
  }

  OpenScale.prototype.start = function () {
    if (this.running) return this;
    var self = this;
    var tries = 0;
    function boot() {
      self.canvas = findCanvas();
      if (!self.canvas && tries++ < 40) {
        setTimeout(boot, 50);
        return;
      }
      if (!self.canvas) {
        if (self.cfg.DEBUG) console.warn("[OpenScale] no canvas");
        return;
      }
      self._setup();
      self.running = true;
      self.raf = requestAnimationFrame(self._loop);
    }
    boot();
    return this;
  };

  OpenScale.prototype.stop = function () {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("orientationchange", this._onResize);
    if (this.overlay && this.overlay.parentNode) this.overlay.parentNode.removeChild(this.overlay);
    this.overlay = null;
    return this;
  };

  OpenScale.prototype.setScale = function (v) {
    this.ctrl.setScale(v);
    this.scale = this.ctrl.scale;
    this._apply();
    return this;
  };

  OpenScale.prototype.getFPS = function () { return this.ft.stats().fps; };
  OpenScale.prototype.getResolution = function () {
    return {
      display: { width: this.displayW, height: this.displayH },
      simulation: { width: this.simW, height: this.simH },
      scale: this.scale
    };
  };

  OpenScale.prototype.setQualityMode = function (mode) {
    var presets = {
      QUALITY: { min: 0.67, max: 0.9, initial: 0.75 },
      BALANCED: { min: 0.5, max: 0.75, initial: 0.6 },
      PERFORMANCE: { min: 0.4, max: 0.6, initial: 0.5 },
      ULTRA_PERFORMANCE: { min: 0.3, max: 0.5, initial: 0.35 },
      AUTO: { min: 0.3, max: 1, initial: 0.5 }
    };
    var p = presets[String(mode || "AUTO").toUpperCase()] || presets.AUTO;
    this.cfg.MIN_SCALE = p.min;
    this.cfg.MAX_SCALE = p.max;
    this.ctrl.cfg.MIN_SCALE = p.min;
    this.ctrl.cfg.MAX_SCALE = p.max;
    this.setScale(p.initial);
    return this;
  };

  OpenScale.prototype._setup = function () {
    // Ensure canvas stays visible (CRITICAL – no dual-canvas hide)
    this.canvas.style.opacity = "1";
    this.canvas.style.visibility = "visible";
    if (!this.canvas.style.width) this.canvas.style.width = "100%";
    if (!this.canvas.style.height) this.canvas.style.height = "100%";

    this._updateDisplay();
    this.scale = this.cfg.INITIAL_SCALE;
    this.ctrl.setScale(this.scale);
    this._apply();

    window.addEventListener("resize", this._onResize);
    window.addEventListener("orientationchange", this._onResize);
    document.addEventListener("fullscreenchange", this._onResize);

    // Context loss
    this.canvas.addEventListener("webglcontextlost", function (e) {
      e.preventDefault();
    }, false);
    var self = this;
    this.canvas.addEventListener("webglcontextrestored", function () {
      self._apply();
    }, false);

    if (this.cfg.SHOW_OVERLAY) this._mkOverlay();
    if (this.cfg.DEBUG) console.log("[OpenScale] stable path started", this.getResolution());
  };

  OpenScale.prototype._updateDisplay = function () {
    this.dpr = window.devicePixelRatio || 1;
    var cssW = this.canvas.clientWidth || window.innerWidth;
    var cssH = this.canvas.clientHeight || window.innerHeight;
    this.displayW = Math.max(1, Math.round(cssW * this.dpr));
    this.displayH = Math.max(1, Math.round(cssH * this.dpr));
  };

  OpenScale.prototype._apply = function () {
    if (!this.canvas) return;
    this.simW = Math.max(1, Math.round(this.displayW * this.scale));
    this.simH = Math.max(1, Math.round(this.displayH * this.scale));

    // Only write when changed – assigning width resets WebGL drawing buffer
    if (this.canvas.width !== this.simW || this.canvas.height !== this.simH) {
      this.canvas.width = this.simW;
      this.canvas.height = this.simH;
    }
    // CSS stays full size → browser bilinear upscale (stable, no freeze)
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
  };

  OpenScale.prototype._onResize = function () {
    var self = this;
    clearTimeout(this._rt);
    this._rt = setTimeout(function () {
      self._updateDisplay();
      self._apply();
    }, 60);
  };

  OpenScale.prototype._loop = function (now) {
    if (!this.running) return;
    var st = this.ft.update(now);
    var ns = this.ctrl.update(st.avg, now);
    if (ns !== this.scale) {
      this.scale = ns;
      this._apply();
    }
    if (this.overlay) this._updOverlay(st);
    this.raf = requestAnimationFrame(this._loop);
  };

  OpenScale.prototype._mkOverlay = function () {
    if (this.overlay) return;
    this.overlay = document.createElement("div");
    this.overlay.id = "openscale-overlay";
    this.overlay.style.cssText =
      "position:fixed;top:8px;right:8px;z-index:99999;background:rgba(0,0,0,0.8);color:#0ff;" +
      "font:12px/1.4 monospace;padding:8px 12px;border-radius:6px;pointer-events:none;white-space:pre;min-width:180px;";
    document.body.appendChild(this.overlay);
  };

  OpenScale.prototype._updOverlay = function (st) {
    this.overlay.textContent =
      "OpenScale v1.0.1\n" +
      "FPS: " + st.fps + "\n" +
      "Frame: " + st.avg.toFixed(2) + " ms\n" +
      "Display: " + this.displayW + "×" + this.displayH + "\n" +
      "Simulation: " + this.simW + "×" + this.simH + "\n" +
      "Scale: " + Math.round(this.scale * 100) + "%\n" +
      "Upscaler: browser-bilinear\n" +
      "(stable path – no freeze)";
  };

  // Auto-start
  var instance = null;
  function autoStart() {
    if (instance) return;
    instance = new OpenScale();
    // Wait for game canvas
    setTimeout(function () { instance.start(); }, 80);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoStart);
  } else {
    autoStart();
  }

  global.OpenScale = {
    start: function () { return instance ? instance.start() : autoStart(); },
    stop: function () { return instance && instance.stop(); },
    setScale: function (v) { return instance && instance.setScale(v); },
    setQualityMode: function (m) { return instance && instance.setQualityMode(m); },
    getFPS: function () { return instance ? instance.getFPS() : 0; },
    getResolution: function () { return instance ? instance.getResolution() : null; },
    getInstance: function () { return instance; },
    version: "1.0.1-stable"
  };
})(typeof window !== "undefined" ? window : this);
