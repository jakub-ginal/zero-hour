import { startAscent } from "./ascent.js";
import { initFinder } from "./finder.js";
import { startGlobe } from "./globe.js";
import {
  launchDayHeadline,
  launchDayKicker,
  launchDayRefreshDue,
  launchDayState,
  wireNavScroll,
} from "./shared.js";
import { startStarfield } from "./starfield.js";

const API = "/api/launches?limit=100";
const SAVED_KEY = "zh-saved";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const REFRESH_MS = 5 * 60 * 1000;
const LAUNCH_DAY_REFRESH_MS = 60 * 1000;
const PAGE_SIZE = 24;
const RANGES = { "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY };
const isRange = (value) => typeof RANGES[value] === "number";
const PRECISE = new Set(["SEC", "MIN", "HR"]);
const VALID_STATUS = new Set(["Go", "TBC", "TBD"]);

const list = document.querySelector("#launches");
const status = document.querySelector("#status");
const hero = document.querySelector("#hero");
const heroContent = document.querySelector("#hero-content");
const search = document.querySelector("#search");
const statusChips = document.querySelector("#status-chips");
const providerSelect = document.querySelector("#provider");
const rangeSelect = document.querySelector("#range");
const noResults = document.querySelector("#no-results");
const noResultsText = noResults && noResults.querySelector("p");
const clearFilters = document.querySelector("#clear-filters");
const loadMoreWrap = document.querySelector("#load-more-wrap");
const loadMore = document.querySelector("#load-more");
const savedToggle = document.querySelector("#saved-toggle");
const savedCount = document.querySelector("#saved-count");
const detail = document.querySelector("#detail");
const detailBody = document.querySelector("#detail-body");
const detailMedia = document.querySelector("#detail-media");
const sync = document.querySelector("#sync");
const globeCanvas = document.querySelector("#globe-canvas");
const clock = document.querySelector("#utc-clock");
const clockTz = document.querySelector("#clock-tz");
const stat24h = document.querySelector("#stat-24h");
const statWeek = document.querySelector("#stat-week");
const statGo = document.querySelector("#stat-go");
const toast = document.querySelector("#toast");
const errorPanel = document.querySelector("#error");
const retryButton = document.querySelector("#retry");
const boot = document.querySelector("#boot");
const bootLog = document.querySelector("#boot-log");
const bootProgress = document.querySelector("#boot-progress");
const installButton = document.querySelector("#install-app");
const calendarLink = document.querySelector("#calendar-link");

let launches = [];
let nextLaunch = null;
let fetchedAt = null;
let lastLoadAt = null;
let stale = false;
let lastTrigger = null;
let heroSignature = "";
let visibleCount = PAGE_SIZE;
let tz = "local";
const saved = readSaved();
let installPrompt = null;
const filters = readFilters();
const globe = globeCanvas ? startGlobe(globeCanvas, { onSelect: (id) => openDetail(id) }) : null;

try {
  tz = localStorage.getItem("zh-tz") === "utc" ? "utc" : "local";
} catch {
  /* storage unavailable: fall back to local time */
}

function readSaved() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function readFilters() {
  let params;
  try {
    params = new URLSearchParams(location.search);
  } catch {
    params = new URLSearchParams();
  }
  const status = (params.get("status") || "").toLowerCase();
  const range = params.get("range") || "";
  return {
    q: (params.get("q") || "").slice(0, 120),
    status: [...VALID_STATUS].find((value) => value.toLowerCase() === status) || "all",
    provider: (params.get("provider") || "").trim().slice(0, 80),
    saved: params.get("saved") === "1",
    range: isRange(range) ? range : "all",
  };
}

function updateCalendarLink() {
  if (!calendarLink) return;
  const params = new URLSearchParams();
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.range !== "all") {
    params.set("days", filters.range === "24h" ? "1" : filters.range === "7d" ? "7" : "30");
  }
  const query = params.toString();
  calendarLink.href = `/calendar.html${query ? `?${query}` : ""}`;
}

