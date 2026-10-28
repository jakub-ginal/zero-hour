const STORAGE_KEY = "zh-theme";

const THEMES = [
  {
    id: "ice",
    label: "Ice",
    bg: "#05060b",
    swatch: ["#8ecdf5", "#d9ecfb", "#5b8fc9"],
  },
  {
    id: "graphite",
    label: "Graphite",
    bg: "#080807",
    swatch: ["#e8e4da", "#f7f3e9", "#57534a"],
  },
  {
    id: "aurora",
    label: "Aurora",
    bg: "#040b0c",
    swatch: ["#7de3d4", "#c9fff4", "#4f8fda"],
  },
  {
    id: "sand",
    label: "Sand",
    bg: "#0b0906",
    swatch: ["#d8c49a", "#f2e6c9", "#8a6f3f"],
  },
];

const root = document.documentElement;
const meta = document.querySelector('meta[name="theme-color"]');
const navRight = document.querySelector(".nav__right");

let button = null;
let menu = null;
let options = [];

function normalize(id) {
  return THEMES.some((theme) => theme.id === id) ? id : "ice";
}

function apply(id, persist = true) {
  const theme = THEMES.find((item) => item.id === normalize(id)) || THEMES[0];
  root.dataset.theme = theme.id;
  if (meta) meta.content = theme.bg;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, theme.id);
    } catch {
      // Storage can be unavailable in private browsing.
    }
  }
  if (button) button.setAttribute("aria-label", `Change theme, current: ${theme.label}`);
  for (const option of options) {
    const active = option.dataset.themeOption === theme.id;
    option.setAttribute("aria-checked", String(active));
  }
  window.dispatchEvent(new CustomEvent("zh-themechange", { detail: { theme: theme.id } }));
}

function setOpen(open) {
  if (!button || !menu) return;
  menu.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
  if (open) {
    const active = menu.querySelector('[aria-checked="true"]') || menu.querySelector(".theme__option");
    active?.focus();
  }
}

if (navRight) {
  const wrap = document.createElement("div");
  wrap.className = "theme";
  wrap.innerHTML = `
    <button type="button" class="theme__button" aria-label="Change theme" aria-haspopup="true" aria-expanded="false" aria-controls="theme-menu">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3a9 9 0 1 0 0 18h1.2a2.4 2.4 0 0 0 0-4.8H12a2.1 2.1 0 0 1 0-4.2h5.2A4.8 4.8 0 0 0 22 7.2 4.8 4.8 0 0 0 17.2 3Z"/>
        <circle cx="7.4" cy="10.2" r=".9"/>
        <circle cx="10" cy="6.9" r=".9"/>
        <circle cx="14.1" cy="6.9" r=".9"/>
      </svg>
    </button>
    <div class="theme__menu" id="theme-menu" role="radiogroup" aria-label="Color theme" hidden>
      <p class="theme__title">Theme</p>
      ${THEMES.map(
        (theme) => `
        <button type="button" class="theme__option" role="radio" data-theme-option="${theme.id}" aria-checked="false">
          <span class="theme__swatch" style="--sw-a:${theme.swatch[0]};--sw-b:${theme.swatch[1]};--sw-c:${theme.swatch[2]}"></span>
          <span>${theme.label}</span>
          <span class="theme__check" aria-hidden="true"></span>
        </button>`,
      ).join("")}
    </div>`;
  navRight.append(wrap);

  button = wrap.querySelector(".theme__button");
  menu = wrap.querySelector(".theme__menu");
  options = [...wrap.querySelectorAll(".theme__option")];

  button.addEventListener("click", () => setOpen(menu.hidden));

  menu.addEventListener("click", (event) => {
    const option = event.target.closest("[data-theme-option]");
    if (!option) return;
    apply(option.dataset.themeOption);
    setOpen(false);
    button.focus();
  });

  menu.addEventListener("keydown", (event) => {
    const index = options.indexOf(document.activeElement);
    if (index < 0) return;
    let next = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % options.length;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + options.length) % options.length;
    if (next === null) return;
    event.preventDefault();
    options[next].focus();
  });

  document.addEventListener("click", (event) => {
    if (!wrap.contains(event.target)) setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      setOpen(false);
      button.focus();
    }
  });
}

apply(root.dataset.theme || "ice", false);
