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

## API

- `GET /api/launches?limit=24` - upcoming launches
- `GET /api/launches/next` - the next launch
- `GET /api/launches/{id}` - one launch by id or slug
- `GET /api/health` - cache status

Responses are cached for 10 minutes. If Launch Library 2 fails, the last good data
keeps being served with `"stale": true`.
