const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const LAT_COUNT = 69;
const LON_COUNT = 144;
const LAT_MIN = -85;
const LON_MIN = -180;
const STEP = 2.5;
const LAND_MASK =
  "/gH/////////////////////AB//////n//////////////AAAP////Ajgf///////////+AAH/////gAA/////////////AAAB/+v/+AAA////////////gAAAAAAADAAAf///////////4AAAAAAAOAAAAAY//8/////8AAAAAAAAEAAAAAAAPgH///+AAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAAAAYAAAAAAAAAAAAAAAAAAAAAAA4AAAAAAAAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAAAAAAAAAcAAAAAAAAAAAAAAAYAAAAAAAeAAAAAAAAAAAAABAEAAAAAAAfAAAAAAAAAAAAAAACAAAAAAAfwAAAAAAAAAAAAHACAAAAAAAPgAAAAAAAAAABAfgAAAAAAAAP8AAAAPAAAAAB4/gAAAAAAAAP8AAAAfgAAAAD//wAAAAAAAAP+AAAAfwAAAAD//wAAAAAAAAP+AAAA/wgAAAD//wAAAAAAAAP/wAAA/4wAAAD//gAAAAAAAAP/wAAA/wwAAAA//AAAAAAAAAP/4AAB/8wAAAAf2AAAAAAAAA//4AAB/+YAAAAPmAAAAAAAAA//4AAA/+AAAAABkAAAAAAAAB//8AAA/8AAAAAgAgAAAAAAAB//+AAA/8AAAAcAOAAAAAAAAD//8AAB/8AAAAgweAAAAAAAAB//gAAD/+AAABmgYAAAAAAAAD/8AAAD//AAADOgAAAAAAAAAB/8AAAD//gAADHAAAAAAAAAAA/8AAFH//wAAFDAAAAAAAAAAB/gAAf///wAICAYAAAAAAAAAI/AAAf///4AQAgAAAAAAAAAAIAAAA////AA4DwIAAAAAAAAB4AAAA///+4A4DwAAAAAAAAAPgAAAA///9+A8PgAAAAAAAAA8xgAAA///5/A+PoAAAAAAAAA4CAAAA///7/D//8AAAAAAAAB4AAAAAf//36H///AAAAAAAAH8EAAAAf//3z////gAAAAAAAP/sAAAAH///3////gAAAAAAAP/8AAAAH/EP/////gAAAAAAA///AAAAD+CX/////FwAAAAAB///AAAAHAl//////EIAAAAAB///gAAAHgN//////cIAAAAAB///wAAAHxPB/////+MAAAAAB////AAAA+/P//////kAAAAAA///2IAAB/////////0AAAAAF///8QAAAf////////8AAAAAH//9/wAAFv////////8EAAQAP//9/gAAHAH///////gGAAFAf/+A/AAADDn///////wHAAej//+A6AAAAHw////////xgA/////FEDgAAH3/////////+o/////58DwHgB51/////////wf////seH+AAA/+v////////Af4MPzP4H/4AAHgAH/////8AAAAD/OdAH/8AAAAGDn//8OAAAAAAHL+Af/8AAAABgB/8ANgAAAAAQAeH//+AA0AAAAAgAAAAAAAAAD/z//+AAOAAAAMAAAAAAAAAAAP/A/8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const LAND = decodeLand();
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function decodeLand() {
  const binary = atob(LAND_MASK);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const vectors = new Float32Array(LAT_COUNT * LON_COUNT * 3);
  let count = 0;
  let bit = 0;
  for (let row = 0; row < LAT_COUNT; row += 1) {
    const lat = LAT_MIN + row * STEP;
    for (let col = 0; col < LON_COUNT; col += 1) {
      const set = bytes[bit >> 3] & (1 << (7 - (bit & 7)));
      bit += 1;
      if (!set) continue;
      const lon = LON_MIN + col * STEP;
      const vector = unitVector(lat, lon);
      vectors[count * 3] = vector[0];
      vectors[count * 3 + 1] = vector[1];
      vectors[count * 3 + 2] = vector[2];
      count += 1;
    }
  }
  return vectors.subarray(0, count * 3);
}

function unitVector(lat, lon) {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.sin(lambda), Math.sin(phi), cosPhi * Math.cos(lambda)];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rgba(color, alpha) {
  const value = String(color || "").trim();
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    const full = hex.length === 3 ? hex.replace(/./g, (char) => char + char) : hex;
    const number = Number.parseInt(full, 16);
    if (Number.isFinite(number)) {
      return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
    }
  }
  return `rgba(${value || "142, 205, 245"}, ${alpha})`;
}

