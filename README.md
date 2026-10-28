# Zero Hour

A launch tracker for upcoming rocket launches, with countdowns, mission control, briefings, and calendar feeds.

Launch data comes from [Launch Library 2](https://thespacedevs.com/llapi) through a
small FastAPI service that caches the upstream response so the free tier lasts longer.

## Project layout

- `frontend/` - the installable PWA, pages, styles, scripts, and static icons.
- `backend/` - the FastAPI service, launch cache, calendar feeds, and API tests.

## Run it locally

Requires Python 3.13+ and [uv](https://docs.astral.sh/uv/).

    uv sync --project backend
    cd backend
    ZH_SERVE_FRONTEND=true uv run uvicorn app.main:app --port 8000

Then open http://localhost:8000.

`ZH_SERVE_FRONTEND=true` makes the API process serve the static frontend too; without
it the service only exposes `/api/*`.

The frontend is an installable PWA with an offline shell and launch caching. Launch
filters and calendar scopes are reflected in the URL, so filtered views can be
bookmarked or shared.

## Mission control, briefings, and search

- `/mission-control.html` summarizes launch cadence, provider share, status mix,
  the next dated lift-offs, and the month ahead.
- `/launch.html?id=...` is a permanent launch briefing with a live countdown, the
  full mission file, pad details, links, save controls, and an iCalendar download.
  Previous/next controls and the arrow keys move through the manifest.
- Launch day mode highlights the next lift-off within 24 hours, surfaces the live
  webcast, and refreshes the home hero and briefing every minute near T-0.
- Press Ctrl K (or `/`) on any page to open the launch finder. It searches missions,
  providers, vehicles, pads, locations, and statuses; results work offline from the
  cached manifest.
- Calendar downloads can include a 15-minute, 1-hour, or 1-day reminder.
- Watchlists stay in browser storage under `zh-saved`. Mission control can export
  them as JSON and merge an exported watchlist back in on any browser.
- Mission control can copy a share link that encodes the current watchlist in
  `?watchlist=...`. Opening it shows a preview before anything is imported locally.
- The watchlist can be downloaded as a multi-event iCalendar file with an optional
  15-minute, 1-hour, or 1-day reminder. Dated launches are included; tentative
  placeholders stay in the JSON export until their dates firm up.
- All pages, including the finder, are part of the offline shell. Install support is
  available in Chromium browsers; Firefox desktop does not offer PWA installation.

## API

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

Responses are cached for 10 minutes. If Launch Library 2 fails, the last good data
keeps being served with `"stale": true`. JSON responses carry an `ETag` and support
conditional requests, and responses are gzip-compressed.

The calendar feed only includes launches with a confirmed time or day. Placeholder
dates such as `NET Q4 2026` are left out until the schedule firms up. It can be scoped
with `provider`, `status`, and `days` (1-365), and the setup page builds those URLs for
you. Add the feed URL inside a calendar app. Browser visits are redirected to the setup
page instead of handing the calendar file to a system handler; `?download=1` forces a
direct download. On the page, saved launches, filter views, and the copied feed URL stay
local to the browser.
