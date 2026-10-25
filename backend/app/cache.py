import asyncio
import logging
import time
from datetime import UTC, datetime

import httpx

from app.config import Settings
from app.models import Launch, normalize_launch

log = logging.getLogger(__name__)


class UpstreamUnavailableError(Exception):
    """Raised when Launch Library 2 fails and no cached data exists."""


class LaunchCache:
    """Caches upcoming launches so we stay inside the upstream rate limit.

    If a refresh fails, the last good data keeps being served and is flagged as stale.
    """

    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self._settings = settings
        self._client = client
        self._lock = asyncio.Lock()
        self._launches: list[Launch] = []
        self._fetched_at: datetime | None = None
        self._fetched_mono: float | None = None
        self._last_failure_mono: float | None = None
        self.stale = False

    @property
    def fetched_at(self) -> datetime | None:
        return self._fetched_at

    def _is_fresh(self) -> bool:
        if self._fetched_mono is None:
            return False
        return time.monotonic() - self._fetched_mono < self._settings.cache_ttl_seconds

    def _in_failure_backoff(self) -> bool:
        # After a failed refresh, wait a minute before trying again so we do not hammer upstream.
        return (
            self._last_failure_mono is not None and time.monotonic() - self._last_failure_mono < 60
        )

    async def get(self) -> list[Launch]:
        if self._is_fresh():
            return self._launches
        async with self._lock:
            if self._is_fresh():
                return self._launches
            if self._launches and self._in_failure_backoff():
                return self._launches
            try:
                await self._refresh()
            except (httpx.HTTPError, ValueError, KeyError) as exc:
                self._last_failure_mono = time.monotonic()
                log.warning("Launch Library refresh failed: %s", exc)
                if not self._launches:
                    raise UpstreamUnavailableError(str(exc)) from exc
                self.stale = True
            return self._launches

    async def _refresh(self) -> None:
        headers = {"Accept": "application/json", "User-Agent": "ZeroHour/0.2"}
        if self._settings.ll2_api_token:
            headers["Authorization"] = f"Token {self._settings.ll2_api_token}"
        resp = await self._client.get(
            f"{self._settings.ll2_base_url}/launches/upcoming/",
            params={"limit": self._settings.fetch_limit, "mode": "normal"},
            headers=headers,
        )
        resp.raise_for_status()
        payload = resp.json()
        launches = []
        for raw in payload.get("results", []):
            try:
                launches.append(normalize_launch(raw))
            except (ValueError, KeyError) as exc:
                log.warning("Skipping malformed launch %s: %s", raw.get("id"), exc)
        launches.sort(key=lambda launch: launch.net)
        self._launches = launches
        self._fetched_at = datetime.now(UTC)
        self._fetched_mono = time.monotonic()
        self._last_failure_mono = None
        self.stale = False
        log.info("Cached %d upcoming launches", len(launches))
