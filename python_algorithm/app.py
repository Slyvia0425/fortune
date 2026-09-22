from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from hexagram_engine import calculate, hexagram_catalog

app = FastAPI(title="Fortune deterministic algorithm service")

class DivinationRequest(BaseModel):
    question: str = Field(min_length=1, max_length=300)
    method: str
    numbers: list[int] | None = None
    coins: list[list[int]] | None = None
    time_range: str | None = Field(default=None, max_length=80)

@app.post("/divination/cast")
def cast_divination(request: DivinationRequest):
    try:
        return calculate(request.method, request.numbers, request.coins)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/divination/catalog")
def divination_catalog() -> list[dict[str, object]]:
    return hexagram_catalog()

# --- BaZi module (bazi/) -----------------------------------------------------
# Mounted here so both modules share one service, one port and the single
# PYTHON_ALGORITHM_BASE_URL. Everything BaZi-specific lives under bazi/.
from bazi.routers.bazi import router as bazi_router  # noqa: E402

app.include_router(bazi_router)
