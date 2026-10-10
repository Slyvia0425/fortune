"""Reads one of the data files in bazi/data/basics/."""

import json
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data" / "basics"


@lru_cache(maxsize=None)
def read(name: str) -> dict:
    return json.loads((DATA / f"{name}.json").read_text(encoding="utf-8"))
