"""Private runtime audit database; never store users' questions in the public corpus."""

import importlib.util
import json
import sqlite3
import sys
from contextlib import contextmanager
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from uuid import uuid4

from .ingest import canonical, sha

METHOD = "zengshan-single-cast-v1"


@lru_cache(maxsize=1)
def algorithm():
    path = Path(__file__).resolve().parents[4] / "python_algorithm/hexagram_engine.py"
    spec = importlib.util.spec_from_file_location("fortune_frozen_hexagram_engine", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.calculate, sha(path.read_text())


@lru_cache(maxsize=1)
def decoration():
    path = Path(__file__).resolve().parents[4] / "python_algorithm/liuyao_core.py"
    spec = importlib.util.spec_from_file_location("fortune_liuyao_decoration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def freeze(numbers, question, *, cast_at=None, timezone="Asia/Shanghai"):
    if not isinstance(question, str) or not 1 <= len(question.strip()) <= 500:
        raise ValueError("Question must be 1–500 characters")
    if len(numbers) != 3 or any(
        type(n) is not int or not 0 < n <= 9007199254740991 for n in numbers
    ):
        raise ValueError("Exactly three positive safe integers required")
    calculate, revision = algorithm()
    result = calculate("three_numbers", numbers)
    instant = cast_at if cast_at is not None else datetime.now(UTC)
    module = decoration()
    facts = module.enrich(result, instant, timezone)
    chart = {
        "chart_id": str(uuid4()),
        "original_question": question,
        "numbers": numbers,
        "cast_at": instant.isoformat(),
        "timezone": timezone,
        "casting_algorithm_id": "three-numbers-mod8-mod6",
        "casting_algorithm_version": "v1",
        "core_version": module.VERSION,
        "decoration_source_hash": sha(Path(module.__file__).read_text()),
        "calendar_policy_id": module.POLICY,
        "core_source_hash": revision,
        "method_profile_id": METHOD,
        "method_profile_version": "1",
        "algorithm_result": result,
        "facts": facts,
    }
    chart["chart_hash"] = sha(canonical(chart))
    return chart


def verify_chart(chart):
    if chart.get("chart_hash") != sha(
        canonical({k: v for k, v in chart.items() if k != "chart_hash"})
    ):
        raise ValueError("Frozen chart hash mismatch")
    return chart


class RuntimeStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS frozen_cast (owner TEXT NOT NULL, "
                "request_id TEXT NOT NULL, input_hash TEXT NOT NULL, "
                "chart_id TEXT UNIQUE NOT NULL, "
                "chart_json TEXT NOT NULL, PRIMARY KEY(owner, request_id))"
            )
            conn.execute(
                "CREATE TABLE IF NOT EXISTS retrieval_run (run_id TEXT PRIMARY KEY, "
                "owner TEXT NOT NULL, chart_id TEXT NOT NULL, created_at TEXT NOT NULL, "
                "pack_json TEXT NOT NULL)"
            )

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.path, timeout=30)
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def freeze_once(self, owner, request_id, numbers, question, cast=freeze):
        digest = sha(canonical({"numbers": numbers, "question": question}))
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT input_hash, chart_json FROM frozen_cast WHERE owner=? AND request_id=?",
                (owner, request_id),
            ).fetchone()
            if row:
                if row[0] != digest:
                    raise ValueError("Request ID reused with different input")
                return verify_chart(json.loads(row[1]))
            chart = verify_chart(cast(numbers, question))
            conn.execute(
                "INSERT INTO frozen_cast VALUES (?,?,?,?,?)",
                (owner, request_id, digest, chart["chart_id"], canonical(chart)),
            )
            return chart

    def load(self, owner, chart_id):
        with self.connect() as conn:
            row = conn.execute(
                "SELECT chart_json FROM frozen_cast WHERE owner=? AND chart_id=?", (owner, chart_id)
            ).fetchone()
        if not row:
            raise ValueError("Frozen chart not found for owner")
        return verify_chart(json.loads(row[0]))

    def save(self, owner, pack):
        run_id = str(uuid4())
        pack["retrieval_run_id"] = run_id
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO retrieval_run VALUES (?,?,?,?,?)",
                (run_id, owner, pack["chart_id"], datetime.now(UTC).isoformat(), canonical(pack)),
            )
        return pack
