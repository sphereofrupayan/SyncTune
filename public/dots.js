/* ═══════════════════════════════════════════════════════════════
   SyncTune — Dot Particle Text Animation
   Particles fly in from screen edges and assemble into text.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const TEXT = 'Listen together.';
  const FONT_WEIGHT = '800';
  const PARTICLE_GAP = 4;          // sampling grid — lower = more dots
  const DOT_RADIUS = 1.6;          // base radius of each dot
  const EASE_SPEED = 0.035;        // how fast particles converge (0‑1)
  const DRIFT_AMP = 1.2;           // gentle breathing amplitude after settling
  const DRIFT_SPEED = 0.0008;      // breathing cycle speed
  const SCATTER_MARGIN = 120;      // extra px outside viewport for spawn
  const STAGGER_FRAMES = 90;       // frames over which particles start moving

  let canvas, ctx, particles = [], W, H, dpr, fontSize, animId;
  let settled = false;
  let frameCount = 0;

  /* ── Helpers ──────────────────────────────────────────────── */
  function randomEdgePoint() {
    const side = Math.random() * 4 | 0;
    switch (side) {
      case 0: return { x: Math.random() * W, y: -SCATTER_MARGIN };                     // top
      case 1: return { x: Math.random() * W, y: H + SCATTER_MARGIN };                  // bottom
      case 2: return { x: -SCATTER_MARGIN, y: Math.random() * H };                     // left
      default: return { x: W + SCATTER_MARGIN, y: Math.random() * H };                 // right
    }
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  /* ── Sample text to pixel positions ──────────────────────── */
  function sampleText() {
    // Determine responsive font size
    fontSize = Math.min(W * 0.09, 76);
    if (W < 500) fontSize = W * 0.11;

    const offscreen = document.createElement('canvas');
    offscreen.width = W;
    offscreen.height = H;
    const oc = offscreen.getContext('2d');

    oc.fillStyle = '#fff';
    oc.textAlign = 'center';
    oc.textBaseline = 'middle';
    oc.font = `${FONT_WEIGHT} ${fontSize}px Inter, -apple-system, sans-serif`;
    oc.fillText(TEXT, W / 2, H / 2);

    const imageData = oc.getImageData(0, 0, W, H);
    const points = [];
    const gap = PARTICLE_GAP;

    for (let y = 0; y < H; y += gap) {
      for (let x = 0; x < W; x += gap) {
        const i = (y * W + x) * 4;
        if (imageData.data[i + 3] > 128) {
          points.push({ x, y });
        }
      }
    }
    return points;
  }

  /* ── Particle class ──────────────────────────────────────── */
  class Particle {
    constructor(tx, ty, delay) {
      const spawn = randomEdgePoint();
      this.x = spawn.x;
      this.y = spawn.y;
      this.tx = tx;
      this.ty = ty;
      this.delay = delay;
      this.progress = 0;
      this.startX = spawn.x;
      this.startY = spawn.y;

      // Visual variation
      this.radius = DOT_RADIUS + Math.random() * 0.8;
      this.alpha = 0;
      this.targetAlpha = 0.6 + Math.random() * 0.4;

      // Drift offset (post-settle breathing)
      this.driftPhase = Math.random() * Math.PI * 2;
      this.driftAmpX = (Math.random() - 0.5) * DRIFT_AMP * 2;
      this.driftAmpY = (Math.random() - 0.5) * DRIFT_AMP * 2;
    }

    update(frame) {
      if (frame < this.delay) return;

      // Converge toward target
      if (this.progress < 1) {
        this.progress = Math.min(1, this.progress + EASE_SPEED);
        const ease = easeOutCubic(this.progress);
        this.x = this.startX + (this.tx - this.startX) * ease;
        this.y = this.startY + (this.ty - this.startY) * ease;
        this.alpha = this.targetAlpha * ease;
      } else {
        // Gentle breathing drift
        const t = frame * DRIFT_SPEED + this.driftPhase;
        this.x = this.tx + Math.sin(t) * this.driftAmpX;
        this.y = this.ty + Math.cos(t * 1.3) * this.driftAmpY;
        this.alpha = this.targetAlpha;
      }
    }

    draw(ctx) {
      if (this.alpha < 0.01) return;
      ctx.globalAlpha = this.alpha;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ── Init / Rebuild ──────────────────────────────────────── */
  function init() {
    canvas = document.getElementById('dotCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    resize();
    window.addEventListener('resize', debounce(rebuild, 300));
  }

  function resize() {
    const container = canvas.parentElement;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = container.offsetWidth;
    H = container.offsetHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rebuild() {
    if (animId) cancelAnimationFrame(animId);
    resize();
    createParticles();
    frameCount = 0;
    settled = false;
    animate();
  }

  function createParticles() {
    const targets = sampleText();
    particles = [];

    // Shuffle targets for random stagger
    for (let i = targets.length - 1; i > 0; i--) {
      const j = Math.random() * (i + 1) | 0;
      [targets[i], targets[j]] = [targets[j], targets[i]];
    }

    for (let i = 0; i < targets.length; i++) {
      const delay = (i / targets.length) * STAGGER_FRAMES;
      particles.push(new Particle(targets[i].x, targets[i].y, delay));
    }
  }

  /* ── Animation Loop ──────────────────────────────────────── */
  function animate() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';

    for (let i = 0; i < particles.length; i++) {
      particles[i].update(frameCount);
      particles[i].draw(ctx);
    }

    ctx.globalAlpha = 1;
    frameCount++;
    animId = requestAnimationFrame(animate);
  }

  /* ── Debounce utility ────────────────────────────────────── */
  function debounce(fn, ms) {
    let timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  /* ── Start when DOM + fonts ready ────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  function start() {
    // Wait for Inter font to load so text sampling is accurate
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        init();
        createParticles();
        animate();
      });
    } else {
      // Fallback
      setTimeout(() => {
        init();
        createParticles();
        animate();
      }, 200);
    }
  }
})();