function readTheme() {
  const style = getComputedStyle(document.documentElement);
  return {
    accent: style.getPropertyValue("--accent-rgb").trim() || "142, 205, 245",
    accent2: style.getPropertyValue("--accent-2-rgb").trim() || "217, 236, 251",
    deep: style.getPropertyValue("--panel-deep-rgb").trim() || "10, 13, 23",
    raised: style.getPropertyValue("--panel-raised-rgb").trim() || "34, 42, 68",
    go: style.getPropertyValue("--go").trim() || "#56e0a5",
    hold: style.getPropertyValue("--hold").trim() || "#ff6b6b",
  };
}

function slerp(a, b, t) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  dot = clamp(dot, -1, 1);
  const omega = Math.acos(dot);
  if (omega < 0.0001) return [a[0], a[1], a[2]];
  const sin = Math.sin(omega);
  const ca = Math.sin((1 - t) * omega) / sin;
  const cb = Math.sin(t * omega) / sin;
  return [a[0] * ca + b[0] * cb, a[1] * ca + b[1] * cb, a[2] * ca + b[2] * cb];
}

function orbitTarget(launch) {
  const pad = launch.pad || {};
  const orbit = String((launch.mission && launch.mission.orbit_abbrev) || "").toUpperCase();
  let lat = Number(pad.latitude);
  let lon = Number(pad.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (/GEO|GTO|GSO|SYN/.test(orbit)) {
    lat = 0;
    lon += 78;
  } else if (/SSO|POLAR|SUN/.test(orbit)) {
    lat = 82;
    lon += 34;
  } else if (/TLI|LUNAR|NRHO|HEO/.test(orbit)) {
    lat = 12;
    lon += 128;
  } else if (/MEO|GPS|NAV/.test(orbit)) {
    lat = clamp(lat + 28, -55, 55);
    lon += 70;
  } else {
    lat = clamp(lat + 17, -58, 58);
    lon += 54;
  }
  return unitVector(lat, lon);
}

function arcPoints(launch) {
  const pad = launch.pad || {};
  const start = unitVector(Number(pad.latitude), Number(pad.longitude));
  const target = orbitTarget(launch);
  if (!target) return [];
  const points = [];
  const count = 64;
  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    const point = slerp(start, target, t);
    const lift = 1 + Math.sin(Math.PI * t) * 0.28;
    points.push([point[0] * lift, point[1] * lift, point[2] * lift]);
  }
  return points;
}

