"""Offline historical chart decorator. No dates, model, reference answers or DB writes."""
import json
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python_algorithm"))
import liuyao_core as core


def build(payload):
    before, after = payload["bits"], payload["changed_bits"]
    assert len(before) == len(after) == 6
    day, month = payload["day"], payload["month"]
    start = (core.BRANCHES.index(day[1]) - core.STEMS.index(day[0])) % 12
    cal = {"policy_id": "offline-explicit-month-day-v1", "provider": "explicit_historical_ganzhi",
           "calendar_timezone": None, "display_timezone": None, "display_time": None,
           "calendar_time": None, "year_ganzhi": None, "hour_ganzhi": None,
           "month_ganzhi": month, "month_branch": month[1], "day_ganzhi": day,
           "day_stem": day[0], "day_branch": day[1], "xun_start": "甲" + core.BRANCHES[start],
           "empty_branches": [core.BRANCHES[(start + 10) % 12], core.BRANCHES[(start + 11) % 12]],
           "day_rollover": "unknown", "month_rollover": "explicit_month_branch", "true_solar_time": False}
    lines = [9 if a == "1" else 6 if a != b else 8 for a, b in zip(before, after)]
    lines = [v if a != b else 7 if a == "1" else 8 for v, a, b in zip(lines, before, after)]
    changed = [7 if v == 6 else 8 if v == 9 else v for v in lines]
    with patch.object(core, "calendar", return_value=cal):
        result = core.enrich({"primary": {"lines": lines}, "transformed": {"lines": changed}}, None)
    assert "".join(str(v % 2) for v in lines) == before
    assert "".join(str(v % 2) for v in changed) == after
    return result


if __name__ == "__main__":
    print(json.dumps(build(json.load(sys.stdin)), ensure_ascii=False))
