import { startAscent } from "./ascent.js";
import { startStarfield } from "./starfield.js";

const API = "/api/launches?limit=24";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const REFRESH_MS = 5 * 60 * 1000;

const list = document.querySelector("#launches");
const status = document.querySelector("#status");
const hero = document.querySelector("#hero");
const heroContent = document.querySelector("#hero-content");
const search = document.querySelector("#search");
const statusChips = document.querySelector("#status-chips");
const providerSelect = document.querySelector("#provider");
const noResults = document.querySelector("#no-results");
const detail = document.querySelector("#detail");
const detailBody = document.querySelector("#detail-body");
const detailMedia = document.querySelector("#detail-media");
const sync = document.querySelector("#sync");
const radarBlips = document.querySelector("#radar-blips");
const clock = document.querySelector("#utc-clock");
const clockTz = document.querySelector("#clock-tz");
const stat24h = document.querySelector("#stat-24h");
const statWeek = document.querySelector("#stat-week");
const statGo = document.querySelector("#stat-go");
const toast = document.querySelector("#toast");
const boot = document.querySelector("#boot");
const bootLog = document.querySelector("#boot-log");
const bootProgress = document.querySelector("#boot-progress");

let launches = [];
let nextLaunch = null;
let fetchedAt = null;
let stale = false;
let lastTrigger = null;
let tz = "local";
const filters = { q: "", status: "all", provider: "" };

try {
  tz = localStorage.getItem("zh-tz") === "utc" ? "utc" : "local";
} catch {
  /* storage unavailable: fall back to local time */
}

const STATUS_CLASS = { GO: "go", TBC: "tbc", TBD: "tbd", HOLD: "hold" };

function statusClass(abbrev) {
  return STATUS_CLASS[(abbrev || "").toUpperCase()] || "tbd";
}

function statusAbbrev(launch) {
  return (launch.status && launch.status.abbrev) || "TBD";
}

function esc(value) {
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

function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function tzOption() {
  return tz === "utc" ? { timeZone: "UTC" } : {};
}

function fmt(value, opts) {
  return new Date(value).toLocaleString(undefined, { ...opts, ...tzOption() });
}

function tzLabel() {
  if (tz === "utc") return "UTC";
  const part = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(new Date())
    .find((item) => item.type === "timeZoneName");
  return part ? part.value : "Local";
}

function fullDate(value) {
  return fmt(value, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeOnly(value) {
  return fmt(value, { hour: "2-digit", minute: "2-digit" });
}

function dateOnly(value) {
  return fmt(value, { month: "short", day: "numeric", year: "numeric" });
}

function weekday(value) {
  return fmt(value, { weekday: "long" });
}

function dayKey(value) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...tzOption(),
  }).format(new Date(value));
}

