import hashlib
import logging
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode

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


app = FastAPI(title="Zero Hour API", version="0.6.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)

CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "img-src 'self' data: https:; "
    "connect-src 'self'; "
    "frame-src https://www.openstreetmap.org; "
    "worker-src 'self'; "
    "manifest-src 'self'; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)
DOCS_CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; "
    "img-src 'self' data: https:; "
    "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com; "
    "connect-src 'self'; "
    "worker-src 'self' blob:; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)
DOCS_PATHS = {"/docs", "/redoc", "/docs/oauth2-redirect"}
SECURITY_HEADERS = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-Permitted-Cross-Domain-Policies": "none",
}


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    csp = (
        DOCS_CONTENT_SECURITY_POLICY
        if request.url.path in DOCS_PATHS
        else CONTENT_SECURITY_POLICY
    )
    response.headers.setdefault("Content-Security-Policy", csp)
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    return response


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


def _calendar_scope(
    launches: list[Launch],
    provider: str | None,
    status: str | None,
    days: int | None,
) -> list[Launch]:
    selected = launches
    if provider:
        needle = provider.casefold()
        selected = [
            launch
            for launch in selected
            if needle in launch.provider.name.casefold()
            or needle == (launch.provider.abbrev or "").casefold()
        ]
    if status:
        wanted = status.casefold()
        selected = [
            launch
            for launch in selected
            if launch.status.abbrev.casefold() == wanted or launch.status.name.casefold() == wanted
        ]
    if days:
        now = datetime.now(UTC)
        cutoff = now + timedelta(days=days)
        selected = [
            launch
            for launch in selected
            if now
            <= (launch.net if launch.net.tzinfo else launch.net.replace(tzinfo=UTC))
            <= cutoff
        ]
    return selected


def _calendar_name(provider: str | None, status: str | None, days: int | None) -> str:
    labels = ["Zero Hour launch manifest"]
    if provider:
        labels.append(provider)
    if status:
        labels.append(status.upper())
    if days:
        labels.append("next 24 hours" if days == 1 else f"next {days} days")
    return " · ".join(labels)


@app.get("/api/calendar")
@app.get("/api/calendar.ics")
async def calendar_feed(
    request: Request,
    download: bool = Query(False),
    provider: str | None = Query(
        None, max_length=80, description="Case-insensitive provider name filter"
    ),
    status: str | None = Query(
        None, max_length=80, description="Case-insensitive launch status filter"
    ),
    days: int | None = Query(
        None, ge=1, le=365, description="Only include launches in the next N days"
    ),
) -> Response:
    # A browser address bar must never receive the calendar document: some browsers hand
    # text/calendar to a system handler, which then chases the event URLs and opens tabs.
    navigation = request.headers.get("sec-fetch-mode") == "navigate"
    wants_html = "text/html" in request.headers.get("accept", "")
    if (navigation or wants_html) and not download:
        params = {
            key: value
            for key, value in {"provider": provider, "status": status, "days": days}.items()
            if value is not None
        }
        location = "/calendar.html" + (f"?{urlencode(params)}" if params else "")
        return RedirectResponse(
            location,
            status_code=303,
            headers={
                "Cache-Control": "no-store",
                "Vary": "Accept, Sec-Fetch-Mode",
            },
        )

    launches = await _launches(request)
    selected = _calendar_scope(launches, provider, status, days)
    body = build_calendar(
        selected,
        base_url=str(request.base_url).rstrip("/"),
        name=_calendar_name(provider, status, days),
    )
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


@app.get("/api/watchlist.ics")
async def watchlist_calendar(
    request: Request,
    ids: str = Query(..., max_length=4000, description="Comma-separated launch ids or slugs"),
    remind: int | None = Query(
        None, ge=1, le=10080, description="Minutes before lift-off to add a reminder"
    ),
) -> Response:
    wanted = list(dict.fromkeys(value.strip() for value in ids.split(",") if value.strip()))[:100]
    if not wanted:
        raise HTTPException(400, "No launch ids were provided")

    launches = await _launches(request)
    by_id: dict[str, Launch] = {}
    for launch in launches:
        by_id[launch.id] = launch
        if launch.slug:
            by_id[launch.slug] = launch
    selected: list[Launch] = []
    seen: set[str] = set()
    for value in wanted:
        launch = by_id.get(value)
        if launch is None or launch.id in seen:
            continue
        selected.append(launch)
        seen.add(launch.id)
    body = build_calendar(
        selected,
        base_url=str(request.base_url).rstrip("/"),
        name="Zero Hour watchlist",
        remind_minutes=remind,
    )
    return Response(
        body,
        media_type="text/calendar",
        headers={
            "Cache-Control": "public, max-age=300",
            "Content-Disposition": 'attachment; filename="zero-hour-watchlist.ics"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.get("/api/launches/next")
async def next_launch(request: Request) -> Launch:
    launches = await _launches(request)
    if not launches:
        raise HTTPException(404, "No upcoming launches")
    return launches[0]


@app.get("/api/launches/{launch_id}/calendar.ics")
async def launch_calendar(
    launch_id: str,
    request: Request,
    remind: int | None = Query(
        None, ge=1, le=10080, description="Minutes before lift-off to add a reminder"
    ),
) -> Response:
    launch = await _find_launch(request, launch_id)
    if launch is None:
        raise HTTPException(404, "Launch not found")
    body = build_calendar(
        [launch],
        base_url=str(request.base_url).rstrip("/"),
        name=f"{launch.name} · Zero Hour",
        include_tentative=True,
        remind_minutes=remind,
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


class RevalidatingStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope) -> Response:
        response = await super().get_response(path, scope)
        response.headers.setdefault("Cache-Control", "no-cache")
        return response


frontend_dir = Path(__file__).resolve().parents[2] / "frontend"
if settings.serve_frontend and (frontend_dir / "index.html").exists():
    app.mount("/", RevalidatingStaticFiles(directory=frontend_dir, html=True), name="frontend")
