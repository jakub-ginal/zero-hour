export const HOUR = 3600 * 1000;
export const DAY = 24 * HOUR;
export const PRECISE = new Set(["SEC", "MIN", "HR"]);
export const READY = new Set(["SEC", "MIN", "HR", "DAY"]);
export const SAVED_KEY = "zh-saved";

const STATUS_CLASS = { GO: "go", TBC: "tbc", TBD: "tbd", HOLD: "hold" };

let tz = "local";
try {
  tz = localStorage.getItem("zh-tz") === "utc" ? "utc" : "local";
} catch {
  tz = "local";
}

export function esc(value) {
  return String(value == null ? "" : value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

export function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function pad(value) {
  return String(value).padStart(2, "0");
}

export function getTz() {
  return tz;
}

export function setTz(value) {
  tz = value === "utc" ? "utc" : "local";
  try {
    localStorage.setItem("zh-tz", tz);
  } catch {
    /* storage can be unavailable */
  }
}

export function tzOption() {
  return tz === "utc" ? { timeZone: "UTC" } : {};
}

export function fmt(value, options) {
  return new Date(value).toLocaleString(undefined, { ...options, ...tzOption() });
}

export function tzLabel() {
  if (tz === "utc") return "UTC";
  const part = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(new Date())
    .find((item) => item.type === "timeZoneName");
  return part ? part.value : "Local";
}

export function timeOnly(value) {
  return fmt(value, { hour: "2-digit", minute: "2-digit" });
}

export function dateOnly(value) {
  return fmt(value, { month: "short", day: "numeric", year: "numeric" });
}

export function weekday(value) {
  return fmt(value, { weekday: "long" });
}

export function dayKey(value) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...tzOption(),
  }).format(new Date(value));
}

export function countdownParts(ms) {
  const past = ms < 0;
  const abs = Math.abs(ms);
  return {
    past,
    d: Math.floor(abs / DAY),
    h: Math.floor((abs % DAY) / HOUR),
    m: Math.floor((abs % HOUR) / 60_000),
    s: Math.floor((abs % 60_000) / 1_000),
  };
}

export function isPrecise(launch) {
  return !launch.net_precision || PRECISE.has(launch.net_precision);
}

export function isReady(launch) {
  return !launch.net_precision || READY.has(launch.net_precision);
}

export function fuzzyDate(launch) {
  const precision = launch.net_precision || "";
  if (precision === "DAY") return fmt(launch.net, { weekday: "short", month: "short", day: "numeric" });
  if (precision === "M") return fmt(launch.net, { month: "long", year: "numeric" });
  if (/^Q[1-4]$/.test(precision)) return `${precision} ${fmt(launch.net, { year: "numeric" })}`;
  if (/^H[12]$/.test(precision)) return `${precision} ${fmt(launch.net, { year: "numeric" })}`;
  return fmt(launch.net, { year: "numeric" });
}

