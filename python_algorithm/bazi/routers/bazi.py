"""BaZi endpoints.

The response is returned bare — Next.js adds its own ApiEnvelope wrapper,
per docs/API_INTEGRATION.md.
"""

from fastapi import APIRouter

from ..engine.chart import build_chart
from ..models.bazi import BaziChartRequest, BaziChartResult

router = APIRouter(prefix="/bazi", tags=["bazi"])


# exclude_none is deliberately off: the contract declares `ten_god: TenGod | null`
# and `override: PatternOverride | null`, so those keys must be serialised as
# explicit nulls rather than dropped.
@router.post("/chart", response_model=BaziChartResult)
async def compute_chart(request: BaziChartRequest) -> BaziChartResult:
    """Compute a chart from solar or lunar birth data."""
    return build_chart(request)
