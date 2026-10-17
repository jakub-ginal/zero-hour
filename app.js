const API = "https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=20&mode=normal";

const list = document.querySelector("#launches");
const status = document.querySelector("#status");

async function loadLaunches() {
  try {
    const response = await fetch(API);
    if (!response.ok) {
      throw new Error("Request failed with status " + response.status);
    }
    const data = await response.json();
    const launches = (data.results || []).sort((a, b) => new Date(a.net) - new Date(b.net));

    for (const launch of launches) {
      const item = document.createElement("li");
      item.textContent = launch.name + " - " + new Date(launch.net).toLocaleString();
      list.append(item);
    }

    status.textContent = launches.length + " launches";
  } catch (error) {
    status.textContent = "Could not load launches. Try again later.";
    console.error(error);
  }
}

loadLaunches();