function countdownParts(ms) {
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

function shortCountdown(ms) {
  const cd = countdownParts(ms);
  const sign = cd.past ? "T+" : "T-";
  if (cd.d > 0) return `${sign} ${cd.d}d ${pad(cd.h)}h ${pad(cd.m)}m`;
  return `${sign} ${pad(cd.h)}:${pad(cd.m)}:${pad(cd.s)}`;
}

function missionName(launch) {
  const parts = launch.name.split(" | ");
  return parts.length > 1 ? parts.slice(1).join(" | ") : launch.name;
}

function rocketName(launch) {
  return launch.rocket;
}

function providerName(launch) {
  return launch.provider && launch.provider.name;
}

function padName(launch) {
  return launch.pad && launch.pad.name;
}

function pickNextLaunch() {
  const now = Date.now();
  nextLaunch = launches.find((l) => new Date(l.net) > now - 10 * 60 * 1000) || launches[0] || null;
}

function renderHero() {
  if (!nextLaunch) {
    heroContent.innerHTML = `<p class="hero__eyebrow">Next launch</p><h2 class="hero__title">No upcoming launches</h2>`;
    return;
  }
  const providers = new Set(launches.map((launch) => providerName(launch) || "Unknown"));
  const windowLabel =
    nextLaunch.window_start && nextLaunch.window_end
      ? `${timeOnly(nextLaunch.window_start)} - ${timeOnly(nextLaunch.window_end)}`
      : "To be confirmed";

  heroContent.innerHTML = `
    <p class="hero__eyebrow">Next launch</p>
    <h2 class="hero__title">${esc(missionName(nextLaunch))}</h2>
    <p class="hero__sub">${esc(rocketName(nextLaunch) || "Unknown rocket")} - ${esc(providerName(nextLaunch) || "Unknown provider")}</p>
    <div class="countdown" id="hero-countdown">
      <div class="countdown__unit"><strong data-unit="d">00</strong><span>Days</span></div>
      <div class="countdown__unit"><strong data-unit="h">00</strong><span>Hours</span></div>
      <div class="countdown__unit"><strong data-unit="m">00</strong><span>Minutes</span></div>
      <div class="countdown__unit"><strong data-unit="s">00</strong><span>Seconds</span></div>
    </div>
    <dl class="hero__meta">
      <div><dt>Provider</dt><dd>${esc(providerName(nextLaunch) || "Unknown")}</dd></div>
      <div><dt>Pad</dt><dd>${esc(padName(nextLaunch) || "Unknown")}</dd></div>
      <div><dt>Window</dt><dd>${esc(windowLabel)}</dd></div>
    </dl>
    <div class="hero__actions">
      <button type="button" class="btn btn--primary" id="hero-details">Mission briefing</button>
      <button type="button" class="btn" id="hero-calendar">Add to calendar</button>
    </div>
    <div class="hero__stats">
      <div class="hero__stat"><b>${launches.length}</b><span>Tracked</span></div>
      <div class="hero__stat"><b>${providers.size}</b><span>Providers</span></div>
      <div class="hero__stat"><b>${timeOnly(nextLaunch.net)}</b><span>Next lift-off</span></div>
    </div>`;

  const detailsButton = heroContent.querySelector("#hero-details");
  if (detailsButton) detailsButton.addEventListener("click", () => openDetail(nextLaunch.id));

  const calendarButton = heroContent.querySelector("#hero-calendar");
  if (calendarButton) {
    calendarButton.addEventListener("click", () => {
      downloadIcs(nextLaunch);
      showToast("Calendar event downloaded");
    });
  }
}

function radarPoint(lat, lon) {
  const phi = (lat * Math.PI) / 180;
  const theta = (lon * Math.PI) / 180;
  return {
    x: 50 + Math.cos(phi) * Math.sin(theta) * 44,
    y: 50 - Math.sin(phi) * 44,
  };
}

function renderRadar() {
  const points = [];
  for (const launch of launches) {
    const pad = launch.pad;
    if (!pad || pad.latitude == null || pad.longitude == null) continue;
    points.push(radarPoint(pad.latitude, pad.longitude));
  }

  radarBlips.innerHTML = points
    .slice(0, 18)
    .map(
      (point, index) =>
        `<span class="radar__blip" style="--x:${point.x.toFixed(2)}%;--y:${point.y.toFixed(2)}%;--delay:${(index * 0.17).toFixed(2)}s"></span>`,
    )
    .join("");

  const within = (launch, ms) => {
    const time = new Date(launch.net).getTime();
    return time >= Date.now() - 10 * 60 * 1000 && time <= Date.now() + ms;
  };
  stat24h.textContent = launches.filter((launch) => within(launch, DAY)).length;
  statWeek.textContent = launches.filter((launch) => within(launch, 7 * DAY)).length;
  statGo.textContent = launches.filter((launch) => statusAbbrev(launch) === "GO").length;
}

function runBoot() {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    boot.classList.add("is-done");
    return;
  }

  const lines = [
    "Uplink established",
    "Fetching launch window",
    "Synchronizing clocks",
    "Trajectory locked",
  ];

  lines.forEach((line, index) => {
    setTimeout(() => {
      const item = document.createElement("li");
      item.textContent = line;
      bootLog.appendChild(item);
      requestAnimationFrame(() => item.classList.add("is-on"));
      bootProgress.style.width = `${Math.round(((index + 1) / lines.length) * 100)}%`;
    }, 220 + index * 460);
  });

  setTimeout(() => boot.classList.add("is-done"), 220 + lines.length * 460 + 400);
}

function tick() {
  const now = Date.now();
  renderClock();

  const box = nextLaunch && document.querySelector("#hero-countdown");
  if (box) {
    const cd = countdownParts(new Date(nextLaunch.net) - now);
    box.querySelector('[data-unit="d"]').textContent = String(cd.d);
    box.querySelector('[data-unit="h"]').textContent = pad(cd.h);
    box.querySelector('[data-unit="m"]').textContent = pad(cd.m);
    box.querySelector('[data-unit="s"]').textContent = pad(cd.s);
    box.classList.toggle("is-past", cd.past);
  }

  for (const el of document.querySelectorAll("[data-countdown]")) {
    const launch = launches.find((l) => l.id === el.dataset.countdown);
    if (launch) el.textContent = shortCountdown(new Date(launch.net) - now);
  }

  if (detail.open && detail.dataset.id) {
    const launch = launches.find((l) => l.id === detail.dataset.id);
    const el = document.querySelector("#detail-count");
    if (launch && el) el.textContent = shortCountdown(new Date(launch.net) - now);
  }
}

