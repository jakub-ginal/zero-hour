import { initFinder } from "./finder.js";
import {
  DAY,
  dateOnly,
  dayKey,
  esc,
  fmt,
  getTz,
  isPrecise,
  isReady,
  missionName,
  parseWatchlist,
  providerName,
  readSaved,
  registerServiceWorker,
  shortCountdown,
  statusAbbrev,
  statusClass,
  statusPill,
  timeOnly,
  watchlistExport,
  wireNavScroll,
  wireTzButtons,
  writeSaved,
} from "./shared.js";

const $ = (selector) => document.querySelector(selector);

const SHARED_PARAM = "watchlist";
const SHARED_LIMIT = 100;

const state = {
  launches: [],
  saved: readSaved(),
  shared: readSharedParam(),
  view: nowMonth(),
};

function readSharedParam() {
  const raw = new URLSearchParams(location.search).get(SHARED_PARAM) || "";
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id && id.length <= 200)
      .slice(0, SHARED_LIMIT),
  );
}

function nowMonth() {
  const now = new Date();
  if (getTz() === "utc") return { year: now.getUTCFullYear(), month: now.getUTCMonth() };
  return { year: now.getFullYear(), month: now.getMonth() };
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-on");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("is-on"), 3200);
}

function renderStats() {
  const now = Date.now();
  const ready = state.launches.filter((launch) => {
    const time = Date.parse(launch.net);
    return isReady(launch) && Number.isFinite(time) && time >= now;
  });
  const week = ready.filter((launch) => Date.parse(launch.net) <= now + 7 * DAY);
  const go = state.launches.filter((launch) => statusAbbrev(launch).toUpperCase() === "GO");
  const providers = new Set(state.launches.map((launch) => providerName(launch)));

  $("#stat-tracked").textContent = state.launches.length;
  $("#stat-week").textContent = week.length;
  $("#stat-go").textContent = go.length;
  $("#stat-providers").textContent = providers.size;
}

function renderCadence() {
  const now = Date.now();
  const weeks = Array.from({ length: 8 }, (_, index) => ({
    index,
    count: 0,
    start: new Date(now + index * 7 * DAY),
  }));

  for (const launch of state.launches) {
    const time = Date.parse(launch.net);
    if (!isReady(launch) || !Number.isFinite(time) || time < now) continue;
    const index = Math.floor((time - now) / (7 * DAY));
    if (index >= 0 && index < weeks.length) weeks[index].count += 1;
  }

  const max = Math.max(1, ...weeks.map((week) => week.count));
  $("#cadence-total").textContent = `${weeks.reduce((sum, week) => sum + week.count, 0)} dated`;
  $("#cadence").innerHTML = weeks
    .map((week) => {
      const height = week.count ? Math.max(9, Math.round((week.count / max) * 100)) : 2;
      const label = week.index === 0 ? "0-7d" : `${week.index * 7}-${week.index * 7 + 7}d`;
      return `
        <div class="cadence__col" title="${week.count} in ${label} from ${esc(dateOnly(week.start))}">
          <span class="cadence__count">${week.count}</span>
          <div class="cadence__track"><span style="height:${height}%"></span></div>
          <span class="cadence__label">${label}</span>
          <span class="cadence__date">${esc(dateOnly(week.start))}</span>
        </div>`;
    })
    .join("");
}

function renderProviders() {
  const counts = new Map();
  for (const launch of state.launches) {
    const name = providerName(launch);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 7);
  const max = top.length ? top[0][1] : 1;
  $("#providers").innerHTML = top.length
    ? top
        .map(
          ([name, count]) => `
          <a class="rank" href="/?provider=${encodeURIComponent(name)}#manifest">
            <span class="rank__name">${esc(name)}</span>
            <span class="rank__track"><span style="width:${Math.max(6, (count / max) * 100)}%"></span></span>
            <span class="rank__count">${count}</span>
          </a>`,
        )
        .join("")
    : `<p class="empty">No providers in the manifest yet.</p>`;
}