function syncFiltersToUrl() {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.saved) params.set("saved", "1");
  if (filters.range !== "all") params.set("range", filters.range);
  const query = params.toString();
  const next = `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
  const current = `${location.pathname}${location.search}${location.hash}`;
  if (next !== current) history.replaceState(null, "", next);
  updateCalendarLink();
}

function setStatusChip() {
  for (const chip of statusChips.querySelectorAll(".chip")) {
    chip.classList.toggle("is-active", chip.dataset.status === filters.status);
  }
}

function hydrateFilters() {
  search.value = filters.q;
  if (rangeSelect) rangeSelect.value = filters.range;
  setStatusChip();
  syncFiltersToUrl();
}

function isSaved(id) {
  return saved.has(id);
}

function savedLabel(id) {
  return isSaved(id) ? "Remove from saved" : "Save launch";
}

function bookmarkIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-3.55L6 21V4.5Z"></path></svg>`;
}

function persistSaved() {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify([...saved]));
  } catch {
    /* storage unavailable: keep the in-memory watchlist */
  }
}

function renderSavedUI() {
  if (savedCount) savedCount.textContent = String(saved.size);
  if (savedToggle) {
    savedToggle.classList.toggle("is-active", filters.saved);
    savedToggle.setAttribute("aria-pressed", String(filters.saved));
    savedToggle.title = filters.saved ? "Show all launches" : "Show only saved launches";
  }
  for (const button of document.querySelectorAll("[data-save]")) {
    const on = isSaved(button.dataset.save);
    const label = on ? "Remove from saved" : "Save launch";
    button.classList.toggle("is-saved", on);
    button.setAttribute("aria-pressed", String(on));
    button.setAttribute("aria-label", label);
    button.title = label;
    if (button.classList.contains("btn")) button.textContent = on ? "Saved" : "Save launch";
  }
}

function toggleSaved(id) {
  if (!id) return;
  if (saved.has(id)) {
    saved.delete(id);
    showToast("Removed from saved");
  } else {
    saved.add(id);
    showToast("Saved for later");
  }
  persistSaved();
  renderSavedUI();
  if (filters.saved) renderLaunches();
}

const STATUS_CLASS = { GO: "go", TBC: "tbc", TBD: "tbd", HOLD: "hold" };