let toastTimer = null;

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-on"), 2600);
}

function renderClock() {
  clock.textContent = new Date().toLocaleTimeString(undefined, { hour12: false, ...tzOption() });
  clockTz.textContent = tzLabel();
}

function renderSync() {
  if (!fetchedAt) return;
  if (stale) {
    sync.textContent = "Showing cached data";
    return;
  }
  const mins = Math.max(0, Math.round((Date.now() - fetchedAt) / 60_000));
  sync.textContent = mins === 0 ? "Synced just now" : `Synced ${mins} min ago`;
}

function matches(launch) {
  if (filters.status !== "all" && statusAbbrev(launch) !== filters.status) {
    return false;
  }

  const provider = providerName(launch) || "Unknown provider";
  if (filters.provider && provider !== filters.provider) {
    return false;
  }

  if (!filters.q) {
    return true;
  }

  const haystack = [
    launch.name,
    rocketName(launch),
    provider,
    launch.mission && launch.mission.name,
    launch.mission && launch.mission.orbit,
    launch.pad && launch.pad.name,
    launch.pad && launch.pad.location,
  ]
    .join(" ")
    .toLowerCase();

  return filters.q
    .toLowerCase()
    .split(/\s+/)
    .every((term) => haystack.includes(term));
}

function card(launch) {
  const image = safeUrl(launch.thumbnail_url || launch.image_url);
  const abbrev = statusAbbrev(launch);
  const statusName = (launch.status && launch.status.name) || "To Be Determined";

  return `
    <button type="button" class="card" data-id="${esc(launch.id)}">
      <div class="card__media">
        ${image ? `<img src="${esc(image)}" alt="" loading="lazy">` : ""}
        <span class="pill pill--${statusClass(abbrev)}" title="${esc(statusName)}">${esc(abbrev)}</span>
      </div>
      <div class="card__body">
        <span class="card__provider">${esc(providerName(launch) || "Unknown provider")}</span>
        <h2 class="card__title">${esc(missionName(launch))}</h2>
        ${rocketName(launch) ? `<span class="card__rocket">${esc(rocketName(launch))}</span>` : ""}
        <div class="card__foot">
          <div class="card__where">
            <span class="card__time">${esc(fullDate(launch.net))}</span>
            <span class="card__pad">${esc(padName(launch) || "")}</span>
          </div>
          <span class="card__countdown" data-countdown="${esc(launch.id)}"></span>
        </div>
      </div>
    </button>`;
}

function groupFor(launch, todayKey, tomorrowKey, now) {
  const net = new Date(launch.net);
  const key = dayKey(net);
  let rel;
  if (key === todayKey) rel = "Today";
  else if (key === tomorrowKey) rel = "Tomorrow";
  else if (net - now < 6 * DAY) rel = weekday(net);
  else rel = fmt(net, { weekday: "short", day: "numeric" });
  return { key, rel, date: dateOnly(net), today: key === todayKey };
}

function renderLaunches() {
  const now = Date.now();
  const filtered = launches.filter(matches);
  const todayKey = dayKey(new Date(now));
  const tomorrowKey = dayKey(new Date(now + DAY));

  const groups = [];
  const byKey = new Map();
  for (const launch of filtered) {
    const group = groupFor(launch, todayKey, tomorrowKey, now);
    if (!byKey.has(group.key)) {
      byKey.set(group.key, { ...group, items: [] });
      groups.push(byKey.get(group.key));
    }
    byKey.get(group.key).items.push(launch);
  }

  list.innerHTML = groups
    .map(
      (group) => `
      <section class="day${group.today ? " is-today" : ""}">
        <header class="day__label">
          <span class="day__rel">${group.rel}</span>
          <span class="day__date">${group.date}</span>
        </header>
        <div class="day__cards">${group.items.map(card).join("")}</div>
      </section>`,
    )
    .join("");

  noResults.hidden = filtered.length > 0 || launches.length === 0;
  status.textContent =
    filtered.length === launches.length
      ? `${launches.length} upcoming launches`
      : `${filtered.length} of ${launches.length} launches`;
  list.setAttribute("aria-busy", "false");
  tick();
}

