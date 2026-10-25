# Zero Hour

A small page that lists upcoming rocket launches.

Launch data comes from [Launch Library 2](https://thespacedevs.com/llapi) through a
small FastAPI service that caches the upstream response so the free tier lasts longer.

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

## API

- `GET /api/launches?limit=100&provider=spacex` - upcoming launches
- `GET /api/launches/next` - the next launch
- `GET /api/launches/{id}` - one launch by id or slug
- `GET /api/launches/{id}/calendar.ics` - one launch as an iCalendar event
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