function statusClass(abbrev) {
  const key = (abbrev || "").toUpperCase();
  if (STATUS_CLASS[key]) return STATUS_CLASS[key];
  if (key.includes("SUCCESS")) return "go";
  if (key.includes("FAIL")) return "hold";
  if (key.includes("FLIGHT")) return "tbc";
  return "tbd";
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

function isPrecise(launch) {
  return !launch.net_precision || PRECISE.has(launch.net_precision);
}

function fuzzyDate(launch) {
  const net = launch.net;
  const precision = launch.net_precision || "";
  if (precision === "DAY") return fmt(net, { weekday: "short", month: "short", day: "numeric" });
  if (precision === "M") return fmt(net, { month: "long", year: "numeric" });
  if (/^Q[1-4]$/.test(precision)) return `${precision} ${fmt(net, { year: "numeric" })}`;
  if (/^H[12]$/.test(precision)) return `${precision} ${fmt(net, { year: "numeric" })}`;
  return fmt(net, { year: "numeric" });
}

function whenText(launch) {
  if (isPrecise(launch)) {
    return fmt(launch.net, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  return `NET ${fuzzyDate(launch)}`;
}

function countryCode(code) {
  return code && code.length === 2 ? code.toUpperCase() : "";
}

function countryLabel(code) {
  const value = countryCode(code);
  return value ? `<span class="country">${esc(value)}</span> · ` : "";
}

function shortCountdown(launch, now) {
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

function missionName(launch) {
  const parts = launch.name.split(" | ");
  if (parts.length > 1) return parts.slice(1).join(" | ");
  return (launch.mission && launch.mission.name) || launch.name;
}

function statusPill(launch) {
  if (launch.webcast_live) return `<span class="pill pill--live">Live</span>`;
  const abbrev = statusAbbrev(launch);
  const title = (launch.status && launch.status.description) || "";
  return `<span class="pill pill--${statusClass(abbrev)}" title="${esc(title)}">${esc(abbrev)}</span>`;
}

function rocketName(launch) {
  return launch.rocket;
}

function providerName(launch) {
  return launch.provider && launch.provider.name;
}

function pickNextLaunch() {
  const now = Date.now();
  nextLaunch =
    launches.find((launch) => isPrecise(launch) && new Date(launch.net) > now - 10 * 60 * 1000) ||
    launches.find((launch) => new Date(launch.net) > now) ||
    launches[0] ||
    null;
}

function launchDayMarkup(launch, state) {
  if (!state.active) return "";
  const video = safeUrl(launch.video_url);
  const status = launch.status || {};
  const meta = [windowText(launch)];
  if (launch.probability != null) meta.push(`${launch.probability}% weather go`);
  return `
    <div class="launchday" data-phase="${state.phase}">
      <div class="launchday__signal">
        <span class="launchday__pulse" aria-hidden="true"></span>
        ${esc(launchDayKicker(state))}
      </div>
      <div class="launchday__copy">
        <strong>${esc(launchDayHeadline(launch, state))}</strong>
        <span>${esc(meta.join(" · "))}</span>
        ${status.description ? `<small>${esc(status.description)}</small>` : ""}
      </div>
      <div class="launchday__actions">
        ${video ? `<a class="btn btn--sm ${state.live ? "btn--live" : "btn--primary"}" href="${esc(video)}" target="_blank" rel="noopener">${state.live ? "Watch live" : "Watch webcast"}</a>` : ""}
        <span class="launchday__updated" id="hero-launchday-updated">Updated just now</span>
      </div>
    </div>`;
}

function renderHero() {
  if (!nextLaunch) {
    if (heroSignature === "empty") return;
    heroSignature = "empty";
    heroContent.innerHTML = `<p class="hero__eyebrow">Next launch</p><h2 class="hero__title">No upcoming launches</h2>`;
    return;
  }
  const providers = new Set(launches.map((launch) => providerName(launch) || "Unknown"));
  const pad = nextLaunch.pad || {};
  const day = launchDayState(nextLaunch);
  const signature = [
    nextLaunch.id,
    nextLaunch.net,
    statusAbbrev(nextLaunch),
    nextLaunch.webcast_live ? 1 : 0,
    nextLaunch.probability,
    nextLaunch.video_url,
    nextLaunch.window_start,
    nextLaunch.window_end,
    nextLaunch.status && nextLaunch.status.description,
    day.active ? day.phase : "",
    missionName(nextLaunch),
    rocketName(nextLaunch),
    providerName(nextLaunch),
    pad.country_code,
    pad.location,
    launches.length,
    providers.size,
    tz,
  ].join("|");
  if (signature === heroSignature) return;
  heroSignature = signature;
  const liftoff = isPrecise(nextLaunch) ? `${whenText(nextLaunch)} ${tzLabel()}` : whenText(nextLaunch);
  const title = missionName(nextLaunch)
    .split(/\s+/)
    .map(
      (word, index) =>
        `<span class="word"><span style="animation-delay:${(0.06 + index * 0.07).toFixed(2)}s">${esc(word)}</span></span>`,
    )
    .join(" ");

  heroContent.innerHTML = `
    <p class="hero__eyebrow">${day.live ? "Live now" : day.active ? "Launch day" : "Next launch"}</p>
    <h2 class="hero__title">${title}</h2>
    <p class="hero__sub">${esc(rocketName(nextLaunch) || "Unknown rocket")} · ${esc(providerName(nextLaunch) || "Unknown provider")}</p>
    ${
      isPrecise(nextLaunch)
        ? `<div class="countdown" id="hero-countdown" aria-live="off">
      <div class="countdown__sign">T&minus;</div>
      <div class="countdown__unit"><strong data-unit="d">00</strong><span>Days</span></div>
      <span class="countdown__sep" aria-hidden="true">:</span>
      <div class="countdown__unit"><strong data-unit="h">00</strong><span>Hours</span></div>
      <span class="countdown__sep" aria-hidden="true">:</span>
      <div class="countdown__unit"><strong data-unit="m">00</strong><span>Minutes</span></div>
      <span class="countdown__sep" aria-hidden="true">:</span>
      <div class="countdown__unit"><strong data-unit="s">00</strong><span>Seconds</span></div>
    </div>`
        : `<p class="hero__net">NET ${esc(fuzzyDate(nextLaunch))}</p>`
    }
    <dl class="hero__meta" id="hero-meta">
      <div><dt>Status</dt><dd>${statusPill(nextLaunch)}</dd></div>
      <div><dt>Liftoff</dt><dd>${esc(liftoff)}</dd></div>
      <div><dt>Pad</dt><dd>${countryLabel(pad.country_code)}${esc(pad.location || pad.name || "Unknown")}</dd></div>
    </dl>
    ${launchDayMarkup(nextLaunch, day)}
    <div class="hero__actions">
      <button type="button" class="btn btn--primary" id="hero-details">
        Mission briefing
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>
      </button>
      <button type="button" class="btn" id="hero-calendar">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg>
        Add to calendar
      </button>
    </div>
    <div class="hero__stats">
      <div class="hero__stat"><b>${launches.length}</b><span>Tracked</span></div>
      <div class="hero__stat"><b>${providers.size}</b><span>Providers</span></div>
      <div class="hero__stat"><b>${isPrecise(nextLaunch) ? timeOnly(nextLaunch.net) : fuzzyDate(nextLaunch)}</b><span>Next lift-off</span></div>
    </div>`;

  const detailsButton = heroContent.querySelector("#hero-details");
  if (detailsButton) {
    detailsButton.addEventListener("click", () => {
      lastTrigger = detailsButton;
      openDetail(nextLaunch.id);
    });
  }

  const calendarButton = heroContent.querySelector("#hero-calendar");
  if (calendarButton) {
    calendarButton.addEventListener("click", () => downloadIcs(nextLaunch));
  }
}

function renderGlobe() {
  if (globe) globe.setLaunches(launches, nextLaunch);

  const within = (launch, ms) => {
    const time = new Date(launch.net).getTime();
    return time >= Date.now() - 10 * 60 * 1000 && time <= Date.now() + ms;
  };
  stat24h.textContent = launches.filter((launch) => within(launch, DAY)).length;
  statWeek.textContent = launches.filter((launch) => within(launch, 7 * DAY)).length;
  statGo.textContent = launches.filter((launch) => statusAbbrev(launch).toUpperCase() === "GO").length;
}

function wireInstall() {
  if (!installButton) return;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });
  installButton.addEventListener("click", async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    installButton.hidden = true;
    try {
      prompt.prompt();
      await prompt.userChoice;
    } catch {
      /* the browser can invalidate a stale install prompt */
    }
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installButton.hidden = true;
    showToast("Zero Hour installed");
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {
      /* offline support is optional */
    });
  });
}