function renderSkeletons() {
  const skeleton = `<div class="card skeleton"><div class="card__media"></div><div class="card__body"><div class="sk-line" style="width:30%"></div><div class="sk-line" style="width:75%;height:18px"></div><div class="sk-line" style="width:50%"></div></div></div>`;
  list.innerHTML = `<section class="day"><header class="day__label"><span class="sk-line" style="width:70px"></span></header><div class="day__cards">${skeleton.repeat(3)}</div></section>`;
  list.setAttribute("aria-busy", "true");
}

function renderProviders() {
  const counts = new Map();
  for (const launch of launches) {
    const name = providerName(launch) || "Unknown provider";
    counts.set(name, (counts.get(name) || 0) + 1);
  }

  providerSelect.innerHTML =
    `<option value="">All providers</option>` +
    [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => `<option value="${esc(name)}">${esc(name)} (${count})</option>`)
      .join("");
  providerSelect.value = filters.provider;
}

function mapEmbed(lat, lon) {
  const d = 0.06;
  const bbox = [lon - d * 2, lat - d, lon + d * 2, lat + d].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
}

function windowText(launch) {
  if (!launch.window_start || !launch.window_end) return "Not published";
  return `${fullDate(launch.window_start)} - ${fullDate(launch.window_end)}`;
}

function openDetail(id) {
  const launch = launches.find((l) => l.id === id);
  if (!launch) return;

  const image = safeUrl(launch.image_url || launch.thumbnail_url);
  detailMedia.innerHTML = image ? `<img src="${esc(image)}" alt="">` : "";

  const abbrev = statusAbbrev(launch);
  const facts = [
    ["Liftoff", fullDate(launch.net)],
    ["Window", windowText(launch)],
    ["Rocket", rocketName(launch) || "Unknown"],
    ["Provider", providerName(launch) || "Unknown"],
    ["Mission type", (launch.mission && launch.mission.type) || "Unknown"],
    ["Orbit", (launch.mission && launch.mission.orbit) || "Unknown"],
    ["Pad", (launch.pad && launch.pad.name) || "Unknown"],
    ["Location", (launch.pad && launch.pad.location) || "Unknown"],
  ];

  const lat = Number(launch.pad && launch.pad.latitude);
  const lon = Number(launch.pad && launch.pad.longitude);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
  const video = safeUrl(launch.video_url);
  const info = safeUrl(launch.info_url);
  const mapUrl = safeUrl(launch.pad && launch.pad.map_url);

  detailBody.innerHTML = `
    <div class="detail__pills">
      <span class="pill pill--${statusClass(abbrev)}">${esc(abbrev)}</span>
      <span class="pill pill--muted">${esc((launch.status && launch.status.name) || "To Be Determined")}</span>
    </div>
    <h2 class="detail__title" id="detail-title">${esc(missionName(launch))}</h2>
    <p class="detail__sub">${esc(rocketName(launch) || "")} - ${esc(providerName(launch) || "")}</p>
    <div class="detail__count" id="detail-count">--</div>
    <dl class="detail__grid">
      ${facts.map(([key, value]) => `<div><dt>${key}</dt><dd>${esc(value)}</dd></div>`).join("")}
    </dl>
    ${launch.mission && launch.mission.description ? `<h3>Mission</h3><p class="detail__desc">${esc(launch.mission.description)}</p>` : ""}
    ${hasCoords ? `<h3>Launch site</h3><div class="detail__map"><iframe title="Launch site map" loading="lazy" src="${mapEmbed(lat, lon)}"></iframe></div>` : ""}
    <div class="detail__actions">
      ${video ? `<a class="btn" href="${esc(video)}" target="_blank" rel="noopener">${launch.webcast_live ? "Watch live" : "Webcast"}</a>` : ""}
      <button type="button" class="btn" data-action="ics">Add to calendar</button>
      ${mapUrl ? `<a class="btn" href="${esc(mapUrl)}" target="_blank" rel="noopener">Open in Maps</a>` : ""}
      ${info ? `<a class="btn" href="${esc(info)}" target="_blank" rel="noopener">Mission info</a>` : ""}
    </div>`;

  const icsButton = detailBody.querySelector('[data-action="ics"]');
  if (icsButton) icsButton.addEventListener("click", () => downloadIcs(launch));

  detail.dataset.id = id;
  if (!detail.open) detail.showModal();
  detail.querySelector(".detail__panel").scrollTop = 0;
  tick();
}

