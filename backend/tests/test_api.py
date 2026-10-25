import json
import time
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.cache import LaunchCache, UpstreamUnavailableError
from app.config import Settings
from app.main import app

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "upcoming.json").read_text())


class FakeUpstream:
    def __init__(self) -> None:
        self.calls = 0
        self.fail = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        if self.fail:
            return httpx.Response(429, json={"detail": "throttled"})
        return httpx.Response(200, json=FIXTURE)


@pytest.fixture
def upstream() -> FakeUpstream:
    return FakeUpstream()


@pytest.fixture
def cache(upstream: FakeUpstream) -> LaunchCache:
    client = httpx.AsyncClient(transport=httpx.MockTransport(upstream.handler))
    return LaunchCache(Settings(cache_ttl_seconds=600), client)


@pytest.fixture
def api(cache: LaunchCache) -> TestClient:
    # Not entering the context manager skips the lifespan, so no real network is used.
    app.state.cache = cache
    return TestClient(app)


def test_list_launches(api: TestClient) -> None:
    resp = api.get("/api/launches")
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == len(FIXTURE["results"])
    assert body["stale"] is False
    first = body["results"][0]
    assert first["rocket"]
    assert first["provider"]["name"]
    nets = [launch["net"] for launch in body["results"]]
    assert nets == sorted(nets)


def test_limit_and_provider_filter(api: TestClient) -> None:
    assert api.get("/api/launches?limit=3").json()["count"] == 3
    body = api.get("/api/launches?provider=spacex").json()
    assert body["count"] > 0
    assert all(launch["provider"]["name"] == "SpaceX" for launch in body["results"])


def test_next_and_detail(api: TestClient) -> None:
    nxt = api.get("/api/launches/next").json()
    detail = api.get(f"/api/launches/{nxt['id']}").json()
    assert detail == nxt
    assert api.get(f"/api/launches/{nxt['slug']}").json()["id"] == nxt["id"]
    assert api.get("/api/launches/nope").status_code == 404


async def test_cache_reuses_data(cache: LaunchCache, upstream: FakeUpstream) -> None:
    await cache.get()
    await cache.get()
    assert upstream.calls == 1


async def test_serves_stale_data_on_failure(cache: LaunchCache, upstream: FakeUpstream) -> None:
    first = await cache.get()
    cache._fetched_mono = time.monotonic() - 10_000  # force expiry
    upstream.fail = True
    again = await cache.get()
    assert again == first
    assert cache.stale is True


async def test_raises_without_any_data(cache: LaunchCache, upstream: FakeUpstream) -> None:
    upstream.fail = True
    with pytest.raises(UpstreamUnavailableError):
        await cache.get()


def test_503_when_upstream_down(api: TestClient, upstream: FakeUpstream) -> None:
    upstream.fail = True
    assert api.get("/api/launches").status_code == 503


def test_etag_supports_conditional_requests(api: TestClient) -> None:
    first = api.get("/api/launches")
    assert first.status_code == 200
    assert first.headers["cache-control"].startswith("public")
    etag = first.headers["etag"]

    cached = api.get("/api/launches", headers={"If-None-Match": etag})
    assert cached.status_code == 304
    assert cached.content == b""
    assert cached.headers["etag"] == etag


def test_calendar_feed_contains_confirmed_launches(api: TestClient) -> None:
    resp = api.get("/api/calendar.ics")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/calendar")
    assert resp.headers["content-disposition"].startswith("attachment;")
    assert 'filename="zero-hour.ics"' in resp.headers["content-disposition"]

    body = resp.text
    assert body.startswith("BEGIN:VCALENDAR\r\n")
    assert body.endswith("END:VCALENDAR\r\n")

    ready = [
        launch
        for launch in FIXTURE["results"]
        if (launch.get("net_precision") or {}).get("abbrev") in {None, "SEC", "MIN", "HR", "DAY"}
    ]
    assert body.count("BEGIN:VEVENT") == len(ready)
    assert "DTSTART;VALUE=DATE:20261029" in body
    assert "END:VEVENT" in body
    for line in body.split("\r\n"):
        assert len(line.encode("utf-8")) <= 75


def test_calendar_feed_skips_tentative_dates(api: TestClient) -> None:
    body = api.get("/api/calendar.ics").text
    assert "IRNSS-1L" not in body
    assert "BlueBird 14-16" not in body


def test_calendar_for_one_launch(api: TestClient) -> None:
    nxt = api.get("/api/launches/next").json()
    resp = api.get(f"/api/launches/{nxt['id']}/calendar.ics")
    assert resp.status_code == 200
    assert f"UID:{nxt['id']}@zerohour" in resp.text
    assert '#launch/' in resp.text
    assert api.get("/api/launches/nope/calendar.ics").status_code == 404


def test_calendar_feed_sends_browsers_to_setup_page(api: TestClient) -> None:
    resp = api.get(
        "/api/calendar.ics", headers={"Sec-Fetch-Mode": "navigate"}, follow_redirects=False
    )
    assert resp.status_code == 303
    assert resp.headers["location"] == "/calendar.html"
    assert resp.headers["cache-control"] == "no-store"

    html = api.get(
        "/api/calendar.ics",
        headers={"Accept": "text/html,application/xhtml+xml"},
        follow_redirects=False,
    )
    assert html.status_code == 303
    assert html.headers["location"] == "/calendar.html"

    download = api.get(
        "/api/calendar.ics?download=1",
        headers={"Sec-Fetch-Mode": "navigate"},
        follow_redirects=False,
    )
    assert download.status_code == 200
    assert download.headers["content-type"].startswith("application/octet-stream")
    assert download.headers["content-disposition"].startswith("attachment;")
    assert "BEGIN:VCALENDAR" in download.text


def test_calendar_feed_alias(api: TestClient) -> None:
    resp = api.get("/api/calendar")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/calendar")


def test_health_is_not_cached(api: TestClient) -> None:
    assert api.get("/api/health").headers["cache-control"] == "no-store"
