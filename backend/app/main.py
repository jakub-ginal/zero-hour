import hashlib
import logging
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.cache import LaunchCache, UpstreamUnavailableError
from app.calendar import build_calendar
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


app = FastAPI(title="Zero Hour API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)


async def _launches(request: Request) -> list[Launch]:
    try:
        return await request.app.state.cache.get()
    except UpstreamUnavailableError as exc:
        raise HTTPException(503, "Launch data is temporarily unavailable") from exc


async def _find_launch(request: Request, launch_id: str) -> Launch | None:
    for launch in await _launches(request):
        if launch.id == launch_id or launch.slug == launch_id:
            return launch
    return None


def _etag_matches(header: str | None, etag: str) -> bool:
    if not header:
        return False
    return any(candidate.strip() in {"*", etag} for candidate in header.split(","))


@app.get("/api/health")
async def health(request: Request, response: Response) -> dict[str, object]:
    cache: LaunchCache = request.app.state.cache
    response.headers["Cache-Control"] = "no-store"
    return {"status": "ok", "fetched_at": cache.fetched_at, "stale": cache.stale}


@app.get("/api/launches", response_model=LaunchList)
async def list_launches(
    request: Request,
    response: Response,
    limit: int = Query(100, ge=1, le=100),
    provider: str | None = Query(None, description="Case-insensitive provider name filter"),
) -> LaunchList | Response:
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
    payload = LaunchList(
        count=len(results), fetched_at=cache.fetched_at, stale=cache.stale, results=results
    )
    etag = f'W/"{hashlib.sha256(payload.model_dump_json().encode()).hexdigest()[:32]}"'
    headers = {
        "ETag": etag,
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    }
    if _etag_matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)
    response.headers.update(headers)
    return payload


@app.get("/api/calendar")
@app.get("/api/calendar.ics")
async def calendar_feed(request: Request, download: bool = Query(False)) -> Response:
    # A browser address bar must never receive the calendar document: some browsers hand
    # text/calendar to a system handler, which then chases the event URLs and opens tabs.
    navigation = request.headers.get("sec-fetch-mode") == "navigate"
    wants_html = "text/html" in request.headers.get("accept", "")
    if (navigation or wants_html) and not download:
        return RedirectResponse(
            "/calendar.html",
            status_code=303,
            headers={
                "Cache-Control": "no-store",
                "Vary": "Accept, Sec-Fetch-Mode",
            },
        )

    launches = await _launches(request)
    body = build_calendar(launches, base_url=str(request.base_url).rstrip("/"))
    # Explicit downloads use a generic type so a broken text/calendar handler in the
    # browser cannot reopen the file with the browser itself and spawn tabs forever.
    return Response(
        body,
        media_type="application/octet-stream" if download else "text/calendar",
        headers={
            "Cache-Control": "public, max-age=300",
            "Content-Disposition": 'attachment; filename="zero-hour.ics"',
            "X-Content-Type-Options": "nosniff",
            "Vary": "Accept, Sec-Fetch-Mode",
        },
    )


@app.get("/api/launches/next")
async def next_launch(request: Request) -> Launch:
    launches = await _launches(request)
    if not launches:
        raise HTTPException(404, "No upcoming launches")
    return launches[0]


@app.get("/api/launches/{launch_id}/calendar.ics")
async def launch_calendar(launch_id: str, request: Request) -> Response:
    launch = await _find_launch(request, launch_id)
    if launch is None:
        raise HTTPException(404, "Launch not found")
    body = build_calendar(
        [launch],
        base_url=str(request.base_url).rstrip("/"),
        name=f"{launch.name} · Zero Hour",
        include_tentative=True,
    )
    filename = re.sub(r"[^A-Za-z0-9._-]+", "-", launch.slug or launch.id).strip("-") or "launch"
    return Response(
        body,
        media_type="text/calendar",
        headers={
            "Cache-Control": "public, max-age=300",
            "Content-Disposition": f'attachment; filename="{filename}.ics"',
        },
    )


@app.get("/api/launches/{launch_id}")
async def get_launch(launch_id: str, request: Request) -> Launch:
    launch = await _find_launch(request, launch_id)
    if launch is None:
        raise HTTPException(404, "Launch not found")
    return launch


frontend_dir = Path(__file__).resolve().parents[2]
if settings.serve_frontend and (frontend_dir / "index.html").exists():
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
