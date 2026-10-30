# Zero Hour

A live manifest of upcoming orbital launches - countdowns, mission briefings, a launch globe, saved watchlists, and calendar feeds.

**Live site:** [zerohour.ginal.dev](https://zerohour.ginal.dev/)

<img width="800" height="600" alt="main_page" src="https://github.com/user-attachments/assets/3463e4ac-181d-4110-a430-0cdd33f3d624" />


<details>
<summary><b>Home manifest</b> - countdowns, filters, and launch cards</summary>

The home page shows the next launch, live countdown, and a filterable manifest of upcoming missions. Filter by provider, status, date range, or saved launches. Search by mission, rocket, provider, or pad.

<img width="800" height="600" alt="main_page" src="https://github.com/user-attachments/assets/dd039c3a-9849-4784-aea2-11cd1ab33416" />

<img width="800" height="600" alt="main_page_launches" src="https://github.com/user-attachments/assets/db0da3bb-eccb-4ad6-bef0-549b006a8344" />


</details>

<details>
<summary><b>Mission control</b> - the whole launch schedule at a glance</summary>

A compact dashboard for launch cadence, provider share, status mix, the next dated lift-offs, and the month ahead. Navigate months and switch timezone without leaving the page.

<img width="800" height="600" alt="mission_control" src="https://github.com/user-attachments/assets/bee9a04f-434b-42f1-8b7d-bad55d73c450" />

</details>

<details>
<summary><b>Launch briefings</b> - the full mission file</summary>

Every launch has a permanent briefing page with a live countdown, mission details, rocket and pad information, webcast links, maps, and calendar download. Move between launches with the previous/next controls or arrow keys.

<img width="800" height="600" alt="mission_briefing" src="https://github.com/user-attachments/assets/3ac45991-7646-4752-9f4c-29cfa2a680ed" />

</details>

<details>
<summary><b>Launch day mode</b> - live within 24 hours</summary>

Within 24 hours of lift-off, the home hero and briefing switch into launch-day mode: live webcast, countdown, hold states, and automatic refresh near T-0.

<img width="800" height="600" alt="launch_day" src="https://github.com/user-attachments/assets/fa1e0622-c3d5-474a-b49d-2267056fa1af" />

</details>

<details>
<summary><b>Launch globe</b> - drag, rotate, and explore pads</summary>

An interactive globe highlights the next launch trajectory and launch pads. Drag to rotate, use the arrow keys, or click a pad to open its briefing.

<img width="800" height="600" alt="globe" src="https://github.com/user-attachments/assets/68c1452e-21fc-4bd1-bf51-3499d3122b42" />

</details>

<details>
<summary><b>Launch finder</b> - Ctrl K or /</summary>

Search missions, providers, vehicles, pads, locations, and statuses from any page. Results work offline from the cached manifest.

<img width="800" height="600" alt="finder" src="https://github.com/user-attachments/assets/12dba063-c30c-42bc-ad48-d04133434e7c" />

</details>

<details>
<summary><b>Calendar feeds</b> - subscribe or download</summary>

Subscribe to confirmed launches in your calendar app or download a single launch, filtered feed, or the full watchlist.

<img width="800" height="600" alt="calendar" src="https://github.com/user-attachments/assets/79af6451-0a0c-4e1b-baa9-0e0f427b97dc" />

</details>

<details>
<summary><b>Watchlist</b> - save, export, and share</summary>

Saved launches stay in browser storage under `zh-saved`. Mission control can export the watchlist as JSON and merge an exported list back in on another browser. Share links encode the watchlist in `?watchlist=...` and show a preview before importing anything.

<img width="800" height="600" alt="watchlist" src="https://github.com/user-attachments/assets/09e5cc85-b964-4a22-b063-24c2656a6d95" />

</details>

<details>
<summary><b>Installable PWA</b> - offline shell and cached launches</summary>

Zero Hour is an installable PWA. The app shell, manifest, and recent launch data are cached so pages and the finder keep working offline. Install support is available in Chromium browsers.

</details>

<details>
<summary><b>Themes</b> - Ice, Graphite, Aurora, and Sand</summary>

Switch between four themes from the navigation. The selected theme is saved locally and applied before the page renders.

<img width="800" height="600" alt="themes_list" src="https://github.com/user-attachments/assets/335e2b33-fbd2-4e9f-91c6-f9b824ac75eb" />

Ice:

<img width="800" height="600" alt="themes_ice" src="https://github.com/user-attachments/assets/5345b9ba-07d5-4ba5-a119-716772e1a423" />

Graphite:

<img width="800" height="600" alt="themes_graphite" src="https://github.com/user-attachments/assets/be9d96d8-3b46-4a59-bf21-e6f4da72ceb9" />

Aurora:

<img width="800" height="600" alt="themes_aurora" src="https://github.com/user-attachments/assets/6173cdc9-84aa-49aa-b7f8-7142fdb2b49c" />

Sand:

<img width="800" height="600" alt="themes_sand" src="https://github.com/user-attachments/assets/610037d9-b85e-4eea-b056-e14673f1faef" />

</details>

## Setup & reference

<details>
<summary><b>Run locally</b> - Python + uv</summary>

Requires Python 3.13+ and [uv](https://docs.astral.sh/uv/).

```bash
uv sync --project backend
cd backend
ZH_SERVE_FRONTEND=true uv run uvicorn app.main:app --port 8000
```

Open [http://localhost:8000](http://localhost:8000).

`ZH_SERVE_FRONTEND=true` makes the API process serve the static frontend too. Without it, the service only exposes `/api/*`.

An optional Launch Library 2 token can be set with `ZH_LL2_API_TOKEN`. Without one, the free tier limits requests; the backend caches data for 10 minutes.

</details>

<details>
<summary><b>Deploy</b> - Docker Compose + Cloudflare Tunnel</summary>

The production setup runs the FastAPI backend and frontend in one container, with Cloudflare Tunnel providing public HTTPS access.

1. Create a Cloudflare Tunnel with the public hostname service `http://app:8000`.
2. Copy `.env.example` to `.env` and set `CLOUDFLARE_TUNNEL_TOKEN`.
3. Run:

```bash
docker compose up -d --build
```

The container runs as a non-root user with a read-only filesystem, dropped capabilities, and a healthcheck.

</details>

<details>
<summary><b>API</b> - public endpoints</summary>

- `GET /api/launches?limit=100&provider=spacex` - upcoming launches
- `GET /api/launches/next` - the next launch
- `GET /api/launches/{id}` - one launch by id or slug
- `GET /api/launches/{id}/calendar.ics` - one launch as an iCalendar event
- `GET /api/launches/{id}/calendar.ics?remind=60` - include a reminder 60 minutes before
- `GET /api/watchlist.ics?ids=...&remind=60` - a multi-event calendar from saved launch ids
- `GET /api/calendar` - confirmed launches as a subscribable calendar feed
- `GET /api/calendar.ics` - same feed, kept as an alias
- `GET /api/calendar?provider=spacex&status=Go&days=30` - filtered calendar feed
- `GET /api/health` - cache status

Responses are cached for 10 minutes. If Launch Library 2 fails, the last good data keeps being served with `"stale": true`. JSON responses carry an `ETag` and support conditional requests, and responses are gzip-compressed.

The calendar feed only includes launches with a confirmed time or day. Placeholder dates such as `NET Q4 2026` are left out until the schedule firms up.

</details>

<details>
<summary><b>Security</b> - headers and container hardening</summary>

- Strict Content Security Policy for the site, with a scoped policy for Swagger and ReDoc.
- HSTS, `X-Content-Type-Options`, `X-Frame-Options`, referrer, permissions, and COOP headers.
- Static frontend files send `Cache-Control: no-cache` so browsers revalidate after deployments.
- Container runs non-root with a read-only filesystem and restricted capabilities.

</details>

## Data sources

Launch data by [The Space Devs](https://thespacedevs.com) · maps by [OpenStreetMap](https://www.openstreetmap.org) · fonts by [Google Fonts](https://fonts.google.com)

Built with FastAPI, vanilla JavaScript modules, and a service worker.

*AI was used to help with debugging, security hardening and small fixes.*
