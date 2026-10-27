import { initFinder } from "./finder.js";
import {
  countdownParts,
  esc,
  fuzzyDate,
  isPrecise,
  missionName,
  pad,
  providerName,
  readSaved,
  registerServiceWorker,
  safeUrl,
  statusAbbrev,
  statusPill,
  timeOnly,
  toggleSaved,
  tzLabel,
  whenText,
  windowText,
  wireTzButtons,
} from "./shared.js";

const $ = (selector) => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const launchId = (params.get("id") || "").trim().slice(0, 80);

const state = {
  launch: null,
  launches: [],
  saved: readSaved(),
  reminder: "",
};

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-on");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("is-on"), 3200);
}

function backTarget() {
  try {
    const referrer = new URL(document.referrer);
    if (referrer.origin === location.origin && !referrer.pathname.startsWith("/launch.html")) {
      return { href: `${referrer.pathname}${referrer.search}${referrer.hash}`, label: "Back" };
    }
  } catch {
    /* direct visits have no usable referrer */
  }
  return { href: "/#manifest", label: "Back to manifest" };
}

function pagerMarkup(launch) {
  const ordered = [...state.launches].sort(
    (a, b) => Date.parse(a.net) - Date.parse(b.net) || a.id.localeCompare(b.id),
  );
  const index = ordered.findIndex((item) => item.id === launch.id);
  if (index < 0 || ordered.length < 2) return "";

  const prev = ordered[index - 1];
  const next = ordered[index + 1];
  const link = (item, direction) => `
    <a class="briefing__pager-link briefing__pager-link--${direction}" href="/launch.html?id=${encodeURIComponent(
      item.id,
    )}" rel="${direction === "prev" ? "prev" : "next"}" data-pager="${direction}">
      <span class="briefing__pager-label">${direction === "prev" ? "← Previous launch" : "Next launch →"}</span>
      <strong>${esc(missionName(item))}</strong>
      <small>${esc(whenText(item))}</small>
    </a>`;

  return `
    <nav class="briefing__pager" aria-label="Launch briefing navigation">
      ${prev ? link(prev, "prev") : '<span class="briefing__pager-spacer" aria-hidden="true"></span>'}
      <span class="briefing__pager-count">
        ${index + 1}<span>/</span>${ordered.length}
        <small aria-hidden="true">Use ← →</small>
      </span>
      ${next ? link(next, "next") : '<span class="briefing__pager-spacer" aria-hidden="true"></span>'}
    </nav>`;
}

function showError(title, message) {
  $("#briefing-loading").hidden = true;
  $("#briefing-content").hidden = true;
  $("#briefing-error").hidden = false;
  $("#briefing-error-title").textContent = title;
  $("#briefing-error-text").textContent = message;
  document.title = "Launch unavailable - Zero Hour";
}

function fact(label, value) {
  if (value == null || value === "") return "";
  return `<div class="fact"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
}

function countdownMarkup(launch) {
  if (!isPrecise(launch)) {
    return `<div class="briefing__date"><span>NET</span><strong>${esc(fuzzyDate(launch))}</strong></div>`;
  }
  const cd = countdownParts(new Date(launch.net) - Date.now());
  return `
    <div class="briefing__countdown" id="briefing-countdown">
      <div><strong data-cd="d">${pad(cd.d)}</strong><span>days</span></div>
      <div><strong data-cd="h">${pad(cd.h)}</strong><span>hours</span></div>
      <div><strong data-cd="m">${pad(cd.m)}</strong><span>minutes</span></div>
      <div><strong data-cd="s">${pad(cd.s)}</strong><span>seconds</span></div>
    </div>
    <p class="briefing__countdown-label" id="countdown-label">${cd.past ? "since T-0" : "until T-0"}</p>`;
}

function mediaMarkup(launch) {
  const image = safeUrl(launch.image_url || launch.thumbnail_url);
  const credit = launch.image_credit
    ? `<figcaption>Image: ${esc(launch.image_credit)}</figcaption>`
    : "";
  if (!image) {
    return `<figure class="briefing__media briefing__media--empty"><div aria-hidden="true">ZH</div>${credit}</figure>`;
  }
  return `<figure class="briefing__media"><img src="${esc(image)}" alt="${esc(
    launch.rocket || "Launch vehicle",
  )}" referrerpolicy="no-referrer">${credit}</figure>`;
}

