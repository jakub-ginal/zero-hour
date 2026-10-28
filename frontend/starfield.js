// Full-page starfield: three depth layers, mouse parallax, twinkle,
// and a warp streak effect that scales with scroll speed.

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function startStarfield(canvas) {
  const ctx = canvas.getContext("2d");
  let w = 0;
  let h = 0;
  let dpr = 1;
  let stars = [];
  let shooting = null;
  let lastScroll = window.scrollY;
  let velocity = 0;
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };

  const palette = ["255,255,255", "200,220,255", "255,226,196", "170,200,255"];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(Math.round((w * h) / 2600), 750);
    stars = Array.from({ length: count }, () => {
      const z = Math.random() ** 2.2 * 0.9 + 0.1;
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        z,
        r: 0.3 + z * 1.3,
        tw: Math.random() * Math.PI * 2,
        tws: 0.5 + Math.random() * 2,
        c: palette[(Math.random() * palette.length) | 0],
      };
    });
  }

  function spawnShootingStar() {
    const fromLeft = Math.random() < 0.5;
    shooting = {
      x: fromLeft ? Math.random() * w * 0.5 : w * 0.5 + Math.random() * w * 0.5,
      y: Math.random() * h * 0.4,
      vx: (fromLeft ? 1 : -1) * (9 + Math.random() * 6),
      vy: 3 + Math.random() * 3,
      life: 1,
    };
  }

  function frame(t) {
    const scroll = window.scrollY;
    const delta = scroll - lastScroll;
    lastScroll = scroll;
    velocity += (delta - velocity) * 0.18;
    const warp = Math.max(-60, Math.min(60, velocity));

    mouse.x += (mouse.tx - mouse.x) * 0.04;
    mouse.y += (mouse.ty - mouse.y) * 0.04;

    ctx.clearRect(0, 0, w, h);

    for (const s of stars) {
      s.y -= s.z * 0.06;
      let y = (s.y - scroll * s.z * 0.12) % h;
      if (y < 0) y += h;
      const x = s.x + mouse.x * s.z * 18;
      const py = y + mouse.y * s.z * 12;
      const twinkle = reduced ? 1 : 0.55 + Math.sin(t * 0.001 * s.tws + s.tw) * 0.45;
      const alpha = (0.25 + s.z * 0.75) * twinkle;

      const streak = warp * s.z * 0.9;
      if (Math.abs(streak) > 1.2) {
        ctx.strokeStyle = `rgba(${s.c},${alpha})`;
        ctx.lineWidth = s.r;
        ctx.beginPath();
        ctx.moveTo(x, py);
        ctx.lineTo(x, py + streak);
        ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(${s.c},${alpha})`;
        ctx.beginPath();
        ctx.arc(x, py, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (!reduced) {
      if (!shooting && Math.random() < 0.0025) spawnShootingStar();
      if (shooting) {
        const s = shooting;
        s.x += s.vx;
        s.y += s.vy;
        s.life -= 0.012;
        const g = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 10, s.y - s.vy * 10);
        g.addColorStop(0, `rgba(255,255,255,${s.life})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - s.vx * 10, s.y - s.vy * 10);
        ctx.stroke();
        if (s.life <= 0 || s.x < -200 || s.x > w + 200 || s.y > h) shooting = null;
      }
    }

    if (!reduced) requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  window.addEventListener(
    "pointermove",
    (e) => {
      mouse.tx = (e.clientX / w - 0.5) * 2;
      mouse.ty = (e.clientY / h - 0.5) * 2;
    },
    { passive: true },
  );
  resize();
  requestAnimationFrame(frame);
}
