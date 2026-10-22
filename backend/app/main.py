import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.cache import LaunchCache, UpstreamUnavailableError
from app.config import settings
from app.models import Launch, LaunchList

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
        app.state.cache = LaunchCache(settings, client)
        # Warm the cache so the first visitor does not wait. Failure here is not fatal.
        with suppress(UpstreamUnavailableError):
            await app.state.cache.get()
        yield


app = FastAPI(title="Zero Hour API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET"],
    allow_headers=["*"],
)


async def _launches(request: Request) -> list[Launch]:
    try:
        return await request.app.state.cache.get()
    except UpstreamUnavailableError as exc:
        raise HTTPException(503, "Launch data is temporarily unavailable") from exc


@app.get("/api/health")
async def health(request: Request) -> dict[str, object]:
    cache: LaunchCache = request.app.state.cache
    return {"status": "ok", "fetched_at": cache.fetched_at, "stale": cache.stale}


@app.get("/api/launches")
async def list_launches(
    request: Request,
    limit: int = Query(100, ge=1, le=100),
    provider: str | None = Query(None, description="Case-insensitive provider name filter"),
) -> LaunchList:
    launches = await _launches(request)
    if provider:
        needle = provider.lower()
        launches = [
            launch
            for launch in launches
            if needle in launch.provider.name.lower()
            or needle == (launch.provider.abbrev or "").lower()
        ]
    cache: LaunchCache = request.app.state.cache
    results = launches[:limit]
    return LaunchList(
        count=len(results), fetched_at=cache.fetched_at, stale=cache.stale, results=results
    )


@app.get("/api/launches/next")
async def next_launch(request: Request) -> Launch:
    launches = await _launches(request)
    if not launches:
        raise HTTPException(404, "No upcoming launches")
    return launches[0]


@app.get("/api/launches/{launch_id}")
async def get_launch(launch_id: str, request: Request) -> Launch:
    for launch in await _launches(request):
        if launch.id == launch_id or launch.slug == launch_id:
            return launch
    raise HTTPException(404, "Launch not found")


frontend_dir = Path(__file__).resolve().parents[2]
if settings.serve_frontend and (frontend_dir / "index.html").exists():
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