function wireNav() {
  const links = [...document.querySelectorAll(".nav__links a")].filter((link) =>
    (link.getAttribute("href") || "").startsWith("#"),
  );
  if (!links.length) return;
  const sections = links
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);
  if (!sections.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const link of links) {
          link.classList.toggle(
            "is-active",
            link.getAttribute("href") === `#${entry.target.id}`,
          );
        }
      }
    },
    { rootMargin: "-45% 0px -50% 0px" },
  );
  sections.forEach((section) => observer.observe(section));
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
    if (!launch) continue;
    el.textContent = shortCountdown(launch, now);
    const diff = new Date(launch.net) - now;
    el.closest(".card")?.classList.toggle("is-imminent", isPrecise(launch) && diff > 0 && diff < HOUR);
  }

  if (detail.open && detail.dataset.id) {
    const launch = launches.find((l) => l.id === detail.dataset.id);
    const el = document.querySelector("#detail-count");
    if (launch && el) el.textContent = shortCountdown(launch, now);
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
  const updated = document.querySelector("#hero-launchday-updated");
  if (stale) {
    sync.textContent = "Showing cached data";
    if (updated) updated.textContent = "Cached data";
    return;
  }
  const mins = Math.max(0, Math.round((Date.now() - fetchedAt) / 60_000));
  sync.textContent = mins === 0 ? "Synced just now" : `Synced ${mins} min ago`;
  if (updated && lastLoadAt) {
    const localMins = Math.max(0, Math.round((Date.now() - lastLoadAt) / 60_000));
    updated.textContent = localMins === 0 ? "Updated just now" : `Updated ${localMins}m ago`;
  }
}

