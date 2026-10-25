"""iCalendar export for upcoming launches."""

from datetime import UTC, datetime, timedelta

from app.models import Launch

PRECISE = {"SEC", "MIN", "HR"}
CRLF = "\r\n"
MAX_LINE_OCTETS = 75


def _escape(text: str | None) -> str:
    return (
        str(text or "")
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
        .replace("\r", "\\n")
    )


def _fold(line: str) -> str:
    """Fold a content line at 75 octets without splitting UTF-8 characters."""
    if len(line.encode("utf-8")) <= MAX_LINE_OCTETS:
        return line

    parts: list[str] = []
    current = ""
    size = 0
    for char in line:
        width = len(char.encode("utf-8"))
        if size + width > MAX_LINE_OCTETS:
            parts.append(current)
            current = " " + char
            size = 1 + width
        else:
            current += char
            size += width
    if current:
        parts.append(current)
    return CRLF.join(parts)


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _format_datetime(value: datetime) -> str:
    return _as_utc(value).astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def _format_date(value: datetime) -> str:
    return _as_utc(value).astimezone(UTC).strftime("%Y%m%d")


def calendar_ready(launch: Launch) -> bool:
    """Skip dates such as NET Q4 2026: they cannot be a calendar event yet."""
    precision = launch.net_precision
    return not precision or precision in PRECISE or precision == "DAY"


def _mission_title(launch: Launch) -> str:
    parts = launch.name.split(" | ")
    mission = " | ".join(parts[1:]) if len(parts) > 1 else (launch.mission.name or launch.name)
    return f"Launch: {mission} ({launch.rocket})"


def _description(launch: Launch, url: str) -> str:
    parts = [f"{launch.provider.name} · {launch.status.abbrev}"]
    if launch.mission.description:
        parts.append(launch.mission.description)
    precision = launch.net_precision
    if precision and precision not in PRECISE:
        parts.append(f"Date precision: {precision}. The exact lift-off time is not confirmed.")
    parts.append(url)
    return "\n\n".join(parts)


def _event(launch: Launch, base_url: str) -> list[str]:
    url = f"{base_url}/#launch/{launch.id}"
    start = _as_utc(launch.net)
    lines = [
        "BEGIN:VEVENT",
        f"UID:{launch.id}@zerohour",
        f"DTSTAMP:{_format_datetime(datetime.now(UTC))}",
    ]

    if launch.net_precision == "DAY":
        end = start + timedelta(days=1)
        lines.append(f"DTSTART;VALUE=DATE:{_format_date(start)}")
        lines.append(f"DTEND;VALUE=DATE:{_format_date(end)}")
    else:
        end = (
            launch.window_end
            if launch.window_end and _as_utc(launch.window_end) > start
            else start + timedelta(hours=1)
        )
        lines.append(f"DTSTART:{_format_datetime(start)}")
        lines.append(f"DTEND:{_format_datetime(end)}")

    location = ", ".join(part for part in (launch.pad.name, launch.pad.location) if part)
    lines.extend(
        [
            f"SUMMARY:{_escape(_mission_title(launch))}",
            f"DESCRIPTION:{_escape(_description(launch, url))}",
            f"URL:{url}",
        ]
    )
    if location:
        lines.append(f"LOCATION:{_escape(location)}")
    lines.append("END:VEVENT")
    return lines


def build_calendar(
    launches: list[Launch],
    *,
    base_url: str,
    name: str = "Zero Hour launch manifest",
    include_tentative: bool = False,
) -> str:
    selected = [launch for launch in launches if include_tentative or calendar_ready(launch)]
    selected.sort(key=lambda launch: launch.net)

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Zero Hour//Launch Tracker//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_escape(name)}",
        "X-WR-TIMEZONE:UTC",
    ]
    for launch in selected:
        lines.extend(_event(launch, base_url))
    lines.append("END:VCALENDAR")
    return CRLF.join(_fold(line) for line in lines) + CRLF
