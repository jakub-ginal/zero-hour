import { initFinder } from "./finder.js";

const providerSelect = document.querySelector("#feed-provider");
const statusSelect = document.querySelector("#feed-status");
const windowSelect = document.querySelector("#feed-window");
const field = document.querySelector("#feed-url");
const note = document.querySelector("#feed-note");
const summary = document.querySelector("#feed-summary");
const download = document.querySelector("#feed-download");
const params = new URLSearchParams(location.search);
const statuses = ["Go", "TBC", "TBD"];
const requestedStatus = (params.get("status") || "").toLowerCase();
const requestedDays = params.get("days") || "";
const validDays = /^\d+$/.test(requestedDays) && +requestedDays >= 1 && +requestedDays <= 365;
const state = {
  provider: (params.get("provider") || "").trim().slice(0, 80),
  status: statuses.find((value) => value.toLowerCase() === requestedStatus) || "",
  days: validDays ? requestedDays : "",
};
let launches = [];
const READY = new Set(["SEC", "MIN", "HR", "DAY"]);

function addOption(select, value, label) {
  if (!value || [...select.options].some((option) => option.value === value)) return;
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function selectValue(select, value, label = value) {
  addOption(select, value, label);
  select.value = value;
}

function daysLabel(days) {
  if (!days) return "";
  if (days === "1") return "Next 24 hours";
  return `Next ${days} days`;
}

function scopeParams() {
  const query = new URLSearchParams();
  if (state.provider) query.set("provider", state.provider);
  if (state.status) query.set("status", state.status);
  if (state.days) query.set("days", state.days);
  return query;
}

function feedUrl() {
  const query = scopeParams().toString();
  return `${location.origin}/api/calendar${query ? `?${query}` : ""}`;
}

function downloadUrl() {
  const query = scopeParams();
  query.set("download", "1");
  return `${location.origin}/api/calendar?${query}`;
}

function ready(launch) {
  const precision = launch.net_precision;
  return !precision || READY.has(precision);
}

function matches(launch) {
  if (!ready(launch)) return false;
  if (state.status && launch.status.abbrev.toLowerCase() !== state.status.toLowerCase()) {
    return false;
  }
  if (state.provider) {
    const needle = state.provider.toLowerCase();
    const provider = launch.provider || {};
    if (
      !String(provider.name || "").toLowerCase().includes(needle) &&
      String(provider.abbrev || "").toLowerCase() !== needle
    ) {
      return false;
    }
  }
  if (state.days) {
    const time = new Date(launch.net).getTime();
    const now = Date.now();
    if (time < now || time > now + Number(state.days) * 86_400_000) return false;
  }
  return true;
}

function updateSummary() {
  if (!launches.length) {
    summary.textContent = "Filters apply to your subscription and download.";
    return;
  }
  const count = launches.filter(matches).length;
  summary.textContent = count
    ? `${count} confirmed launch${count === 1 ? "" : "es"} match this feed.`
    : "No confirmed launches match these filters yet.";
}

function update() {
  const url = feedUrl();
  field.textContent = url;
  download.href = downloadUrl();
  note.textContent = "Paste it into your calendar app, not the browser address bar.";
  const query = scopeParams().toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}`);
  updateSummary();
}

function renderProviders() {
  const counts = new Map();
  for (const launch of launches) {
    const name = (launch.provider && launch.provider.name) || "Unknown provider";
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  if (state.provider) {
    const canonical = [...counts.keys()].find(
      (name) => name.toLowerCase() === state.provider.toLowerCase(),
    );
    if (canonical) state.provider = canonical;
  }
  providerSelect.innerHTML =
    `<option value="">All providers</option>` +
    [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(
        ([name, count]) =>
          `<option value="${escapeHtml(name)}">${escapeHtml(name)} (${count})</option>`,
      )
      .join("");
  selectValue(providerSelect, state.provider);
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

selectValue(providerSelect, state.provider);
selectValue(statusSelect, state.status);
selectValue(windowSelect, state.days, daysLabel(state.days));
update();

providerSelect.addEventListener("change", () => {
  state.provider = providerSelect.value;
  update();
});
statusSelect.addEventListener("change", () => {
  state.status = statusSelect.value;
  update();
});
windowSelect.addEventListener("change", () => {
  state.days = windowSelect.value;
  update();
});
document.querySelector("#feed-reset").addEventListener("click", () => {
  state.provider = "";
  state.status = "";
  state.days = "";
  providerSelect.value = "";
  statusSelect.value = "";
  windowSelect.value = "";
  update();
});
document.querySelector("#copy-feed").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(feedUrl());
    note.textContent = "Copied. Paste it into your calendar app's subscription field.";
  } catch {
    window.prompt("Copy this URL", feedUrl());
  }
});

fetch("/api/launches?limit=100")
  .then((response) => (response.ok ? response.json() : null))
  .then((data) => {
    launches = (data && data.results) || [];
    renderProviders();
    update();
  })
  .catch(() => {
    /* providers are optional */
  });

import("./starfield.js")
  .then(({ startStarfield }) => startStarfield(document.querySelector("#starfield")))
  .catch(() => {
    /* decorative only */
  });

initFinder();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {
      /* offline support is optional */
    });
  });
}
