const API = "https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=24&mode=normal";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const list = document.querySelector("#launches");
const status = document.querySelector("#status");
const hero = document.querySelector("#hero");

let launches = [];
let nextLaunch = null;

const STATUS_CLASS = { GO: "go", TBC: "tbc", TBD: "tbd", HOLD: "hold" };

function statusClass(abbrev) {
  return STATUS_CLASS[(abbrev || "").toUpperCase()] || "tbd";
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(value) {
  return new Date(value).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function missionName(launch) {
  const parts = launch.name.split(" | ");
  return parts.length > 1 ? parts.slice(1).join(" | ") : launch.name;
}

function rocketName(launch) {
  return launch.rocket && launch.rocket.configuration && launch.rocket.configuration.name;
}

function providerName(launch) {
  return launch.launch_service_provider && launch.launch_service_provider.name;
}

function pickNextLaunch() {
  const now = Date.now();
  nextLaunch = launches.find((l) => new Date(l.net) > now - 10 * 60 * 1000) || launches[0] || null;
}

function renderHero() {
  if (!nextLaunch) {
    hero.innerHTML = `<p class="hero__eyebrow">Next launch</p><h2 class="hero__title">No upcoming launches</h2>`;
    return;
  }
  hero.innerHTML = `
    <p class="hero__eyebrow">Next launch</p>
    <h2 class="hero__title">${missionName(nextLaunch)}</h2>
    <p class="hero__sub">${rocketName(nextLaunch) || "Unknown rocket"} - ${providerName(nextLaunch) || "Unknown provider"}</p>
    <div class="countdown" id="hero-countdown">
      <div class="countdown__unit"><strong data-unit="d">00</strong><span>Days</span></div>
      <div class="countdown__unit"><strong data-unit="h">00</strong><span>Hours</span></div>
      <div class="countdown__unit"><strong data-unit="m">00</strong><span>Minutes</span></div>
      <div class="countdown__unit"><strong data-unit="s">00</strong><span>Seconds</span></div>
    </div>`;
}

function tick() {
  if (!nextLaunch) return;
  const box = document.querySelector("#hero-countdown");
  if (!box) return;
  const cd = countdownParts(new Date(nextLaunch.net) - Date.now());
  box.querySelector('[data-unit="d"]').textContent = String(cd.d);
  box.querySelector('[data-unit="h"]').textContent = pad(cd.h);
  box.querySelector('[data-unit="m"]').textContent = pad(cd.m);
  box.querySelector('[data-unit="s"]').textContent = pad(cd.s);
  box.classList.toggle("is-past", cd.past);
}

function card(launch) {
  const image = launch.image && (launch.image.thumbnail_url || launch.image.image_url);
  const pad = launch.pad && (launch.pad.name || (launch.pad.location && launch.pad.location.name));
  const abbrev = (launch.status && launch.status.abbrev) || "TBD";
  const statusName = (launch.status && launch.status.name) || "To Be Determined";

  return `
    <article class="card">
      <div class="card__media">
        ${image ? `<img src="${image}" alt="" loading="lazy">` : ""}
        <span class="pill pill--${statusClass(abbrev)}" title="${statusName}">${abbrev}</span>
      </div>
      <div class="card__body">
        <span class="card__provider">${providerName(launch) || "Unknown provider"}</span>
        <h2 class="card__title">${missionName(launch)}</h2>
        ${rocketName(launch) ? `<span class="card__rocket">${rocketName(launch)}</span>` : ""}
        <div class="card__foot">
          <span class="card__time">${formatDate(launch.net)}</span>
          <span class="card__pad">${pad || ""}</span>
        </div>
      </div>
    </article>`;
}

async function loadLaunches() {
  try {
    const response = await fetch(API);
    if (!response.ok) {
      throw new Error("Request failed with status " + response.status);
    }
    const data = await response.json();
    launches = (data.results || []).sort((a, b) => new Date(a.net) - new Date(b.net));

    pickNextLaunch();
    renderHero();
    tick();
    list.innerHTML = launches.map(card).join("");
    status.textContent = launches.length + " upcoming launches";
  } catch (error) {
    status.textContent = "Could not load launches. Try again later.";
    console.error(error);
  }
}

loadLaunches();
setInterval(tick, 1000);