function closeDetail() {
  if (detail.open) detail.close();
  delete detail.dataset.id;
  if (lastTrigger && lastTrigger.isConnected !== false) lastTrigger.focus();
  lastTrigger = null;
}

function icsDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsEscape(text) {
  return String(text || "")
    .replace(/[\\;,]/g, (c) => "\\" + c)
    .replace(/\n/g, "\\n");
}

function downloadIcs(launch) {
  const start = new Date(launch.net);
  const end =
    launch.window_end && new Date(launch.window_end) > start
      ? new Date(launch.window_end)
      : new Date(start.getTime() + HOUR);

  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Zero Hour//Launch Tracker//EN",
    "BEGIN:VEVENT",
    `UID:${launch.id}@zerohour`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(`Launch: ${missionName(launch)} (${rocketName(launch) || ""})`)}`,
    `LOCATION:${icsEscape((launch.pad && launch.pad.name) || "")}`,
    `DESCRIPTION:${icsEscape(`${providerName(launch) || ""}\n\n${(launch.mission && launch.mission.description) || ""}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([body], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const filename = String(launch.slug || "launch").replace(/[^\w.-]+/g, "-");
  link.download = `${filename}.ics`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setTz(value) {
  tz = value === "utc" ? "utc" : "local";
  try {
    localStorage.setItem("zh-tz", tz);
  } catch {
    /* storage unavailable */
  }
  for (const button of document.querySelectorAll("[data-tz]")) {
    button.setAttribute("aria-pressed", String(button.dataset.tz === tz));
  }
  renderClock();
  if (!launches.length) return;
  renderHero();
  renderLaunches();
  renderSync();
  if (detail.open && detail.dataset.id) openDetail(detail.dataset.id);
}

function wire() {
  let searchTimer;

  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    event.preventDefault();
    search.focus();
  });

  search.addEventListener("input", (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filters.q = event.target.value.trim();
      renderLaunches();
    }, 150);
  });

  statusChips.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    for (const other of statusChips.querySelectorAll(".chip")) {
      other.classList.toggle("is-active", other === chip);
    }
    filters.status = chip.dataset.status;
    renderLaunches();
  });

  providerSelect.addEventListener("change", (event) => {
    filters.provider = event.target.value;
    renderLaunches();
  });

  document.querySelector("#clear-filters").addEventListener("click", () => {
    filters.q = "";
    filters.status = "all";
    filters.provider = "";
    search.value = "";
    providerSelect.value = "";
    for (const chip of statusChips.querySelectorAll(".chip")) {
      chip.classList.toggle("is-active", chip.dataset.status === "all");
    }
    renderLaunches();
  });

  for (const button of document.querySelectorAll("[data-tz]")) {
    button.addEventListener("click", () => setTz(button.dataset.tz));
  }

  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-id]");
    if (!button) return;
    lastTrigger = button;
    openDetail(button.dataset.id);
  });

  document.querySelector("#detail-close").addEventListener("click", closeDetail);
  detail.addEventListener("click", (event) => {
    if (event.target === detail) closeDetail();
  });
  detail.addEventListener("close", () => {
    delete detail.dataset.id;
  });
}

async function loadLaunches() {
  try {
    const response = await fetch(API);
    if (!response.ok) {
      throw new Error("Request failed with status " + response.status);
    }
    const data = await response.json();
    launches = (data.results || []).sort((a, b) => new Date(a.net) - new Date(b.net));
    stale = Boolean(data.stale);
    fetchedAt = data.fetched_at ? new Date(data.fetched_at).getTime() : Date.now();

    pickNextLaunch();
    renderHero();
    renderProviders();
    renderLaunches();
    renderRadar();
    renderSync();
  } catch (error) {
    list.setAttribute("aria-busy", "false");
    status.innerHTML =
      'Could not load launches. <button type="button" class="btn btn--inline" id="retry">Retry</button>';
    const retry = document.querySelector("#retry");
    if (retry) retry.addEventListener("click", loadLaunches);
    sync.textContent = "Offline";
    console.error(error);
  }
}

startStarfield(document.querySelector("#starfield"));
startAscent(document.querySelector("#ascent"), hero);

try {
  if (sessionStorage.getItem("zh-booted") === "1") {
    boot.classList.add("is-done");
  } else {
    runBoot();
    sessionStorage.setItem("zh-booted", "1");
  }
} catch {
  runBoot();
}

renderSkeletons();
wire();
setTz(tz);
loadLaunches();
setInterval(tick, 1000);
setInterval(renderSync, 30_000);
setInterval(loadLaunches, REFRESH_MS);