function mapMarkup(launch) {
  const padInfo = launch.pad || {};
  const latitude =
    padInfo.latitude == null || padInfo.latitude === "" ? NaN : Number(padInfo.latitude);
  const longitude =
    padInfo.longitude == null || padInfo.longitude === "" ? NaN : Number(padInfo.longitude);
  const fallback =
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? `https://www.google.com/maps?q=${latitude},${longitude}`
      : null;
  const map = safeUrl(padInfo.map_url) || safeUrl(fallback);
  if (!map) return "";
  return `<a class="briefing__map" href="${esc(map)}" target="_blank" rel="noopener">
    <span class="briefing__map-pin" aria-hidden="true"></span>
    <span><strong>Open launch site map</strong><small>${esc(padInfo.location || "View coordinates")}</small></span>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"></path></svg>
  </a>`;
}

function linksMarkup(launch) {
  const links = [];
  const video = safeUrl(launch.video_url);
  const info = safeUrl(launch.info_url);
  const wiki = safeUrl(launch.pad && launch.pad.wiki_url);
  if (video) links.push(`<a class="btn btn--sm" href="${esc(video)}" target="_blank" rel="noopener">Watch webcast</a>`);
  if (info) links.push(`<a class="btn btn--sm" href="${esc(info)}" target="_blank" rel="noopener">Mission info</a>`);
  if (wiki) links.push(`<a class="btn btn--sm" href="${esc(wiki)}" target="_blank" rel="noopener">Pad wiki</a>`);
  links.push(`<a class="btn btn--sm" href="/?provider=${encodeURIComponent(providerName(launch))}#manifest">More from ${esc(providerName(launch))}</a>`);
  return links.join("");
}