export function startGlobe(canvas, options = {}) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { setLaunches() {}, destroy() {} };

  let theme = readTheme();
  let width = 0;
  let height = 0;
  let radius = 0;
  let centerX = 0;
  let centerY = 0;
  let yaw = 0;
  let tilt = 0.22;
  let targetYaw = null;
  let targetTilt = null;
  let resumeAt = 0;
  let dragging = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  let hoverId = null;
  let nextId = null;
  let pins = [];
  let arcs = [];
  let focusedNext = null;
  let visible = true;
  let dirty = true;
  let frameId = 0;
  let lastFrame = performance.now();
  const observer = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
      })
    : null;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    centerX = width / 2;
    centerY = height / 2;
    radius = Math.min(width, height) * 0.42;
    dirty = true;
  }

  function project(vector, yawValue, tiltValue) {
    const cosYaw = Math.cos(yawValue);
    const sinYaw = Math.sin(yawValue);
    const x1 = vector[0] * cosYaw + vector[2] * sinYaw;
    const z1 = -vector[0] * sinYaw + vector[2] * cosYaw;
    const cosTilt = Math.cos(tiltValue);
    const sinTilt = Math.sin(tiltValue);
    const y2 = vector[1] * cosTilt - z1 * sinTilt;
    const z2 = vector[1] * sinTilt + z1 * cosTilt;
    return {
      x: centerX + x1 * radius,
      y: centerY - y2 * radius,
      z: z2,
    };
  }

  function setLaunches(launches, nextLaunch) {
    const ordered = [];
    if (nextLaunch) ordered.push(nextLaunch);
    for (const launch of launches) {
      if (!nextLaunch || launch.id !== nextLaunch.id) ordered.push(launch);
    }

    const seen = new Set();
    pins = [];
    for (const launch of ordered) {
      const pad = launch.pad || {};
      const lat = Number(pad.latitude);
      const lon = Number(pad.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pins.push({
        id: launch.id,
        lat,
        lon,
        name: (launch.mission && launch.mission.name) || launch.name || "Launch",
        provider: (launch.provider && launch.provider.abbrev) || "",
        live: Boolean(launch.webcast_live),
        next: Boolean(nextLaunch && launch.id === nextLaunch.id),
        vector: unitVector(lat, lon),
        screen: null,
      });
      if (pins.length >= 22) break;
    }

    nextId = nextLaunch ? nextLaunch.id : null;
    const arcLaunches = ordered
      .filter((launch) => launch.pad && Number.isFinite(Number(launch.pad.latitude)))
      .slice(0, 4);
    arcs = arcLaunches.map((launch, index) => ({
      id: launch.id,
      next: Boolean(nextLaunch && launch.id === nextLaunch.id),
      live: Boolean(launch.webcast_live),
      index,
      points: arcPoints(launch),
    }));

    if (nextLaunch && nextLaunch.pad && nextLaunch.id !== focusedNext) {
      const lat = Number(nextLaunch.pad.latitude);
      const lon = Number(nextLaunch.pad.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const firstFocus = focusedNext == null;
        focusedNext = nextLaunch.id;
        targetYaw = -lon * DEG;
        targetTilt = clamp(lat * DEG * 0.42, -0.42, 0.42);
        if (firstFocus) {
          yaw = targetYaw;
          tilt = targetTilt;
          targetYaw = null;
          targetTilt = null;
        }
        resumeAt = performance.now() + 4200;
      }
    }
    dirty = true;
  }

  function drawGraticule() {
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = rgba(theme.accent2, 0.12);
    for (let lat = -60; lat <= 60; lat += 30) {
      let started = false;
      ctx.beginPath();
      for (let lon = -180; lon <= 180; lon += 5) {
        const point = project(unitVector(lat, lon), yaw, tilt);
        if (point.z <= 0.015) {
          started = false;
          continue;
        }
        if (!started) {
          ctx.moveTo(point.x, point.y);
          started = true;
        } else {
          ctx.lineTo(point.x, point.y);
        }
      }
      ctx.stroke();
    }
    for (let lon = -180; lon < 180; lon += 30) {
      let started = false;
      ctx.beginPath();
      for (let lat = -90; lat <= 90; lat += 5) {
        const point = project(unitVector(lat, lon), yaw, tilt);
        if (point.z <= 0.015) {
          started = false;
          continue;
        }
        if (!started) {
          ctx.moveTo(point.x, point.y);
          started = true;
        } else {
          ctx.lineTo(point.x, point.y);
        }
      }
      ctx.stroke();
    }
  }

  function drawLand() {
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const cosTilt = Math.cos(tilt);
    const sinTilt = Math.sin(tilt);
    const base = Math.max(0.75, radius * 0.0085);
    const buckets = [[], [], []];
    for (let index = 0; index < LAND.length; index += 3) {
      const x = LAND[index];
      const y = LAND[index + 1];
      const z = LAND[index + 2];
      const x1 = x * cosYaw + z * sinYaw;
      const z1 = -x * sinYaw + z * cosYaw;
      const y2 = y * cosTilt - z1 * sinTilt;
      const z2 = y * sinTilt + z1 * cosTilt;
      if (z2 <= 0.015) continue;
      const bucket = z2 > 0.72 ? 2 : z2 > 0.34 ? 1 : 0;
      buckets[bucket].push(centerX + x1 * radius, centerY - y2 * radius, base * (0.72 + z2 * 0.58));
    }
    const alphas = [0.3, 0.55, 0.9];
    for (let bucket = 0; bucket < 3; bucket += 1) {
      const points = buckets[bucket];
      if (!points.length) continue;
      ctx.fillStyle = rgba(theme.accent2, alphas[bucket]);
      ctx.beginPath();
      for (let index = 0; index < points.length; index += 3) {
        ctx.moveTo(points[index] + points[index + 2], points[index + 1]);
        ctx.arc(points[index], points[index + 1], points[index + 2], 0, TAU);
      }
      ctx.fill();
    }
  }

  function drawArcs(now) {
    for (const arc of arcs) {
      if (!arc.points.length) continue;
      const color = arc.next ? theme.accent2 : theme.accent;
      const alpha = arc.next ? 0.8 : 0.2;
      ctx.strokeStyle = rgba(color, arc.next ? 0.1 : 0.05);
      ctx.lineWidth = arc.next ? 5 : 3;
      ctx.beginPath();
      let started = false;
      for (const vector of arc.points) {
        const point = project(vector, yaw, tilt);
        if (point.z <= 0.01) {
          started = false;
          continue;
        }
        if (!started) {
          ctx.moveTo(point.x, point.y);
          started = true;
        } else {
          ctx.lineTo(point.x, point.y);
        }
      }
      ctx.stroke();

      ctx.strokeStyle = rgba(color, alpha);
      ctx.lineWidth = arc.next ? 1.35 : 0.75;
      ctx.beginPath();
      started = false;
      for (const vector of arc.points) {
        const point = project(vector, yaw, tilt);
        if (point.z <= 0.01) {
          started = false;
          continue;
        }
        if (!started) {
          ctx.moveTo(point.x, point.y);
          started = true;
        } else {
          ctx.lineTo(point.x, point.y);
        }
      }
      ctx.stroke();

      if (arc.next && !reduced) {
        const progress = (now * 0.00011 + arc.index * 0.21) % 1;
        const index = Math.min(arc.points.length - 1, Math.floor(progress * (arc.points.length - 1)));
        const point = project(arc.points[index], yaw, tilt);
        if (point.z > 0.02) {
          const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, 13);
          glow.addColorStop(0, rgba(color, 0.9));
          glow.addColorStop(0.35, rgba(color, 0.35));
          glow.addColorStop(1, rgba(color, 0));
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(point.x, point.y, 13, 0, TAU);
          ctx.fill();
          ctx.fillStyle = rgba(color, 0.95);
          ctx.beginPath();
          ctx.arc(point.x, point.y, 1.8, 0, TAU);
          ctx.fill();
        }
      }
    }
  }

  function drawLabel(text, x, y, color, size, mono) {
    ctx.font = mono
      ? `500 ${size}px "JetBrains Mono", monospace`
      : `500 ${size}px "Inter", sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const width = ctx.measureText(text).width;
    ctx.fillStyle = rgba(theme.deep, 0.86);
    ctx.fillRect(x - 4, y - size * 0.8, width + 8, size * 1.6);
    ctx.fillStyle = rgba(color, 0.94);
    ctx.fillText(text, x, y);
  }

  function drawPins(now) {
    const pulse = (now % 2200) / 2200;
    for (const pin of pins) {
      const point = project(pin.vector, yaw, tilt);
      pin.screen = point;
      if (point.z <= 0.02) continue;
      const hovered = pin.id === hoverId;
      const live = pin.live;
      const color = live ? theme.hold : pin.next ? theme.accent2 : theme.accent;
      if (pin.next || hovered) {
        const ringRadius = pin.next && !reduced ? 5 + pulse * 17 : 9;
        ctx.strokeStyle = rgba(color, pin.next && !reduced ? (1 - pulse) * 0.55 : 0.45);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(point.x, point.y, ringRadius, 0, TAU);
        ctx.stroke();
      }
      const dotRadius = pin.next ? 3.4 : hovered ? 2.8 : 1.7;
      const glowRadius = pin.next ? 12 : hovered ? 8 : 4;
      const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, glowRadius);
      glow.addColorStop(0, rgba(color, pin.next ? 0.65 : 0.4));
      glow.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(point.x, point.y, glowRadius, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba(color, pin.next ? 1 : 0.75);
      ctx.beginPath();
      ctx.arc(point.x, point.y, dotRadius, 0, TAU);
      ctx.fill();

      if (pin.next) {
        drawLabel(live ? "LIVE" : "NEXT", point.x + 9, point.y - 15, theme.accent2, 8, true);
      } else if (hovered) {
        const label = pin.provider ? `${pin.provider} · ${pin.name}` : pin.name;
        drawLabel(label.slice(0, 30), point.x + 8, point.y - 12, theme.accent2, 9, false);
      }
    }
  }

  function draw(now) {
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(centerX, centerY, radius * 0.62, centerX, centerY, radius * 1.2);
    glow.addColorStop(0, rgba(theme.accent, 0.15));
    glow.addColorStop(0.55, rgba(theme.accent, 0.07));
    glow.addColorStop(1, rgba(theme.accent, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 1.2, 0, TAU);
    ctx.fill();

    const ocean = ctx.createRadialGradient(
      centerX - radius * 0.36,
      centerY - radius * 0.42,
      radius * 0.05,
      centerX + radius * 0.18,
      centerY + radius * 0.24,
      radius * 1.06,
    );
    ocean.addColorStop(0, rgba(theme.raised, 0.92));
    ocean.addColorStop(0.48, rgba(theme.deep, 0.97));
    ocean.addColorStop(1, rgba(theme.deep, 1));
    ctx.fillStyle = ocean;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, TAU);
    ctx.clip();
    drawGraticule();
    drawLand();
    const shade = ctx.createLinearGradient(
      centerX - radius,
      centerY - radius,
      centerX + radius,
      centerY + radius,
    );
    shade.addColorStop(0, "rgba(255, 255, 255, 0.06)");
    shade.addColorStop(0.46, "rgba(0, 0, 0, 0)");
    shade.addColorStop(1, "rgba(0, 0, 0, 0.48)");
    ctx.fillStyle = shade;
    ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
    ctx.restore();

    ctx.strokeStyle = rgba(theme.accent2, 0.2);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = rgba(theme.accent2, 0.32);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - 1, Math.PI * 1.03, Math.PI * 1.63);
    ctx.stroke();

    drawArcs(now);
    drawPins(now);
  }

  function frame(now) {
    const dt = Math.min(48, now - lastFrame);
    lastFrame = now;
    if (visible) {
      if (!reduced) {
        if (targetYaw == null && now > resumeAt && !dragging) yaw += dt * 0.00004;
        if (targetYaw != null) {
          const diff = Math.atan2(Math.sin(targetYaw - yaw), Math.cos(targetYaw - yaw));
          if (Math.abs(diff) < 0.002) {
            yaw = targetYaw;
            targetYaw = null;
          } else {
            yaw += diff * 0.045;
          }
        }
        if (targetTilt != null) {
          const diff = targetTilt - tilt;
          if (Math.abs(diff) < 0.002) {
            tilt = targetTilt;
            targetTilt = null;
          } else {
            tilt += diff * 0.045;
          }
        }
        draw(now);
      } else if (dirty) {
        draw(now);
        dirty = false;
      }
    }
    frameId = requestAnimationFrame(frame);
  }

  function localPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function hitTest(x, y) {
    let best = null;
    let bestDistance = 16;
    for (const pin of pins) {
      if (!pin.screen || pin.screen.z <= 0.02) continue;
      const distance = Math.hypot(pin.screen.x - x, pin.screen.y - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = pin;
      }
    }
    return best;
  }

  function setHover(pin) {
    const id = pin ? pin.id : null;
    if (id === hoverId) return;
    hoverId = id;
    canvas.style.cursor = pin ? "pointer" : "grab";
    dirty = true;
  }

  function onPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    const point = localPoint(event);
    dragging = true;
    moved = false;
    lastX = point.x;
    lastY = point.y;
    downX = point.x;
    downY = point.y;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
    resumeAt = performance.now() + 2600;
    event.preventDefault();
  }

  function onPointerMove(event) {
    const point = localPoint(event);
    if (dragging) {
      const dx = point.x - lastX;
      const dy = point.y - lastY;
      if (Math.hypot(point.x - downX, point.y - downY) > 4) moved = true;
      yaw += dx * 0.006;
      tilt = clamp(tilt + dy * 0.004, -0.75, 0.75);
      lastX = point.x;
      lastY = point.y;
      targetYaw = null;
      targetTilt = null;
      dirty = true;
      event.preventDefault();
      return;
    }
    setHover(hitTest(point.x, point.y));
  }

  function onPointerUp(event) {
    if (!dragging) return;
    const point = localPoint(event);
    dragging = false;
    canvas.style.cursor = hoverId ? "pointer" : "grab";
    if (!moved) {
      const pin = hitTest(point.x, point.y);
      if (pin && typeof options.onSelect === "function") options.onSelect(pin.id);
    }
    resumeAt = performance.now() + 2400;
  }

  function onPointerLeave() {
    if (!dragging) setHover(null);
  }

  function onKeyDown(event) {
    const step = 0.1;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      yaw += event.key === "ArrowLeft" ? -step : step;
      targetYaw = null;
      dirty = true;
      event.preventDefault();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      tilt = clamp(tilt + (event.key === "ArrowUp" ? -0.06 : 0.06), -0.75, 0.75);
      targetTilt = null;
      dirty = true;
      event.preventDefault();
    } else if (event.key === "Enter" || event.key === " ") {
      const pin = pins.find((item) => item.id === (hoverId || nextId));
      if (pin && typeof options.onSelect === "function") {
        options.onSelect(pin.id);
        event.preventDefault();
      }
    }
  }

  function onThemeChange() {
    theme = readTheme();
    dirty = true;
  }

  function onResize() {
    resize();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", onResize);
  window.addEventListener("zh-themechange", onThemeChange);
  if (observer) observer.observe(canvas);
  resize();
  frameId = requestAnimationFrame(frame);

  return {
    setLaunches,
    destroy() {
      cancelAnimationFrame(frameId);
      if (observer) observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("zh-themechange", onThemeChange);
    },
  };
}
