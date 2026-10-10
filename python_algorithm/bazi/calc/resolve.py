"""From birth input to resolved clocks and four pillars (T3-T6 assembled).

Clock bookkeeping, in the order it must happen:
  civil (local, as entered)
    -> offset_at(tz)          which offset was in force (T5)
    -> to_cst                 the clock solar-term instants use  -> year, month
    -> true_solar_time        civil - DST + longitude + EoT      -> day, hour
"""

from dataclasses import dataclass, field
from datetime import datetime

from bazi.calc import solar_time, timezone as tzmod
from bazi.calc.pillars import Pillars, compute_pillars


@dataclass(frozen=True)
class ResolvedBirth:
    civil: datetime
    timezone: str
    utc_offset_minutes: int
    dst_applied: bool
    cst: datetime
    longitude_correction_minutes: float
    equation_of_time_minutes: float
    true_solar: datetime
    crossed_pillar_boundary: bool  # true solar time changed the day or hour pillar
    pillars: Pillars
    warnings: list[str] = field(default_factory=list, compare=False)

    @property
    def true_solar_hhmm(self) -> str:
        # Floored, so the string never reads past a boundary the pillars did not cross.
        return f"{self.true_solar:%H:%M}"


def resolve_birth(civil: datetime, latitude: float, longitude: float,
                  timezone: str | None = None) -> ResolvedBirth:
    tz_name = tzmod.resolve_timezone(latitude, longitude, timezone)
    info = tzmod.offset_at(civil, tz_name)
    cst = tzmod.to_cst(civil, info)
    solar, lon_corr, eot = solar_time.true_solar_time(civil, longitude, info)

    pillars = compute_pillars(cst, solar)
    # Same instant with no correction at all (civil minus DST), for the flag.
    uncorrected = compute_pillars(cst, civil - info.dst_offset)
    crossed = (pillars.day, pillars.hour) != (uncorrected.day, uncorrected.hour)

    return ResolvedBirth(
        civil=civil, timezone=tz_name, utc_offset_minutes=info.utc_offset_minutes,
        dst_applied=info.dst_applied, cst=cst,
        longitude_correction_minutes=lon_corr, equation_of_time_minutes=eot,
        true_solar=solar, crossed_pillar_boundary=crossed, pillars=pillars,
        warnings=list(info.warnings),
    )