function render() {
  const launch = state.launch;
  if (!launch) return;
  const mission = launch.mission || {};
  const padInfo = launch.pad || {};
  const provider = launch.provider || {};
  const status = launch.status || {};
  const description = (mission.description || "").trim();
  const descriptionHtml = description
    ? description
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${esc(paragraph).replace(/\n/g, "<br>")}</p>`)
        .join("")
    : `<p>No mission description has been published yet.</p>`;
  const icsBase = `/api/launches/${encodeURIComponent(launch.id)}/calendar.ics`;
  const ics = state.reminder ? `${icsBase}?remind=${encodeURIComponent(state.reminder)}` : icsBase;
  const icsName = `zero-hour-${(launch.slug || "launch").replace(/[^a-z0-9-]+/gi, "-")}.ics`;
  const saved = state.saved.has(launch.id);
  const back = backTarget();

  $("#briefing-loading").hidden = true;
  $("#briefing-error").hidden = true;
  $("#briefing-content").hidden = false;

  $("#briefing-content").innerHTML = `
    <article class="briefing__article">
      <a class="briefing__back" href="${esc(back.href)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"></path></svg>
        ${esc(back.label)}
      </a>

      <header class="briefing__hero">
        <div class="briefing__copy">
          <div class="briefing__kicker">
            ${statusPill(launch)}
            <span>${esc(provider.name || "Unknown provider")}${provider.type ? ` · ${esc(provider.type)}` : ""}</span>
          </div>
          <p class="eyebrow">Mission briefing</p>
          <h1>${esc(missionName(launch))}</h1>
          <p class="briefing__vehicle">${esc(launch.rocket || "Launch vehicle")}</p>
          <p class="briefing__when">${esc(whenText(launch))} <span>${esc(tzLabel())}</span></p>
          ${countdownMarkup(launch)}
          <div class="briefing__actions">
            <button type="button" class="btn${saved ? " is-saved" : ""}" id="briefing-save" aria-pressed="${saved}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v16l-6-4-6 4Z"></path></svg>
              ${saved ? "Saved" : "Save launch"}
            </button>
            <a class="btn" id="briefing-ics" href="${ics}" download="${esc(icsName)}">Add to calendar</a>
            ${
              isPrecise(launch)
                ? `<label class="briefing__reminder" title="Choose when your calendar app should remind you">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"></path></svg>
                    <span class="sr-only">Calendar reminder</span>
                    <select id="briefing-reminder">
                      <option value="">No reminder</option>
                      <option value="15"${state.reminder === "15" ? " selected" : ""}>15 min before</option>
                      <option value="60"${state.reminder === "60" ? " selected" : ""}>1 hour before</option>
                      <option value="1440"${state.reminder === "1440" ? " selected" : ""}>1 day before</option>
                    </select>
                  </label>`
                : ""
            }
            <button type="button" class="btn" id="briefing-share">Share</button>
          </div>
          <p class="briefing__hint">Saved launches stay in this browser and appear on mission control.</p>
        </div>
        ${mediaMarkup(launch)}
      </header>

      <dl class="briefing__facts" aria-label="Launch facts">
        ${fact("Vehicle", launch.rocket)}
        ${fact("Provider", provider.name)}
        ${fact("Mission type", mission.type)}
        ${fact("Orbit", mission.orbit || mission.orbit_abbrev)}
        ${fact("Launch window", windowText(launch))}
        ${fact("Probability", launch.probability != null ? `${launch.probability}%` : "Not published")}
      </dl>

      <div class="briefing__layout">
        <div class="briefing__main">
          <section class="panel briefing__section" aria-labelledby="mission-title">
            <header class="panel__head">
              <div>
                <h2 id="mission-title">The mission</h2>
                <p>${esc(mission.name || missionName(launch))}</p>
              </div>
            </header>
            <div class="briefing__prose">${descriptionHtml}</div>
          </section>

          <section class="panel briefing__section" aria-labelledby="site-title">
            <header class="panel__head">
              <div>
                <h2 id="site-title">Launch site</h2>
                <p>${esc(padInfo.location || "Location to be confirmed")}</p>
              </div>
            </header>
            <div class="briefing__site">
              <div>
                <strong>${esc(padInfo.name || "Launch pad not published")}</strong>
                <span>${esc([padInfo.location, padInfo.country_code].filter(Boolean).join(" · "))}</span>
              </div>
              ${mapMarkup(launch)}
            </div>
          </section>

          <section class="panel briefing__section" aria-labelledby="flight-title">
            <header class="panel__head">
              <div>
                <h2 id="flight-title">Flight data</h2>
                <p>Reference values for this launch.</p>
              </div>
            </header>
            <dl class="facts-grid">
              ${fact("NET", whenText(launch))}
              ${fact("Window opens", launch.window_start ? timeOnly(launch.window_start) : null)}
              ${fact("Window closes", launch.window_end ? timeOnly(launch.window_end) : null)}
              ${fact("Precision", launch.net_precision || "SEC")}
              ${fact("Status", status.name || statusAbbrev(launch))}
              ${fact("Status note", status.description)}
            </dl>
          </section>
        </div>

        <aside class="briefing__side">
          <section class="panel" aria-labelledby="briefing-links-title">
            <header class="panel__head">
              <div>
                <h2 id="briefing-links-title">Links</h2>
                <p>Go deeper on this flight.</p>
              </div>
            </header>
            <div class="briefing__links">${linksMarkup(launch)}</div>
          </section>

          <section class="panel" aria-labelledby="share-title">
            <header class="panel__head">
              <div>
                <h2 id="share-title">Briefing link</h2>
                <p>Share a permanent launch page.</p>
              </div>
            </header>
            <div class="briefing__shortlink">
              <code>launch.html?id=${esc(launch.id)}</code>
              <button type="button" class="btn btn--sm" id="briefing-share-again">Copy link</button>
            </div>
          </section>
        </aside>
      </div>
      ${pagerMarkup(launch)}
    </article>`;

  document.title = `${missionName(launch)} - Zero Hour`;
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = `Launch briefing for ${missionName(launch)} by ${providerName(launch)}.`;

  $("#briefing-save").addEventListener("click", saveLaunch);
  $("#briefing-share").addEventListener("click", shareLaunch);
  $("#briefing-share-again").addEventListener("click", shareLaunch);
  wireReminder(launch);
}

function wireReminder(launch) {
  const select = $("#briefing-reminder");
  const link = $("#briefing-ics");
  if (!select || !link) return;
  select.addEventListener("change", () => {
    state.reminder = select.value;
    const base = `/api/launches/${encodeURIComponent(launch.id)}/calendar.ics`;
    link.href = state.reminder ? `${base}?remind=${encodeURIComponent(state.reminder)}` : base;
  });
}

function saveLaunch() {
  if (!state.launch) return;
  const on = toggleSaved(state.launch.id);
  state.saved = readSaved();
  paintSave();
  showToast(on ? "Saved to watchlist" : "Removed from watchlist");
}

function paintSave() {
  const button = $("#briefing-save");
  if (!button || !state.launch) return;
  const saved = state.saved.has(state.launch.id);
  button.classList.toggle("is-saved", saved);
  button.setAttribute("aria-pressed", String(saved));
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v16l-6-4-6 4Z"></path></svg>${
    saved ? "Saved" : "Save launch"
  }`;
}