export function whenText(launch) {
  if (isPrecise(launch)) {
    return fmt(launch.net, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return `NET ${fuzzyDate(launch)}`;
}

export function windowText(launch) {
  if (!launch.window_start || !launch.window_end || !isPrecise(launch)) return "Not yet published";
  return `${timeOnly(launch.window_start)} - ${timeOnly(launch.window_end)} ${tzLabel()}`;
}

export function statusAbbrev(launch) {
  return (launch.status && launch.status.abbrev) || "TBD";
}

export function statusClass(abbrev) {
  const key = (abbrev || "").toUpperCase();
  if (STATUS_CLASS[key]) return STATUS_CLASS[key];
  if (key.includes("SUCCESS")) return "go";
  if (key.includes("FAIL")) return "hold";
  if (key.includes("FLIGHT")) return "tbc";
  return "tbd";
}

export function statusPill(launch) {
  if (launch.webcast_live) return `<span class="pill pill--live">Live</span>`;
  const abbrev = statusAbbrev(launch);
  const title = (launch.status && launch.status.description) || "";
  return `<span class="pill pill--${statusClass(abbrev)}" title="${esc(title)}">${esc(abbrev)}</span>`;
}

export function launchDayState(launch, now = Date.now()) {
  const net = launch && launch.net ? new Date(launch.net).getTime() : NaN;
  if (!Number.isFinite(net)) {
    return { active: false, phase: "upcoming", diff: NaN, live: false, inWindow: false };
  }
  const diff = net - now;
  const live = Boolean(launch.webcast_live);
  const precise = isPrecise(launch);
  const windowStart = launch.window_start ? new Date(launch.window_start).getTime() : NaN;
  const windowEnd = launch.window_end ? new Date(launch.window_end).getTime() : NaN;
  const inWindow =
    Number.isFinite(windowStart) && Number.isFinite(windowEnd) && now >= windowStart && now <= windowEnd;
  const near = precise && diff <= DAY && diff > -6 * HOUR;
  const active = live || near;
  let phase = "upcoming";
  if (live) phase = "live";
  else if (near && diff < 0) phase = "liftoff";
  else if (inWindow) phase = "window";
  else if (near) phase = "today";
  return { active, phase, diff, live, precise, inWindow };
}

export function launchDayKicker(state) {
  if (!state || !state.active) return "";
  if (state.phase === "live") return "Live now";
  if (state.phase === "liftoff") return "T+ tracking";
  if (state.phase === "window") return "Window open";
  return "Launch day";
}

export function launchDayHeadline(launch, state) {
  if (!state || !state.active) return "";
  if (state.phase === "live") return "Live now";
  const abbrev = statusAbbrev(launch).toUpperCase();
  if (abbrev === "HOLD") return "Launch is on hold";
  if (state.phase === "liftoff") return "Awaiting launch confirmation";
  if (state.phase === "window") return "Launch window is open";
  if (abbrev === "GO") return "Go for launch";
  return "Launch day";
}

export function launchDayRefreshDue(launch, now = Date.now()) {
  const state = launchDayState(launch, now);
  if (!state.active) return false;
  if (state.live) return true;
  return Number.isFinite(state.diff) && state.diff <= 3 * HOUR && state.diff > -HOUR;
}

export function missionName(launch) {
  const parts = launch.name.split(" | ");
  if (parts.length > 1) return parts.slice(1).join(" | ");
  return (launch.mission && launch.mission.name) || launch.name;
}

export function providerName(launch) {
  return (launch.provider && launch.provider.name) || "Unknown";
}

export function countryCode(code) {
  return code && code.length === 2 ? code.toUpperCase() : "";
}

export function shortCountdown(launch, now = Date.now()) {
  const diff = new Date(launch.net) - now;
  if (!isPrecise(launch)) {
    if (launch.net_precision === "DAY" && diff > 0) return `T- ~${Math.ceil(diff / DAY)}d`;
    return `NET ${fuzzyDate(launch)}`;
  }
  const cd = countdownParts(diff);
  const sign = cd.past ? "T+" : "T-";
  if (cd.d > 0) return `${sign} ${cd.d}d ${pad(cd.h)}h ${pad(cd.m)}m`;
  return `${sign} ${pad(cd.h)}:${pad(cd.m)}:${pad(cd.s)}`;
}

export function readSaved() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeSaved(ids) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify([...ids]));
  } catch {
    /* storage can be unavailable */
  }
}

export function toggleSaved(id) {
  const ids = readSaved();
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  writeSaved(ids);
  return ids.has(id);
}

export function watchlistExport(ids) {
  return JSON.stringify(
    {
      app: "Zero Hour",
      version: 1,
      exported_at: new Date().toISOString(),
      saved: [...ids],
    },
    null,
    2,
  );
}

export function parseWatchlist(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data && data.saved;
  if (!Array.isArray(list)) throw new Error("No saved launches found");
  return new Set(
    list
      .filter((id) => typeof id === "string" && id.length > 0 && id.length <= 80)
      .slice(0, 500),
  );
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {
      /* offline support is optional */
    });
  });
}

export function wireTzButtons(root = document) {
  const buttons = [...root.querySelectorAll("[data-tz]")];
  const paint = () => {
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.tz === getTz()));
    }
  };
  for (const button of buttons) {
    button.addEventListener("click", () => {
      setTz(button.dataset.tz);
      paint();
      window.dispatchEvent(new CustomEvent("zh:tzchange"));
    });
  }
  paint();
}
