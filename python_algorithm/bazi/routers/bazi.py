"""BaZi endpoints.

The response is returned bare — Next.js adds its own ApiEnvelope wrapper,
per docs/API_INTEGRATION.md.
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from bazi.geo import cities
from bazi.calc.timezone import UnknownTimezone
from bazi.engine import UnsupportedInput, build_chart
from bazi.models.bazi import BaziChartRequest, BaziChartResult

router = APIRouter(prefix="/bazi", tags=["bazi"])


# exclude_none is deliberately off: the contract declares `ten_god: TenGod | null`
# and `override: PatternOverride | null`, so those keys must be serialised as
# explicit nulls rather than dropped.
@router.post("/chart", response_model=BaziChartResult)
async def compute_chart(request: BaziChartRequest) -> BaziChartResult:
    """Compute a chart from birth data.

    1.1 is computed; 1.2 and 1.4 are still placeholders (see bazi.engine), and
    meta.mock stays true until they are real.
    """
    try:
        return build_chart(request)
    except (UnsupportedInput, UnknownTimezone) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


class CityHit(BaseModel):
    id: str
    name: str
    country_code: str
    latitude: float
    longitude: float
    timezone: str
    alias: str | None = None   # the spelling that matched, when it is not the name


@router.get("/cities", response_model=list[CityHit])
async def search_cities(
    q: str = Query(min_length=1, max_length=64),
    limit: int = Query(10, ge=1, le=25),
) -> list[CityHit]:
    """City autocomplete over GeoNames (English names). Coordinates feed the
    true-solar-time correction; `timezone` is an IANA id for T5."""
    return [
        CityHit(id=h.city.id, name=h.city.name, country_code=h.city.country_code,
                latitude=h.city.latitude, longitude=h.city.longitude,
                timezone=h.city.timezone, alias=h.alias)
        for h in cities.search_hits(q, limit)
    ]


class LunarCheck(BaseModel):
    valid: bool
    solar_date: str | None = None
    message: str | None = None


@router.get("/lunar-date", response_model=LunarCheck)
async def check_lunar_date(
    date: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    leap: bool = False,
) -> LunarCheck:
    """Does this lunar date exist? Used by the form to flag a bad date as the
    user types, so the problem is shown next to the field and not after submit."""
    from bazi.calc.calendar import InvalidLunarDate, lunar_to_solar

    y, m, d = (int(x) for x in date.split("-"))
    try:
        return LunarCheck(valid=True, solar_date=lunar_to_solar(y, m, d, leap).isoformat())
    except InvalidLunarDate as exc:
        return LunarCheck(valid=False, message=str(exc))