async function shareLaunch() {
  if (!state.launch) return;
  const url = `${location.origin}/launch.html?id=${encodeURIComponent(state.launch.id)}`;
  const title = `${missionName(state.launch)} - Zero Hour`;
  try {
    if (navigator.share) {
      await navigator.share({ title, text: "Launch briefing from Zero Hour", url });
      return;
    }
    await navigator.clipboard.writeText(url);
    showToast("Briefing link copied");
  } catch (error) {
    if (error && error.name === "AbortError") return;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Briefing link copied");
    } catch {
      window.prompt("Copy this briefing link", url);
    }
  }
}

function tickCountdown() {
  if (!state.launch || !isPrecise(state.launch)) return;
  const root = $("#briefing-countdown");
  if (!root) return;
  const cd = countdownParts(new Date(state.launch.net) - Date.now());
  for (const key of ["d", "h", "m", "s"]) {
    const element = root.querySelector(`[data-cd="${key}"]`);
    if (element) element.textContent = pad(cd[key]);
  }
  const label = $("#countdown-label");
  if (label) label.textContent = cd.past ? "since T-0" : "until T-0";
}

async function loadLaunch() {
  $("#briefing-error").hidden = true;
  if (!launchId) {
    showError("No launch selected.", "Choose a launch from the manifest to open its briefing.");
    return;
  }
  try {
    const [response, list] = await Promise.all([
      fetch(`/api/launches/${encodeURIComponent(launchId)}`, {
        headers: { Accept: "application/json" },
      }),
      fetch("/api/launches?limit=100", { headers: { Accept: "application/json" } })
        .then((result) => (result.ok ? result.json() : null))
        .catch(() => null),
    ]);
    if (response.status === 404) {
      showError("Launch not found.", "This launch is not in the current manifest.");
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.launch = await response.json();
    state.launches = list && Array.isArray(list.results) ? list.results : [];
    render();
  } catch {
    showError("Could not load this launch.", "Check your connection or try again in a moment.");
  }
}

$("#briefing-retry").addEventListener("click", () => {
  $("#briefing-error").hidden = true;
  $("#briefing-loading").hidden = false;
  loadLaunch();
});

window.addEventListener("storage", (event) => {
  if (event.key !== "zh-saved") return;
  state.saved = readSaved();
  paintSave();
});

window.addEventListener("zh:tzchange", () => {
  if (state.launch) render();
});

window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return;
  }
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  if (event.target.closest("input, select, textarea, button, a, [contenteditable]")) return;
  const direction = event.key === "ArrowLeft" ? "prev" : "next";
  const link = document.querySelector(`[data-pager="${direction}"]`);
  if (!link) return;
  event.preventDefault();
  location.href = link.href;
});

wireTzButtons();
initFinder();
loadLaunch();
setInterval(tickCountdown, 1000);
registerServiceWorker();
import("/starfield.js").catch(() => {});
