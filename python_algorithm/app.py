from fastapi import FastAPI, HTTPException
from typing import Literal
from datetime import datetime, timezone
from zoneinfo import ZoneInfoNotFoundError
from liuyao_core import enrich

from pydantic import AwareDatetime, BaseModel, Field, StrictInt

from hexagram_engine import calculate

app = FastAPI(title="Fortune deterministic algorithm service")

class CastingCalendarReceipt(BaseModel):
    cast_at: AwareDatetime
    timezone: str = "Asia/Shanghai"


class DivinationRequest(BaseModel):
    question: str = Field(min_length=1, max_length=300)
    method: Literal["three_numbers"]
    numbers: list[StrictInt] = Field(min_length=3, max_length=3)
    casting_receipt: CastingCalendarReceipt | None = None

@app.post("/divination/cast")
def cast_divination(request: DivinationRequest):
    try:
        result = calculate(request.method, request.numbers)
        receipt = request.casting_receipt
        instant = receipt.cast_at if receipt else datetime.now(timezone.utc)
        result["core_facts"] = enrich(result, instant, receipt.timezone if receipt else "Asia/Shanghai")
        return result
    except (ValueError, ZoneInfoNotFoundError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


# --- BaZi module (bazi/) -----------------------------------------------------
# Mounted here so both modules share one service, one port and the single
# PYTHON_ALGORITHM_BASE_URL. Everything BaZi-specific lives under bazi/.
from bazi.routers.bazi import router as bazi_router  # noqa: E402

app.include_router(bazi_router)
