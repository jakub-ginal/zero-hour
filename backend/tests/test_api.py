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
