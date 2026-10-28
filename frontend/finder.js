import { esc, missionName, providerName, statusPill, whenText } from "./shared.js";

const API = "/api/launches?limit=100";
const MAX_RESULTS = 40;
const SEARCH_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg>';

function searchText(launch) {
  return [
    launch.name,
    missionName(launch),
    providerName(launch),
    launch.rocket,
    launch.pad && launch.pad.name,
    launch.pad && launch.pad.location,
    launch.mission && launch.mission.type,
    launch.mission && launch.mission.orbit,
    launch.status && launch.status.name,
    launch.status && launch.status.abbrev,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function initFinder() {
  if (document.querySelector("#launch-finder")) return;

  const nav = document.querySelector(".nav__inner");
  let trigger = null;
  if (nav) {
    trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "icon-btn finder-trigger";
    trigger.setAttribute("aria-label", "Search launches (Ctrl K)");
    trigger.title = "Search launches (Ctrl K)";
    trigger.innerHTML = SEARCH_ICON;
    const right = nav.querySelector(".nav__right");
    if (right) right.prepend(trigger);
    else nav.append(trigger);
  }

  const dialog = document.createElement("dialog");
  dialog.className = "finder";
  dialog.id = "launch-finder";
  dialog.setAttribute("aria-labelledby", "finder-title");
  dialog.innerHTML = `
    <div class="finder__panel">
      <header class="finder__head">
        <div>
          <p class="eyebrow">Launch finder</p>
          <h2 id="finder-title">Jump to a launch</h2>
        </div>
        <button type="button" class="icon-btn" id="finder-close" aria-label="Close launch finder">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>
        </button>
      </header>
      <label class="finder__search">
        <span class="sr-only">Search launches</span>
        ${SEARCH_ICON}
        <input
          type="search"
          id="finder-input"
          placeholder="Search missions, providers, vehicles, pads…"
          autocomplete="off"
          spellcheck="false"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="finder-results"
        >
        <kbd>Ctrl K</kbd>
      </label>
      <p class="finder__hint">Use ↑ ↓ to move, Enter to open, Esc to close.</p>
      <div class="finder__results" id="finder-results" role="listbox" aria-label="Launch results"></div>
    </div>`;
  document.body.append(dialog);

  const input = dialog.querySelector("#finder-input");
  const results = dialog.querySelector("#finder-results");
  const closeButton = dialog.querySelector("#finder-close");
  const state = {
    items: [],
    matches: [],
    active: -1,
    loaded: false,
    pending: null,
    lastTrigger: null,
  };

  function setActive(index, scroll = true) {
    if (!state.matches.length) {
      state.active = -1;
      input.removeAttribute("aria-activedescendant");
      return;
    }
    const next = (index + state.matches.length) % state.matches.length;
    state.active = next;
    for (const option of results.querySelectorAll(".finder__result")) {
      const on = Number(option.dataset.index) === next;
      option.classList.toggle("is-active", on);
      option.setAttribute("aria-selected", String(on));
    }
    const active = results.querySelector(`[data-index="${next}"]`);
    if (!active) return;
    input.setAttribute("aria-activedescendant", active.id);
    if (scroll) active.scrollIntoView({ block: "nearest" });
  }

  function resultMarkup(launch, index) {
    return `
      <a
        class="finder__result"
        id="finder-option-${index}"
        role="option"
        aria-selected="false"
        data-index="${index}"
        href="/launch.html?id=${encodeURIComponent(launch.id)}"
      >
        <span class="finder__when">${esc(whenText(launch))}</span>
        <span class="finder__copy">
          <strong>${esc(missionName(launch))}</strong>
          <small>${esc(providerName(launch))} · ${esc(launch.rocket || "Vehicle TBD")}</small>
        </span>
        <span class="finder__status">${statusPill(launch)}</span>
      </a>`;
  }

  function render() {
    if (!state.loaded) {
      results.innerHTML = '<p class="finder__empty">Loading the manifest…</p>';
      return;
    }
    const query = input.value.trim().toLowerCase();
    const matches = query
      ? state.items.filter((item) => item.text.includes(query))
      : state.items.slice(0, 8);
    state.matches = matches.slice(0, MAX_RESULTS).map((item) => item.launch);
    if (!state.matches.length) {
      results.innerHTML = `<p class="finder__empty">No launches match “${esc(input.value.trim())}”.</p>`;
      state.active = -1;
      input.removeAttribute("aria-activedescendant");
      return;
    }
    results.innerHTML = state.matches.map(resultMarkup).join("");
    setActive(0, false);
  }

  function load() {
    if (state.loaded) return Promise.resolve();
    if (state.pending) return state.pending;
    state.pending = fetch(API, { headers: { Accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        const launches = Array.isArray(data.results) ? data.results : [];
        state.items = launches.map((launch) => ({ launch, text: searchText(launch) }));
        state.loaded = true;
        if (dialog.open) render();
      })
      .catch(() => {
        if (dialog.open) {
          results.innerHTML =
            '<p class="finder__empty">Could not load launches. Check your connection and try again.</p>';
        }
      })
      .finally(() => {
        state.pending = null;
      });
    return state.pending;
  }

  function open() {
    if (dialog.open || document.querySelector("dialog[open]")) return;
    state.lastTrigger = document.activeElement;
    dialog.showModal();
    document.body.classList.add("is-locked");
    input.value = "";
    input.removeAttribute("aria-activedescendant");
    if (state.loaded) render();
    else {
      results.innerHTML = '<p class="finder__empty">Loading the manifest…</p>';
      load();
    }
    requestAnimationFrame(() => input.focus());
  }

  function go(launch) {
    if (!launch) return;
    dialog.close();
    location.href = `/launch.html?id=${encodeURIComponent(launch.id)}`;
  }

  if (trigger) trigger.addEventListener("click", open);
  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    document.body.classList.remove("is-locked");
    const target = state.lastTrigger;
    state.lastTrigger = null;
    if (target && target.isConnected && typeof target.focus === "function") target.focus();
    else if (trigger) trigger.focus();
  });

  input.addEventListener("input", render);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dialog.close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(state.active + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(state.active - 1);
      return;
    }
    if (event.key === "Enter") {
      const launch = state.matches[state.active];
      if (!launch) return;
      event.preventDefault();
      go(launch);
    }
  });

  results.addEventListener("mouseover", (event) => {
    const option = event.target.closest(".finder__result");
    if (!option) return;
    setActive(Number(option.dataset.index), false);
  });

  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      open();
      return;
    }
    if (
      event.key === "/" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !document.querySelector("dialog[open]")
    ) {
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]")) {
        return;
      }
      event.preventDefault();
      open();
    }
  });

  window.addEventListener("zh:tzchange", () => {
    if (dialog.open) render();
  });
}
