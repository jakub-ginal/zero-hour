const API = "https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=24&mode=normal";

const list = document.querySelector("#launches");
const status = document.querySelector("#status");

const STATUS_CLASS = { GO: "go", TBC: "tbc", TBD: "tbd", HOLD: "hold" };

function statusClass(abbrev) {
  return STATUS_CLASS[(abbrev || "").toUpperCase()] || "tbd";
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

function card(launch) {
  const image = launch.image && (launch.image.thumbnail_url || launch.image.image_url);
  const provider = launch.launch_service_provider && launch.launch_service_provider.name;
  const rocket = launch.rocket && launch.rocket.configuration && launch.rocket.configuration.name;
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
        <span class="card__provider">${provider || "Unknown provider"}</span>
        <h2 class="card__title">${launch.name}</h2>
        ${rocket ? `<span class="card__rocket">${rocket}</span>` : ""}
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
    const launches = (data.results || []).sort((a, b) => new Date(a.net) - new Date(b.net));

    list.innerHTML = launches.map(card).join("");
    status.textContent = launches.length + " upcoming launches";
  } catch (error) {
    status.textContent = "Could not load launches. Try again later.";
    console.error(error);
  }
}

loadLaunches();