function matches(launch) {
  if (filters.saved && !isSaved(launch.id)) {
    return false;
  }

  if (filters.status !== "all" && statusAbbrev(launch) !== filters.status) {
    return false;
  }

  const provider = providerName(launch) || "Unknown provider";
  if (filters.provider && provider !== filters.provider) {
    return false;
  }

  if (filters.range !== "all") {
    const time = new Date(launch.net).getTime();
    const now = Date.now();
    if (time < now || time > now + RANGES[filters.range]) {
      return false;
    }
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
  const orbit = launch.mission && launch.mission.orbit_abbrev;
  const time = isPrecise(launch) ? `${timeOnly(launch.net)} ${tzLabel()}` : `NET ${fuzzyDate(launch)}`;
  const pad = launch.pad || {};
  const where = pad.location || pad.name || "";
  const on = isSaved(launch.id);

  return `
    <article class="card" data-id="${esc(launch.id)}">
      <div class="card__media${image ? "" : " card__media--empty"}">
        ${image ? `<img src="${esc(image)}" alt="" loading="lazy" decoding="async">` : ""}
        <div class="card__badges">
          ${statusPill(launch)}
          ${orbit ? `<span class="pill pill--orbit" title="${esc((launch.mission && launch.mission.orbit) || "")}">${esc(orbit)}</span>` : ""}
        </div>
      </div>
      <div class="card__body">
        <span class="card__provider">${esc(providerName(launch) || "Unknown provider")}</span>
        <h2 class="card__title">${esc(missionName(launch))}</h2>
        ${rocketName(launch) ? `<span class="card__rocket">${esc(rocketName(launch))}</span>` : ""}
        <div class="card__foot">
          <div class="card__where">
            <span class="card__time">${esc(time)}</span>
            <span class="card__pad">${countryLabel(pad.country_code)}${esc(where)}</span>
          </div>
          <span class="card__countdown" data-countdown="${esc(launch.id)}">${esc(shortCountdown(launch, Date.now()))}</span>
        </div>
      </div>
      <button type="button" class="card__open" data-open="${esc(launch.id)}">
        <span class="sr-only">Open mission briefing: ${esc(missionName(launch))}</span>
      </button>
      <button type="button" class="card__save${on ? " is-saved" : ""}" data-save="${esc(launch.id)}" aria-pressed="${on}" aria-label="${savedLabel(launch.id)}" title="${savedLabel(launch.id)}">
        ${bookmarkIcon()}
      </button>
    </article>`;
}

function groupFor(launch, todayKey, tomorrowKey, now) {
  if (!isPrecise(launch) && launch.net_precision !== "DAY") {
    const label = fuzzyDate(launch);
    return { key: `fuzzy:${label}`, rel: label, date: "Date to be confirmed", today: false };
  }
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
  const visible = filtered.slice(0, visibleCount);
  const todayKey = dayKey(new Date(now));
  const tomorrowKey = dayKey(new Date(now + DAY));

  const groups = [];
  const byKey = new Map();
  for (const launch of visible) {
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

  const remaining = filtered.length - visible.length;
  if (loadMoreWrap) loadMoreWrap.hidden = remaining <= 0;
  if (loadMore && remaining > 0) {
    loadMore.textContent = `Load ${Math.min(PAGE_SIZE, remaining)} more · ${visible.length} of ${filtered.length} shown`;
  }

  noResults.hidden = filtered.length > 0 || launches.length === 0;
  if (!noResults.hidden && noResultsText) {
    if (filters.saved && saved.size === 0) {
      noResultsText.textContent =
        "No saved launches yet. Tap the bookmark on any launch to keep it here.";
    } else if (filters.saved) {
      const narrowed =
        filters.status !== "all" || filters.q || filters.provider || filters.range !== "all";
      noResultsText.textContent = narrowed
        ? "No saved launches match those filters."
        : "Your saved launches are not in the current manifest anymore.";
    } else {
      noResultsText.textContent = "No launches match those filters.";
    }
    if (clearFilters) {
      clearFilters.textContent = filters.saved ? "Browse all launches" : "Clear filters";
    }
  }
  status.textContent = filters.saved
    ? `${filtered.length} saved launch${filtered.length === 1 ? "" : "es"}`
    : filtered.length === launches.length
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
  if (filters.provider) {
    const match = [...providerSelect.options].find(
      (option) => option.value.toLowerCase() === filters.provider.toLowerCase(),
    );
    if (match) {
      if (match.value !== filters.provider) {
        filters.provider = match.value;
        syncFiltersToUrl();
      }
      providerSelect.value = match.value;
    } else {
      filters.provider = "";
      providerSelect.value = "";
      syncFiltersToUrl();
    }
  } else {
    providerSelect.value = "";
  }
}

function mapEmbed(lat, lon) {
  const d = 0.06;
  const bbox = [lon - d * 2, lat - d, lon + d * 2, lat + d].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`;
}

function windowText(launch) {
  if (!launch.window_start || !launch.window_end || !isPrecise(launch)) return "Not yet published";
  return `${timeOnly(launch.window_start)} - ${timeOnly(launch.window_end)} ${tzLabel()}`;
}

function launchLink(launch) {
  return `${location.origin}/#launch/${encodeURIComponent(launch.id)}`;
}

function openDetail(id) {
  const launch = launches.find((l) => l.id === id);
  if (!launch) return;

  const image = safeUrl(launch.image_url || launch.thumbnail_url);
  const credit = launch.image_credit
    ? `<span class="detail__credit">Image: ${esc(launch.image_credit)}</span>`
    : "";
  detailMedia.innerHTML = image
    ? `<img src="${esc(image)}" alt="${esc(rocketName(launch) || "Launch")}">${credit}`
    : "";

  const pad = launch.pad || {};
  const code = countryCode(pad.country_code);
  const facts = [
    ["Liftoff", isPrecise(launch) ? `${whenText(launch)} ${tzLabel()}` : whenText(launch)],
    ["Window", windowText(launch)],
    ["Rocket", rocketName(launch) || "Unknown"],
    ["Provider", `${providerName(launch) || "Unknown"}${launch.provider && launch.provider.type ? ` · ${launch.provider.type}` : ""}`],
    ["Mission type", (launch.mission && launch.mission.type) || "Unknown"],
    ["Orbit", (launch.mission && launch.mission.orbit) || "Unknown"],
    ["Pad", pad.name || "Unknown"],
    ["Location", `${code ? `${code} · ` : ""}${pad.location || "Unknown"}`],
  ];
  if (launch.probability != null) facts.push(["Weather", `${launch.probability}% probability of go`]);

  const lat = Number(pad.latitude);
  const lon = Number(pad.longitude);
  const hasCoords = pad.latitude != null && pad.longitude != null && Number.isFinite(lat) && Number.isFinite(lon);
  const video = safeUrl(launch.video_url);
  const info = safeUrl(launch.info_url);
  const mapUrl = safeUrl(pad.map_url);

  detailBody.innerHTML = `
    <div class="detail__pills">
      ${statusPill(launch)}
      <span class="pill pill--muted">${esc((launch.status && launch.status.name) || "To Be Determined")}</span>
    </div>
    <h2 class="detail__title" id="detail-title">${esc(missionName(launch))}</h2>
    <p class="detail__sub">${esc(rocketName(launch) || "")} · ${esc(providerName(launch) || "")}</p>
    <div class="detail__count"><strong id="detail-count">--</strong><span>${esc((launch.status && launch.status.description) || "")}</span></div>
    <dl class="detail__grid">
      ${facts.map(([key, value]) => `<div><dt>${key}</dt><dd>${esc(value)}</dd></div>`).join("")}
    </dl>
    ${launch.mission && launch.mission.description ? `<h3>Mission</h3><p class="detail__desc">${esc(launch.mission.description)}</p>` : ""}
    ${hasCoords ? `<h3>Launch site</h3><div class="detail__map"><iframe title="Map of ${esc(pad.name || "launch site")}" loading="lazy" src="${mapEmbed(lat, lon)}"></iframe></div>` : ""}
    <div class="detail__actions">
      <a class="btn btn--primary" href="/launch.html?id=${encodeURIComponent(launch.id)}">Full briefing</a>
      ${video ? `<a class="btn ${launch.webcast_live ? "btn--live" : "btn--primary"}" href="${esc(video)}" target="_blank" rel="noopener">${launch.webcast_live ? "Watch live" : "Webcast"}</a>` : ""}
      <button type="button" class="btn" data-action="ics">Add to calendar</button>
      <button type="button" class="btn${isSaved(launch.id) ? " is-saved" : ""}" data-save="${esc(launch.id)}" aria-pressed="${isSaved(launch.id)}">${isSaved(launch.id) ? "Saved" : "Save launch"}</button>
      <button type="button" class="btn" data-action="share">Copy link</button>
      ${mapUrl ? `<a class="btn" href="${esc(mapUrl)}" target="_blank" rel="noopener">Open in Maps</a>` : ""}
      ${info ? `<a class="btn" href="${esc(info)}" target="_blank" rel="noopener">Mission info</a>` : ""}
    </div>`;

  const icsButton = detailBody.querySelector('[data-action="ics"]');
  if (icsButton) icsButton.addEventListener("click", () => downloadIcs(launch));
  const saveButton = detailBody.querySelector("[data-save]");
  if (saveButton) saveButton.addEventListener("click", () => toggleSaved(launch.id));
  const shareButton = detailBody.querySelector('[data-action="share"]');
  if (shareButton) shareButton.addEventListener("click", () => shareLink(launch));

  detail.dataset.id = id;
  if (!detail.open) {
    detail.showModal();
    document.body.classList.add("is-locked");
  }
  if (location.hash !== `#launch/${encodeURIComponent(id)}`) {
    history.replaceState(
      null,
      "",
      `${location.pathname}${location.search}#launch/${encodeURIComponent(id)}`,
    );
  }
  detail.querySelector(".detail__panel").scrollTop = 0;
  tick();
}

function closeDetail() {
  if (!detail.open || detail.classList.contains("is-closing")) return;
  detail.classList.add("is-closing");
  setTimeout(() => {
    detail.classList.remove("is-closing");
    detail.close();
  }, 220);
}

async function openDetailById(id) {
  let launch = launches.find((l) => l.id === id);
  if (!launch && launches.length) {
    try {
      const response = await fetch(`/api/launches/${encodeURIComponent(id)}`);
      if (response.ok) {
        launch = await response.json();
        launches.push(launch);
        launches.sort((a, b) => new Date(a.net) - new Date(b.net));
        renderProviders();
        renderLaunches();
      }
    } catch {
      /* shared link points at a launch we cannot load */
    }
  }
  if (launch) openDetail(launch.id);
}

function openFromHash() {
  const match = location.hash.match(/^#launch\/(.+)$/);
  if (match && launches.length) {
    const id = decodeURIComponent(match[1]);
    if (detail.open && detail.dataset.id === id) return;
    if (launches.some((launch) => launch.id === id)) openDetail(id);
    else openDetailById(id);
  }
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(message);
  } catch {
    window.prompt("Copy this link", text);
  }
}

function shareLink(launch) {
  copyText(launchLink(launch), "Link copied");
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
  const link = launchLink(launch);
  const where = [launch.pad && launch.pad.name, launch.pad && launch.pad.location].filter(Boolean).join(", ");
  const description = `${providerName(launch) || ""} · ${statusAbbrev(launch)}\n\n${(launch.mission && launch.mission.description) || ""}\n\n${link}`;

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
    `LOCATION:${icsEscape(where)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `URL:${link}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([body], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const filename = String(launch.slug || "launch").replace(/[^\w.-]+/g, "-");
  anchor.download = `${filename}.ics`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(isPrecise(launch) ? "Calendar event downloaded" : "Heads up: this launch date is not final yet");
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
  if (detail.open && detail.dataset.id) {
    const panel = detail.querySelector(".detail__panel");
    const scrollTop = panel ? panel.scrollTop : 0;
    openDetail(detail.dataset.id);
    if (panel) panel.scrollTop = scrollTop;
  }
}

function wire() {
  let searchTimer;

  document.addEventListener(
    "error",
    (event) => {
      if (event.target instanceof HTMLImageElement) event.target.remove();
    },
    true,
  );

  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const tag = document.activeElement && document.activeElement.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    if (event.key === "/" && !typing) {
      event.preventDefault();
      search.focus();
      return;
    }
    if (event.key.toLowerCase() === "s" && !typing && savedToggle) {
      event.preventDefault();
      savedToggle.click();
    }
  });

  search.addEventListener("input", (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filters.q = event.target.value.trim();
      visibleCount = PAGE_SIZE;
      syncFiltersToUrl();
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
    visibleCount = PAGE_SIZE;
    syncFiltersToUrl();
    renderLaunches();
  });

  providerSelect.addEventListener("change", (event) => {
    filters.provider = event.target.value;
    visibleCount = PAGE_SIZE;
    syncFiltersToUrl();
    renderLaunches();
  });

  if (rangeSelect) {
    rangeSelect.addEventListener("change", (event) => {
      filters.range = isRange(event.target.value) ? event.target.value : "all";
      visibleCount = PAGE_SIZE;
      syncFiltersToUrl();
      renderLaunches();
    });
  }

  if (savedToggle) {
    savedToggle.addEventListener("click", () => {
      filters.saved = !filters.saved;
      visibleCount = PAGE_SIZE;
      syncFiltersToUrl();
      renderSavedUI();
      renderLaunches();
    });
  }

  if (loadMore) {
    loadMore.addEventListener("click", () => {
      visibleCount += PAGE_SIZE;
      renderLaunches();
    });
  }

  if (clearFilters) {
    clearFilters.addEventListener("click", () => {
      filters.q = "";
      filters.status = "all";
      filters.provider = "";
      filters.saved = false;
      filters.range = "all";
      visibleCount = PAGE_SIZE;
      search.value = "";
      providerSelect.value = "";
      if (rangeSelect) rangeSelect.value = "all";
      setStatusChip();
      syncFiltersToUrl();
      renderSavedUI();
      renderLaunches();
    });
  }

  for (const button of document.querySelectorAll("[data-tz]")) {
    button.addEventListener("click", () => setTz(button.dataset.tz));
  }

  if (retryButton) retryButton.addEventListener("click", loadLaunches);

  list.addEventListener("click", (event) => {
    const saveButton = event.target.closest("[data-save]");
    if (saveButton) {
      event.stopPropagation();
      toggleSaved(saveButton.dataset.save);
      return;
    }

    const openButton = event.target.closest("[data-open]");
    if (!openButton) return;
    lastTrigger = openButton;
    openDetail(openButton.dataset.open);
  });

  list.addEventListener(
    "pointermove",
    (event) => {
      const card = event.target.closest(".card");
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      card.style.setProperty("--my", `${event.clientY - rect.top}px`);
    },
    { passive: true },
  );

  document.querySelector("#detail-close").addEventListener("click", closeDetail);
  detail.addEventListener("click", (event) => {
    if (event.target === detail) closeDetail();
  });
  detail.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDetail();
  });
  detail.addEventListener("close", () => {
    document.body.classList.remove("is-locked");
    delete detail.dataset.id;
    if (location.hash.startsWith("#launch/")) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    if (lastTrigger && lastTrigger.isConnected !== false) lastTrigger.focus();
    lastTrigger = null;
  });
  window.addEventListener("hashchange", openFromHash);

  wireNavScroll();
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
    lastLoadAt = Date.now();
    if (errorPanel) errorPanel.hidden = true;

    pickNextLaunch();
    renderHero();
    renderProviders();
    renderLaunches();
    renderGlobe();
    renderSync();
    openFromHash();
  } catch (error) {
    list.setAttribute("aria-busy", "false");
    status.textContent = "Feed unreachable";
    if (errorPanel) errorPanel.hidden = false;
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
hydrateFilters();
wire();
wireNav();
wireInstall();
registerServiceWorker();
initFinder();
renderSavedUI();
setTz(tz);
loadLaunches();
setInterval(tick, 1000);
setInterval(renderSync, 30_000);
setInterval(loadLaunches, REFRESH_MS);
setInterval(() => {
  if (document.hidden || !nextLaunch) return;
  if (launchDayRefreshDue(nextLaunch)) loadLaunches();
}, LAUNCH_DAY_REFRESH_MS);
