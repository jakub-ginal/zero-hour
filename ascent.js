// Hero animation: a rocket climbs off the planet's horizon, pitches over in a
// gravity turn, and leaves an exhaust plume and a fading contrail behind.

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Must match .hero__planet in styles.css.
const PLANET = { width: 2400, height: 1400, bottom: -1250 };

export function startAscent(canvas, hero) {
  if (reduced) return;

  const ctx = canvas.getContext("2d");
  let w = 0;
  let h = 0;
  let dpr = 1;
  let visible = true;
  let flight = null;
  let particles = [];
  let trail = [];
  let last = performance.now();
  let nextLaunchAt = performance.now() + 1400;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = hero.getBoundingClientRect();
    w = rect.width;
    h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function horizonY(x) {
    const cx = w / 2;
    const top = h - PLANET.bottom - PLANET.height;
    const rx = PLANET.width / 2;
    const ry = PLANET.height;
    const t = Math.min(Math.abs(x - cx) / rx, 0.999);
    return top + ry * (1 - Math.sqrt(1 - t * t));
  }

  function launch() {
    const sx = w * (0.2 + Math.random() * 0.6);
    const sy = horizonY(sx);
    const dir = Math.random() < 0.5 ? 1 : -1;
    flight = {
      t0: performance.now(),
      duration: 6500 + Math.random() * 2200,
      p0: { x: sx, y: sy },
      p1: { x: sx, y: sy - h * 0.7 },
      p2: { x: sx + dir * w * 0.25, y: -80 },
      prev: { x: sx, y: sy },
    };
    particles = [];
    trail = [];
  }

  function bezier(p0, p1, p2, t) {
    const u = 1 - t;
    return {
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    };
  }

  function emit(pos, backward, t) {
    const rate = 2 + Math.round(t * 4);
    for (let i = 0; i < rate; i++) {
      const spread = (Math.random() - 0.5) * 0.9;
      const speed = 0.6 + Math.random() * 1.8;
      particles.push({
        x: pos.x + backward.x * 5,
        y: pos.y + backward.y * 5,
        vx: backward.x * speed + Math.cos(spread) * (Math.random() - 0.5) * 0.6,
        vy: backward.y * speed + (Math.random() - 0.5) * 0.6,
        life: 1,
        decay: 0.012 + Math.random() * 0.02,
        size: 1 + Math.random() * 2.6,
        hue: 18 + Math.random() * 22,
      });
    }
  }

  function drawPadFlash(pos, now) {
    if (!flight) return;
    const since = (now - flight.t0) / 1000;
    const flash = Math.min(1, Math.max(0, 1 - since / 0.9));
    if (flash <= 0) return;
    const radius = 40 + (1 - flash) * 130;
    const g = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, radius);
    g.addColorStop(0, `rgba(255,180,120,${flash * 0.5})`);
    g.addColorStop(0.5, `rgba(255,120,60,${flash * 0.18})`);
    g.addColorStop(1, "rgba(255,120,60,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function frame(now) {
    const dt = Math.min(48, now - last) / 16.67;
    last = now;

    if (visible) {
      ctx.clearRect(0, 0, w, h);

      if (!flight && now >= nextLaunchAt) launch();

      if (flight) {
        const t = Math.min((now - flight.t0) / flight.duration, 1);
        const eased = t * t * (3 - 2 * t);
        const pos = bezier(flight.p0, flight.p1, flight.p2, eased);
        const next = bezier(flight.p0, flight.p1, flight.p2, Math.min(eased + 0.004, 1));
        const angle = Math.atan2(next.y - pos.y, next.x - pos.x);
        const backward = { x: -Math.cos(angle), y: -Math.sin(angle) };

        emit(pos, backward, t);

        trail.push({ x: pos.x, y: pos.y, life: 1 });
        for (const point of trail) point.life -= 0.008 * dt;
        trail = trail.filter((point) => point.life > 0);

        for (let i = 0; i < trail.length - 1; i++) {
          const a = trail[i];
          const b = trail[i + 1];
          ctx.strokeStyle = `rgba(120,180,255,${a.life * 0.28})`;
          ctx.lineWidth = 1.2 + a.life * 1.6;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }

        for (const p of particles) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += 0.012 * dt;
          p.life -= p.decay * dt;
          if (p.life <= 0) continue;
          const alpha = Math.max(p.life, 0) * 0.8;
          ctx.fillStyle = `hsla(${p.hue}, 100%, ${55 + p.life * 20}%, ${alpha})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
          ctx.fill();
        }
        particles = particles.filter((p) => p.life > 0);

        drawPadFlash(flight.p0, now);

        const plume = ctx.createRadialGradient(
          pos.x - Math.cos(angle) * 6,
          pos.y - Math.sin(angle) * 6,
          0,
          pos.x - Math.cos(angle) * 6,
          pos.y - Math.sin(angle) * 6,
          14,
        );
        plume.addColorStop(0, "rgba(255,240,210,0.95)");
        plume.addColorStop(0.4, "rgba(255,150,70,0.7)");
        plume.addColorStop(1, "rgba(255,90,40,0)");
        ctx.fillStyle = plume;
        ctx.beginPath();
        ctx.arc(pos.x - Math.cos(angle) * 6, pos.y - Math.sin(angle) * 6, 14, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(angle + Math.PI / 2);
        ctx.fillStyle = "rgba(235,245,255,0.95)";
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(3.2, 2);
        ctx.lineTo(0, 1);
        ctx.lineTo(-3.2, 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        if (t >= 1) {
          flight = null;
          trail = [];
          nextLaunchAt = now + 3800 + Math.random() * 3200;
        }
      }
    }

    requestAnimationFrame(frame);
  }

  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
  }).observe(hero);

  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(frame);
}
