"""IANA timezone resolution and the offset in force at a birth moment.

No hand-written rule tables: zone lookup is `timezonefinder` (coordinates ->
IANA id) and offsets come from `zoneinfo`, i.e. the tz database, which carries
historical changes (e.g. China's 1986-1991 DST, pre-1901 local mean time).

Known limit, left for T14: the coordinates are mapped to *today's* zone
boundaries, so a place that changed zone in the past is resolved to its
current one.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from timezonefinder import TimezoneFinder

CST_OFFSET = timedelta(hours=8)  # the clock solar-term instants are given in


@lru_cache(maxsize=1)
def _finder() -> TimezoneFinder:
    return TimezoneFinder()


class UnknownTimezone(ValueError):
    pass


def resolve_timezone(latitude: float, longitude: float, explicit: str | None = None) -> str:
    """IANA id: the caller's explicit one if given (validated), else from coordinates."""
    if explicit:
        try:
            ZoneInfo(explicit)
        except (ZoneInfoNotFoundError, ValueError) as e:
            raise UnknownTimezone(f"unknown IANA timezone: {explicit!r}") from e
        return explicit
    tz = _finder().timezone_at(lat=latitude, lng=longitude)
    if tz is None:
        raise UnknownTimezone(f"no timezone found at ({latitude}, {longitude})")
    return tz


@dataclass(frozen=True)
class OffsetInfo:
    timezone: str
    utc_offset: timedelta
    dst_offset: timedelta  # the DST part of utc_offset (zero outside DST)
    dst_applied: bool
    ambiguous: bool      # clock time occurs twice (DST ends); first occurrence used
    nonexistent: bool    # clock time skipped (DST starts); pre-transition offset used
    warnings: list[str] = field(default_factory=list, compare=False)

    @property
    def standard_offset(self) -> timedelta:
        """Offset without DST; 15 degrees per hour of it is the zone's central meridian."""
        return self.utc_offset - self.dst_offset

    @property
    def utc_offset_minutes(self) -> int:
        return round(self.utc_offset.total_seconds() / 60)


def offset_at(civil: datetime, tz_name: str) -> OffsetInfo:
    """The UTC offset in force at a naive local civil time in `tz_name`."""
    tz = ZoneInfo(tz_name)
    first = civil.replace(tzinfo=tz, fold=0)
    second = civil.replace(tzinfo=tz, fold=1)
    # A skipped time does not survive a round trip through UTC.
    back = first.astimezone(timezone.utc).astimezone(tz).replace(tzinfo=None)
    nonexistent = back != civil
    # Both folds differ in a gap too, so ambiguity only counts for times that exist.
    ambiguous = not nonexistent and first.utcoffset() != second.utcoffset()

    warnings = []
    if ambiguous:
        warnings.append("出生时刻落在夏令时结束的重复时段，已按第一次出现（夏令时）处理。")
    if nonexistent:
        warnings.append("出生时刻落在夏令时开始时被跳过的时段，该钟点实际不存在，已按转换前的偏移处理。")

    return OffsetInfo(
        timezone=tz_name,
        utc_offset=first.utcoffset(),
        dst_offset=first.dst() or timedelta(0),
        dst_applied=bool(first.dst()),
        ambiguous=ambiguous,
        nonexistent=nonexistent,
        warnings=warnings,
    )


def to_cst(civil: datetime, info: OffsetInfo) -> datetime:
    """Convert local civil time to UTC+8, the clock the solar-term table uses."""
    return civil - info.utc_offset + CST_OFFSET
