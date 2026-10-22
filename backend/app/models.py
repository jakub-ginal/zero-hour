from datetime import datetime
from typing import Any

from pydantic import BaseModel


class Status(BaseModel):
    abbrev: str
    name: str
    description: str | None = None


class Provider(BaseModel):
    name: str
    abbrev: str | None = None
    type: str | None = None


class Pad(BaseModel):
    name: str | None = None
    location: str | None = None
    country_code: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    map_url: str | None = None
    wiki_url: str | None = None


class Mission(BaseModel):
    name: str | None = None
    type: str | None = None
    description: str | None = None
    orbit: str | None = None
    orbit_abbrev: str | None = None


class Launch(BaseModel):
    id: str
    slug: str | None = None
    name: str
    rocket: str
    provider: Provider
    status: Status
    net: datetime
    net_precision: str | None = None
    window_start: datetime | None = None
    window_end: datetime | None = None
    image_url: str | None = None
    thumbnail_url: str | None = None
    image_credit: str | None = None
    mission: Mission
    pad: Pad
    probability: int | None = None
    webcast_live: bool = False
    video_url: str | None = None
    info_url: str | None = None


class LaunchList(BaseModel):
    count: int
    fetched_at: datetime | None
    stale: bool
    results: list[Launch]


def _get(obj: Any, *path: str | int) -> Any:
    """Walk nested dicts/lists, returning None on any missing step."""
    for key in path:
        if obj is None:
            return None
        if isinstance(key, int):
            obj = obj[key] if isinstance(obj, list) and len(obj) > key else None
        else:
            obj = obj.get(key) if isinstance(obj, dict) else None
    return obj


def _first_url(items: Any) -> str | None:
    if isinstance(items, list):
        for item in items:
            if isinstance(item, dict) and item.get("url"):
                return item["url"]
    return None


def normalize_launch(raw: dict[str, Any]) -> Launch:
    """Flatten a Launch Library 2 launch record into the shape the frontend uses."""
    mission = raw.get("mission") or {}
    pad = raw.get("pad") or {}
    rocket_config = _get(raw, "rocket", "configuration") or {}
    image = raw.get("image") or {}

    return Launch(
        id=raw["id"],
        slug=raw.get("slug"),
        name=raw.get("name") or "Unknown launch",
        rocket=rocket_config.get("full_name") or rocket_config.get("name") or "Unknown rocket",
        provider=Provider(
            name=_get(raw, "launch_service_provider", "name") or "Unknown",
            abbrev=_get(raw, "launch_service_provider", "abbrev"),
            type=_get(raw, "launch_service_provider", "type", "name"),
        ),
        status=Status(
            abbrev=_get(raw, "status", "abbrev") or "TBD",
            name=_get(raw, "status", "name") or "To Be Determined",
            description=_get(raw, "status", "description"),
        ),
        net=raw["net"],
        net_precision=_get(raw, "net_precision", "abbrev"),
        window_start=raw.get("window_start"),
        window_end=raw.get("window_end"),
        image_url=image.get("image_url"),
        thumbnail_url=image.get("thumbnail_url"),
        image_credit=image.get("credit"),
        mission=Mission(
            name=mission.get("name"),
            type=mission.get("type"),
            description=mission.get("description"),
            orbit=_get(mission, "orbit", "name"),
            orbit_abbrev=_get(mission, "orbit", "abbrev"),
        ),
        pad=Pad(
            name=pad.get("name"),
            location=_get(pad, "location", "name"),
            country_code=_get(pad, "country", "alpha_2_code"),
            latitude=pad.get("latitude"),
            longitude=pad.get("longitude"),
            map_url=pad.get("map_url"),
            wiki_url=pad.get("wiki_url"),
        ),
        probability=raw.get("probability"),
        webcast_live=bool(raw.get("webcast_live")),
        video_url=_first_url(raw.get("vid_urls")) or _first_url(mission.get("vid_urls")),
        info_url=_first_url(raw.get("info_urls")) or _first_url(mission.get("info_urls")),
    )