function renderStatus() {
  const total = state.launches.length;
  const definitions = [
    { key: "GO", label: "Go", className: "go", color: "var(--go)" },
    { key: "TBC", label: "To be confirmed", className: "tbc", color: "var(--tbc)" },
    { key: "TBD", label: "To be determined", className: "tbd", color: "var(--text-3)" },
  ];
  const known = new Set(definitions.map((definition) => definition.key));
  const counts = new Map(definitions.map((definition) => [definition.key, 0]));
  let other = 0;
  for (const launch of state.launches) {
    const key = statusAbbrev(launch).toUpperCase();
    if (known.has(key)) counts.set(key, counts.get(key) + 1);
    else other += 1;
  }

  const segments = definitions.map((definition) => ({
    ...definition,
    count: counts.get(definition.key),
    percent: total ? (counts.get(definition.key) / total) * 100 : 0,
  }));
  if (other) {
    segments.push({
      key: "OTHER",
      label: "Other",
      className: "hold",
      color: "var(--hold)",
      count: other,
      percent: (other / total) * 100,
    });
  }

  let cursor = 0;
  const stops = [];
  for (const segment of segments) {
    if (!segment.percent) continue;
    const next = Math.min(100, cursor + segment.percent);
    stops.push(`${segment.color} ${cursor}% ${next}%`);
    cursor = next;
  }
  const gradient = stops.length ? `conic-gradient(${stops.join(", ")})` : "conic-gradient(var(--line) 0 100%)";

  $("#status-mix").innerHTML = `
    <div class="donut" style="background:${gradient}" role="img" aria-label="${esc(
      segments.map((segment) => `${segment.label}: ${segment.count}`).join(", "),
    )}">
      <div class="donut__center"><strong>${total}</strong><span>launches</span></div>
    </div>
    <div class="legend">
      ${segments
        .map((segment) => {
          const content = `<span class="legend__dot legend__dot--${segment.className}"></span>
            <span class="legend__label">${esc(segment.label)}</span>
            <span class="legend__count">${segment.count}</span>`;
          return segment.key === "OTHER"
            ? `<div class="legend__row">${content}</div>`
            : `<a class="legend__row" href="/?status=${encodeURIComponent(
                segment.key[0] + segment.key.slice(1).toLowerCase(),
              )}#manifest">${content}</a>`;
        })
        .join("")}
    </div>`;
}

function renderNext() {
  const now = Date.now();
  const next = state.launches
    .filter((launch) => isReady(launch) && Date.parse(launch.net) >= now - 10 * 60 * 1000)
    .sort((a, b) => Date.parse(a.net) - Date.parse(b.net))
    .slice(0, 4);

  $("#next-up").innerHTML = next.length
    ? next
        .map(
          (launch) => `
          <a class="next-card" href="/launch.html?id=${encodeURIComponent(launch.id)}">
            <span class="next-card__top">
              <span class="next-card__when">${esc(whenTextLocal(launch))}</span>
              <span class="next-card__count" data-countdown-id="${esc(launch.id)}">${esc(shortCountdown(launch))}</span>
            </span>
            <span class="next-card__name">${esc(missionName(launch))}</span>
            <span class="next-card__meta">${statusPill(launch)} <span>${esc(providerName(launch))}</span></span>
          </a>`,
        )
        .join("")
    : `<p class="empty">No dated launches ahead.</p>`;
}

function whenTextLocal(launch) {
  if (isPrecise(launch)) {
    return fmt(launch.net, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return `NET ${dateOnly(launch.net)}`;
}

function tickCountdowns() {
  for (const element of document.querySelectorAll("[data-countdown-id]")) {
    const launch = state.launches.find((item) => item.id === element.dataset.countdownId);
    if (launch) element.textContent = shortCountdown(launch);
  }
}

function renderWatchlist() {
  const savedLaunches = [...state.saved]
    .map((id) => state.launches.find((launch) => launch.id === id))
    .filter(Boolean);
  const missing = state.saved.size - savedLaunches.length;
  $("#watchlist-count").textContent = state.saved.size;
  $("#watchlist-export").disabled = state.saved.size === 0;
  $("#watchlist-share").disabled = state.saved.size === 0;

  $("#watchlist").innerHTML = savedLaunches.length
    ? savedLaunches
        .map(
          (launch) => `
          <div class="watchlist__item">
            <a href="/launch.html?id=${encodeURIComponent(launch.id)}">
              <span class="watchlist__name">${esc(missionName(launch))}</span>
              <span class="watchlist__meta">${esc(whenTextLocal(launch))} · ${esc(providerName(launch))}</span>
            </a>
            <button type="button" class="icon-btn icon-btn--small" data-remove="${esc(
              launch.id,
            )}" aria-label="Remove ${esc(missionName(launch))} from watchlist">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>
            </button>
          </div>`,
        )
        .join("")
    : `<p class="empty">Nothing saved yet. Open a launch and choose Save.</p>`;

  if (missing > 0) {
    $("#watchlist").insertAdjacentHTML(
      "beforeend",
      `<p class="watchlist__note">${missing} saved launch${missing === 1 ? " is" : "es are"} not in the current manifest.</p>`,
    );
  }
  renderSharedWatchlist();
  renderWatchlistCalendar();
}

function watchlistCalendarHref() {
  const params = new URLSearchParams({ ids: [...state.saved].join(",") });
  const remind = $("#watchlist-reminder").value;
  if (remind) params.set("remind", remind);
  return `/api/watchlist.ics?${params.toString()}`;
}

function renderWatchlistCalendar() {
  const link = $("#watchlist-calendar");
  if (!state.saved.size) {
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
    return;
  }
  link.href = watchlistCalendarHref();
  link.setAttribute("aria-disabled", "false");
}

function sharedSummary() {
  const found = new Map();
  for (const launch of state.launches) {
    if (state.shared.has(launch.id)) found.set(launch.id, launch);
  }
  const ready = [...found.values()].sort(
    (a, b) => Date.parse(a.net) - Date.parse(b.net) || missionName(a).localeCompare(missionName(b)),
  );
  return { ready, missing: state.shared.size - ready.length };
}

function renderSharedWatchlist() {
  const section = $("#shared-watchlist");
  if (!state.shared.size) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const { ready, missing } = sharedSummary();
  const newCount = ready.filter((launch) => !state.saved.has(launch.id)).length;
  const missingNote = missing
    ? ` ${missing} launch${missing === 1 ? " is" : "es are"} no longer in the current manifest.`
    : "";
  $("#shared-watchlist-title").textContent = `${ready.length} shared launch${ready.length === 1 ? "" : "es"}`;
  $("#shared-watchlist-note").textContent = ready.length
    ? `Review this shared set, then import it into your local watchlist.${missingNote}`
    : `None of these launches are in the current manifest.${missingNote}`;

  const button = $("#shared-watchlist-import");
  if (!ready.length) {
    button.disabled = true;
    button.textContent = "Nothing to import";
  } else if (!newCount) {
    button.disabled = true;
    button.textContent = "Already in watchlist";
  } else {
    button.disabled = false;
    button.textContent = `Add ${newCount} launch${newCount === 1 ? "" : "es"}`;
  }

  $("#shared-watchlist-items").innerHTML = ready.length
    ? ready
        .slice(0, 6)
        .map(
          (launch) => `
          <a class="shared-watchlist__item" href="/launch.html?id=${encodeURIComponent(launch.id)}">
            <span class="shared-watchlist__name">${esc(missionName(launch))}</span>
            <span class="shared-watchlist__meta">${esc(whenTextLocal(launch))} · ${esc(providerName(launch))}</span>
          </a>`,
        )
        .join("") +
      (ready.length > 6 ? `<p class="shared-watchlist__more">+${ready.length - 6} more</p>` : "")
    : '<p class="empty">Those launch IDs were not found.</p>';
}

function watchlistShareUrl() {
  const url = new URL("/mission-control.html", location.origin);
  url.searchParams.set(SHARED_PARAM, [...state.saved].slice(0, SHARED_LIMIT).join(","));
  return url.href;
}

function clearSharedParam() {
  const url = new URL(location.href);
  if (!url.searchParams.has(SHARED_PARAM)) return;
  url.searchParams.delete(SHARED_PARAM);
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function dismissSharedWatchlist(message) {
  state.shared.clear();
  clearSharedParam();
  renderSharedWatchlist();
  if (message) $("#watchlist-status").textContent = message;
}

async function shareWatchlist() {
  if (!state.saved.size) return;
  const url = watchlistShareUrl();
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
      throw new Error("Clipboard unavailable");
    }
    await navigator.clipboard.writeText(url);
    const count = Math.min(state.saved.size, SHARED_LIMIT);
    $("#watchlist-status").textContent = `Share link copied · ${count} launch${count === 1 ? "" : "es"}.`;
    showToast("Share link copied");
  } catch {
    window.prompt("Copy this watchlist link:", url);
  }
}

function importSharedWatchlist() {
  const { ready } = sharedSummary();
  let added = 0;
  for (const launch of ready) {
    if (state.saved.has(launch.id)) continue;
    state.saved.add(launch.id);
    added += 1;
  }
  if (!added) {
    showToast("Already in your watchlist");
    return;
  }
  writeSaved(state.saved);
  dismissSharedWatchlist(`Added ${added} shared launch${added === 1 ? "" : "es"} to your watchlist.`);
  renderWatchlist();
  showToast(`Added ${added} to watchlist`);
}

function renderCalendar() {
  const label = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(state.view.year, state.view.month, 1)));
  $("#month-label").textContent = label;

  const weekdays = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, 0, 1 + index)),
    ),
  );
  $("#cal-weekdays").innerHTML = weekdays
    .map((day) => `<span>${esc(day)}</span>`)
    .join("");

  const firstWeekday = new Date(Date.UTC(state.view.year, state.view.month, 1)).getUTCDay();
  const offset = (firstWeekday + 6) % 7;
  const daysInMonth = new Date(Date.UTC(state.view.year, state.view.month + 1, 0)).getUTCDate();
  const todayKey = dayKey(new Date());

  const groups = new Map();
  for (const launch of state.launches) {
    if (!isReady(launch)) continue;
    const key = dayKey(launch.net);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(launch);
  }
  for (const launches of groups.values()) {
    launches.sort((a, b) => Date.parse(a.net) - Date.parse(b.net));
  }

  const cells = [];
  for (let index = 0; index < offset; index += 1) {
    cells.push(`<div class="cal-day cal-day--blank" aria-hidden="true"></div>`);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${state.view.year}-${String(state.view.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const events = groups.get(key) || [];
    const shown = events.slice(0, 3);
    const more = events.length - shown.length;
    const today = key === todayKey;
    const eventHtml = shown
      .map((launch) => {
        const time = isPrecise(launch) ? timeOnly(launch.net) : "TBD";
        return `<a class="cal-event cal-event--${statusClass(statusAbbrev(launch))}" href="/launch.html?id=${encodeURIComponent(
          launch.id,
        )}" title="${esc(`${missionName(launch)} · ${time} · ${statusAbbrev(launch)}`)}">
          <span class="cal-event__dot"></span>
          <span class="cal-event__label">${esc(missionName(launch))}</span>
          <span class="cal-event__time">${esc(time)}</span>
        </a>`;
      })
      .join("");
    cells.push(`
      <div class="cal-day${today ? " is-today" : ""}${events.length ? " has-events" : ""}" role="gridcell" aria-label="${esc(
        `${label} ${day}, ${events.length} launch${events.length === 1 ? "" : "es"}`,
      )}">
        <span class="cal-day__num">${day}</span>
        <div class="cal-day__events">
          ${eventHtml}
          ${more > 0 ? `<span class="cal-more">+${more}</span>` : ""}
        </div>
      </div>`);
  }
  const rows = Math.ceil((offset + daysInMonth) / 7);
  while (cells.length < rows * 7) {
    cells.push(`<div class="cal-day cal-day--blank" aria-hidden="true"></div>`);
  }
  $("#month-grid").innerHTML = cells.join("");
}

function renderAll() {
  renderStats();
  renderCadence();
  renderProviders();
  renderStatus();
  renderNext();
  renderWatchlist();
  renderCalendar();
}

function moveMonth(amount) {
  const date = new Date(Date.UTC(state.view.year, state.view.month + amount, 1));
  state.view = { year: date.getUTCFullYear(), month: date.getUTCMonth() };
  renderCalendar();
}

function downloadWatchlist() {
  if (!state.saved.size) {
    showToast("Watchlist is empty");
    return;
  }
  const blob = new Blob([watchlistExport(state.saved)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "zero-hour-watchlist.json";
  link.click();
  URL.revokeObjectURL(url);
  showToast("Watchlist exported");
}

async function importWatchlist(file) {
  if (file.size > 100_000) {
    showToast("That file is too large");
    return;
  }
  try {
    const imported = parseWatchlist(await file.text());
    let added = 0;
    for (const id of imported) {
      if (!state.saved.has(id)) {
        state.saved.add(id);
        added += 1;
      }
    }
    writeSaved(state.saved);
    renderWatchlist();
    $("#watchlist-status").textContent = `Imported ${imported.size} saved launch${imported.size === 1 ? "" : "es"}${added ? ` · ${added} new` : ""}.`;
  } catch {
    $("#watchlist-status").textContent = "Could not import that watchlist.";
    showToast("Invalid watchlist file");
  }
}

async function loadManifest() {
  $("#control-error").hidden = true;
  try {
    const response = await fetch("/api/launches?limit=100", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.launches = Array.isArray(data.results) ? data.results : [];
    renderAll();
  } catch {
    $("#control-error").hidden = false;
    showToast("Could not load the manifest");
  }
}

function wireControls() {
  $("#month-prev").addEventListener("click", () => moveMonth(-1));
  $("#month-next").addEventListener("click", () => moveMonth(1));
  $("#month-today").addEventListener("click", () => {
    state.view = nowMonth();
    renderCalendar();
  });
  $("#control-retry").addEventListener("click", loadManifest);
  $("#watchlist-export").addEventListener("click", downloadWatchlist);
  $("#watchlist-share").addEventListener("click", shareWatchlist);
  $("#watchlist-reminder").addEventListener("change", renderWatchlistCalendar);
  $("#shared-watchlist-import").addEventListener("click", importSharedWatchlist);
  $("#shared-watchlist-dismiss").addEventListener("click", () =>
    dismissSharedWatchlist("Shared watchlist dismissed."),
  );
  $("#watchlist-import-button").addEventListener("click", () => $("#watchlist-import").click());
  $("#watchlist-import").addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (file) importWatchlist(file);
  });
  $("#watchlist-clear").addEventListener("click", () => {
    if (!state.saved.size) return;
    if (!window.confirm("Clear every saved launch from this watchlist?")) return;
    state.saved = new Set();
    writeSaved(state.saved);
    renderWatchlist();
    $("#watchlist-status").textContent = "Watchlist cleared.";
    showToast("Watchlist cleared");
  });
  $("#watchlist").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    state.saved.delete(button.dataset.remove);
    writeSaved(state.saved);
    renderWatchlist();
    showToast("Removed from watchlist");
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== "zh-saved") return;
    state.saved = readSaved();
    renderWatchlist();
  });
  window.addEventListener("zh:tzchange", () => {
    state.view = nowMonth();
    renderAll();
  });
}

wireNavScroll();
wireTzButtons();
wireControls();
initFinder();
loadManifest();
setInterval(tickCountdowns, 1000);
registerServiceWorker();
import("/starfield.js").catch(() => {});
