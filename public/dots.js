/* ═══════════════════════════════════════════════════════════════
   SyncTune — Dot Particle Title
   Particles launch from the four corners of the viewport and
   assemble into "Listen together." above the hero. One orchestrated
   entrance, then a quiet breathing idle and a single light sweep.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const TEXT = 'Listen together.';
  const FONT_WEIGHT = '800';
  const PARTICLE_GAP = 3.2;        // sampling grid — lower = more dots
  const DOT_RADIUS = 1.35;         // base radius of each dot
  const CORNER_JITTER = 70;        // px scatter around each spawn corner
  const STAGGER_MS = 550;          // window over which particles begin
  const FLIGHT_MS = 1050;          // each particle's own travel time
  const DRIFT_AMP = 1.1;           // breathing amplitude once settled
  const DRIFT_SPEED = 0.00085;
  const SPARKLE_FRACTION = 0.11;   // share of particles that glow bright
  const SHIMMER_DURATION_MS = 1300;

  const ACCENT_DARK = { a: [124, 106, 239], b: [167, 139, 250] };  // dark theme: #7c6aef -> #a78bfa
  const ACCENT_LIGHT_THEME = { a: [91, 69, 214], b: [124, 106, 239] }; // night-light theme, deeper for contrast

  let canvas, ctx, wrap;
  let particles = [];
  let W, H, dpr;
  let localTargets = [];   // {x,y} relative to wrap's own box
  let textCenter = { x: 0, y: 0 };
  let startTime = null;
  let maxArrival = 0;
  let allSettled = false;
  let shimmerStart = null;
  let shimmerDone = false;
  let reduceMotion = false;
  let visible = true;
  let animId = null;
  let io = null;
  let started = false;

  const $ = id => document.getElementById(id);

  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOutExpo(t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }

  function mixColor(pair, t) {
    const r = Math.round(lerp(pair.a[0], pair.b[0], t));
    const g = Math.round(lerp(pair.a[1], pair.b[1], t));
    const b = Math.round(lerp(pair.a[2], pair.b[2], t));
    return [r, g, b];
  }

  function isNightTheme() {
    return document.body.classList.contains('night-light');
  }

  /* ── Sizing ───────────────────────────────────────────────── */
  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ── Sample the text into a local point cloud ────────────── */
  function sampleText() {
    const rect = wrap.getBoundingClientRect();
    const boxW = Math.max(rect.width, 1);
    const boxH = Math.max(rect.height, 1);

    let fontSize = Math.min(boxW * 0.14, 76);
    if (boxW < 420) fontSize = boxW * 0.16;

    const off = document.createElement('canvas');
    off.width = boxW;
    off.height = boxH;
    const oc = off.getContext('2d');
    oc.fillStyle = '#fff';
    oc.textAlign = 'center';
    oc.textBaseline = 'middle';
    oc.font = `${FONT_WEIGHT} ${fontSize}px Inter, -apple-system, sans-serif`;
    oc.fillText(TEXT, boxW / 2, boxH / 2);

    const img = oc.getImageData(0, 0, boxW, boxH);
    const points = [];
    let minX = boxW, maxX = 0;
    for (let y = 0; y < boxH; y += PARTICLE_GAP) {
      for (let x = 0; x < boxW; x += PARTICLE_GAP) {
        const i = (Math.floor(y) * boxW + Math.floor(x)) * 4;
        if (img.data[i + 3] > 128) {
          points.push({ x, y });
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    textCenter = { x: (minX + maxX) / 2 || boxW / 2, y: boxH / 2 };
    return points;
  }

  /* ── Particle ─────────────────────────────────────────────── */
  class Particle {
    constructor(local, order, total) {
      this.localX = local.x;
      this.localY = local.y;

      // Which viewport corner this particle flies in from — chosen by
      // quadrant, so the four corners each feed one quarter of the
      // glyph and the assembly reads as one coherent inward motion.
      const fromLeft = local.x < textCenter.x;
      const fromTop = local.y < textCenter.y;
      const cx = fromLeft ? -CORNER_JITTER : W + CORNER_JITTER;
      const cy = fromTop ? -CORNER_JITTER : H + CORNER_JITTER;
      this.spawnX = cx + (Math.random() - 0.5) * CORNER_JITTER * 1.6;
      this.spawnY = cy + (Math.random() - 0.5) * CORNER_JITTER * 1.6;

      this.delay = reduceMotion ? 0 : (order / total) * STAGGER_MS + Math.random() * 120;
      this.duration = FLIGHT_MS + Math.random() * 220;
      this.arrival = this.delay + this.duration;

      this.radius = DOT_RADIUS + Math.random() * 0.7;
      this.baseAlpha = 0.55 + Math.random() * 0.4;
      this.sparkle = Math.random() < SPARKLE_FRACTION;
      this.colorT = Math.random(); // position along the two-tone gradient

      this.driftPhase = Math.random() * Math.PI * 2;
      this.driftAmpX = (Math.random() - 0.5) * DRIFT_AMP * 2;
      this.driftAmpY = (Math.random() - 0.5) * DRIFT_AMP * 2;
      this.twinklePhase = Math.random() * Math.PI * 2;

      this.x = reduceMotion ? null : this.spawnX;
      this.y = reduceMotion ? null : this.spawnY;
      this.alpha = reduceMotion ? this.baseAlpha : 0;
    }

    update(elapsed, rect) {
      const tx = rect.left + this.localX;
      const ty = rect.top + this.localY;

      if (reduceMotion) {
        this.x = tx;
        this.y = ty;
        this.alpha = this.baseAlpha;
        return;
      }

      if (elapsed < this.delay) {
        this.x = this.spawnX;
        this.y = this.spawnY;
        this.alpha = 0;
        return;
      }

      const t = Math.min(1, (elapsed - this.delay) / this.duration);
      const eased = easeOutExpo(t);

      if (t < 1) {
        this.x = this.spawnX + (tx - this.spawnX) * eased;
        this.y = this.spawnY + (ty - this.spawnY) * eased;
        this.alpha = this.baseAlpha * Math.min(1, t * 2.2);
      } else {
        const breathe = elapsed * DRIFT_SPEED + this.driftPhase;
        this.x = tx + Math.sin(breathe) * this.driftAmpX;
        this.y = ty + Math.cos(breathe * 1.3) * this.driftAmpY;
        const twinkle = 0.9 + 0.1 * Math.sin(elapsed * 0.0016 + this.twinklePhase);
        this.alpha = this.baseAlpha * twinkle;
      }
    }

    draw(shimmerX) {
      if (this.alpha < 0.02) return;
      const pair = isNightTheme() ? ACCENT_LIGHT_THEME : ACCENT_DARK;
      let [r, g, b] = this.sparkle ? [255, 255, 255] : mixColor(pair, this.colorT);
      let alpha = this.alpha;
      let radius = this.radius;

      if (shimmerX !== null) {
        const dist = Math.abs(this.localX - shimmerX);
        const glow = Math.exp(-(dist * dist) / (2 * 46 * 46));
        alpha = Math.min(1, alpha + glow * 0.55);
        radius = radius + glow * 0.9;
        if (glow > 0.35) { r = 255; g = 255; b = 255; }
      }

      ctx.beginPath();
      if (this.sparkle) {
        ctx.shadowBlur = 7;
        ctx.shadowColor = `rgba(${r},${g},${b},0.55)`;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ── Build ────────────────────────────────────────────────── */
  function build() {
    resizeCanvas();
    localTargets = sampleText();
    particles = localTargets.map((pt, i) => new Particle(pt, i, localTargets.length));
    maxArrival = particles.reduce((m, p) => Math.max(m, p.arrival), 0);
    startTime = performance.now();
    allSettled = reduceMotion;
    shimmerStart = null;
    shimmerDone = reduceMotion;
  }

  /* ── Ambient halo behind the glyph ───────────────────────── */
  function drawHalo(rect) {
    const cx = rect.left + textCenter.x;
    const cy = rect.top + textCenter.y;
    const r = Math.max(rect.width * 0.55, 120);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const night = isNightTheme();
    grad.addColorStop(0, night ? 'rgba(124,106,239,0.10)' : 'rgba(124,106,239,0.16)');
    grad.addColorStop(1, 'rgba(124,106,239,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  /* ── Animation loop ──────────────────────────────────────── */
  function frame(now) {
    animId = requestAnimationFrame(frame);
    if (!visible || !wrap) { return; }

    const rect = wrap.getBoundingClientRect();
    ctx.clearRect(0, 0, W, H);

    if (rect.bottom < -40 || rect.top > H + 40) return; // off-screen, skip painting

    drawHalo(rect);

    const elapsed = reduceMotion ? Infinity : now - startTime;
    if (!allSettled && elapsed >= maxArrival) {
      allSettled = true;
      shimmerStart = now;
    }

    let shimmerX = null;
    if (allSettled && !shimmerDone) {
      const sp = (now - shimmerStart) / SHIMMER_DURATION_MS;
      if (sp >= 1) {
        shimmerDone = true;
      } else {
        const rectW = rect.width || 1;
        shimmerX = -0.15 * rectW + sp * 1.3 * rectW;
      }
    }

    for (let i = 0; i < particles.length; i++) {
      particles[i].update(elapsed, rect);
      particles[i].draw(shimmerX);
    }
    ctx.shadowBlur = 0;
  }

  /* ── Lifecycle ────────────────────────────────────────────── */
  function debounce(fn, ms) {
    let timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  function start() {
    wrap = $('dotCanvasWrap');
    canvas = $('dotCanvas');
    if (!wrap || !canvas) return;
    ctx = canvas.getContext('2d');
    reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    const boot = () => {
      build();
      if (!started) {
        window.addEventListener('resize', debounce(build, 250));
        if ('IntersectionObserver' in window) {
          io = new IntersectionObserver(entries => {
            entries.forEach(e => { visible = e.isIntersecting; });
          }, { threshold: 0 });
          io.observe(wrap);
        }
        if (!animId) animId = requestAnimationFrame(frame);
      }
      started = true;
    };

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(boot);
    } else {
      setTimeout(boot, 150);
    }
  }

  // Re-run the entrance (e.g. if re-invoked); safe to call repeatedly.
  function replay() {
    if (!wrap || !canvas) return;
    build();
  }

  window.SyncTuneDots = { start, replay };
})();
