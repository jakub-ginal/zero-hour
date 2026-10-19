const API = "https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=24&mode=normal";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const list = document.querySelector("#launches");
const status = document.querySelector("#status");
const hero = document.querySelector("#hero");
const search = document.querySelector("#search");
const statusChips = document.querySelector("#status-chips");
const providerSelect = document.querySelector("#provider");
const noResults = document.querySelector("#no-results");

let launches = [];
let nextLaunch = null;
const filters = { q: "", status: "all", provider: "" };

const STATUS_CLASS = { GO: "go", TBC: "tbc", TBD: "tbd", HOLD: "hold" };

function statusClass(abbrev) {
  return STATUS_CLASS[(abbrev || "").toUpperCase()] || "tbd";
}

function statusAbbrev(launch) {
  return (launch.status && launch.status.abbrev) || "TBD";
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
  return launch.rocket && launch.rocket.configuration && launch.rocket.configuration.name;
}

function providerName(launch) {
  return launch.launch_service_provider && launch.launch_service_provider.name;
}

function padName(launch) {
  return launch.pad && (launch.pad.name || (launch.pad.location && launch.pad.location.name));
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
  const now = Date.now();

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
    launch.mission && launch.mission.orbit && launch.mission.orbit.name,
    launch.pad && launch.pad.name,
    launch.pad && launch.pad.location && launch.pad.location.name,
  ]
    .join(" ")
    .toLowerCase();

  return filters.q
    .toLowerCase()
    .split(/\s+/)
    .every((term) => haystack.includes(term));
}

function card(launch) {
  const image = launch.image && (launch.image.thumbnail_url || launch.image.image_url);
  const abbrev = statusAbbrev(launch);
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
          <div class="card__where">
            <span class="card__time">${formatDate(launch.net)}</span>
            <span class="card__pad">${padName(launch) || ""}</span>
          </div>
          <span class="card__countdown" data-countdown="${launch.id}"></span>
        </div>
      </div>
    </article>`;
}

function renderLaunches() {
  const filtered = launches.filter(matches);
  list.innerHTML = filtered.map(card).join("");
  noResults.hidden = filtered.length > 0 || launches.length === 0;
  status.textContent =
    filtered.length === launches.length
      ? `${launches.length} upcoming launches`
      : `${filtered.length} of ${launches.length} launches`;
  tick();
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
      .map(([name, count]) => `<option value="${name}">${name} (${count})</option>`)
      .join("");
  providerSelect.value = filters.provider;
}

function wire() {
  let searchTimer;
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
    renderProviders();
    renderLaunches();
  } catch (error) {
    status.textContent = "Could not load launches. Try again later.";
    console.error(error);
  }
}

wire();
loadLaunches();
setInterval(tick, 1000);
