"""Wiring: POST /bazi/chart now returns computed 1.1 data (T3-T11 + T9)."""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app import app
from bazi.calc.calendar import InvalidLunarDate, lunar_to_solar
from bazi.models.bazi import BaziChartRequest, BaziChartResult
from bazi.engine import build_chart
from bazi.rules.inference import Inference

client = TestClient(app)
SHANGHAI = dict(latitude=31.2304, longitude=121.4737, source="manual_coordinates")


def body(**over):
    base = dict(birth_date="1992-11-07", birth_time="11:37", gender="male", birth_place=SHANGHAI)
    return {**base, **over}


def test_survey_case_is_computed_not_mocked():
    r = client.post("/bazi/chart", json=body())
    assert r.status_code == 200
    d = r.json()
    BaziChartResult.model_validate(d)          # still contract-shaped
    # 1992-11-07 11:37 Shanghai: before 立冬 11:57 -> 庚戌 month
    assert [(p["stem"], p["branch"]) for p in d["pillars"]][:2] == [("ren", "shen"), ("geng", "xu")]
    assert d["resolved_time"]["timezone"] == "Asia/Shanghai"
    assert d["resolved_time"]["true_solar_time"] != d["resolved_time"]["civil_time"]
    assert d["solar_term"]["month_term"] == "hanlu" and d["solar_term"]["near_boundary"] is True
    assert d["luck_onset"]["direction"] in ("forward", "reverse")
    assert len(d["luck_cycles"]) == 8
    assert d["annual_cycles"][0]["year"] == d["luck_cycles"][0]["start_year"]


def test_the_day_master_is_the_day_pillars_stem_and_the_eight_characters_are_counted():
    d = client.post("/bazi/chart", json=body()).json()
    day = d["pillars"][2]
    assert d["day_master"]["stem"] == day["stem"]
    assert sum(d["elements"].values()) == 8


def test_different_births_give_different_charts():
    a = client.post("/bazi/chart", json=body()).json()
    b = client.post("/bazi/chart", json=body(birth_date="1985-03-14", birth_time="08:20")).json()
    assert a["pillars"] != b["pillars"] and a["luck_cycles"] != b["luck_cycles"]


def test_dst_and_foreign_places():
    ny = dict(latitude=40.7128, longitude=-74.006, source="manual_coordinates")
    d = client.post("/bazi/chart", json=body(birth_place=ny, birth_date="1992-11-06", birth_time="20:00")).json()
    assert d["resolved_time"]["timezone"] == "America/New_York"
    assert d["resolved_time"]["utc_offset_minutes"] == -300
    assert d["pillars"][1]["branch"] == "xu"              # 20:00 EST = 09:00 CST, before 立冬
    gap = client.post("/bazi/chart", json=body(birth_place=ny, birth_date="2000-04-02", birth_time="02:30")).json()
    assert any("不存在" in w for w in gap["meta"]["warnings"])


def test_unspecified_gender_is_no_longer_accepted():
    assert client.post("/bazi/chart", json=body(gender="unspecified")).status_code == 422


def test_lunar_input_is_converted():
    # 农历 1992-10-13 == 公历 1992-11-07
    assert lunar_to_solar(1992, 10, 13).isoformat() == "1992-11-07"
    d = client.post("/bazi/chart", json=body(calendar="lunar", birth_date="1992-10-13", is_leap_month=False)).json()
    assert d["resolved_time"]["solar_date"] == "1992-11-07"
    assert d["pillars"][1]["branch"] == "xu"


def test_leap_month_and_nonexistent_lunar_dates():
    assert lunar_to_solar(2020, 4, 1, leap_month=True).isoformat() == "2020-05-23"   # 闰四月初一
    with pytest.raises(InvalidLunarDate):
        lunar_to_solar(2021, 4, 1, leap_month=True)       # 2021 has no leap 4th month
    with pytest.raises(InvalidLunarDate):
        lunar_to_solar(2021, 2, 31)
    r = client.post("/bazi/chart", json=body(calendar="lunar", birth_date="2021-01-30"))
    assert r.status_code == 422 and "不存在" in r.json()["detail"]
    # 二月三十 exists in lunar 2021 although 2021-02-30 is not a Gregorian date
    ok = client.post("/bazi/chart", json=body(calendar="lunar", birth_date="2021-02-30"))
    assert ok.status_code == 200
    assert client.post("/bazi/chart", json=body(birth_date="2021-02-30")).status_code == 422


def test_unknown_timezone_is_a_422_not_a_500():
    r = client.post("/bazi/chart", json=body(timezone="Mars/Olympus"))
    assert r.status_code == 422


def test_current_period_is_injected_for_determinism():
    req = BaziChartRequest.model_validate(body())
    a = build_chart(req, now_utc=datetime(2026, 10, 2, 9, tzinfo=timezone.utc))
    assert a.current_period.year.year == 2026


def test_strength_factors_are_computed_from_the_rule_base():
    d = client.post("/bazi/chart", json=body()).json()
    trace = d["reasoning_trace"]
    keys = [f["key"] for f in trace["factors"]]
    assert keys == list(Inference().parameters("weights").then["weights"])
    f0 = trace["factors"][0]
    assert f0["rule_id"].startswith("R-DELING-") and f0["quotation"] and f0["chapter"]
    assert all(f["rule_text"] and "→" not in f["rule_text"] for f in trace["factors"])      # each factor carries its rule in everyday words
    assert f0["scale"]["labels"] == ["旺", "相", "休", "囚", "死"] and 0 <= f0["level"] <= 4
    assert trace["factors"][3]["scale"] is None            # 得助 is continuous
    assert trace["fused_score"] == round(sum(f["weighted_score"] for f in trace["factors"]) + trace["baseline"], 4)
    assert d["day_master"]["strength"] == trace["final_strength"] == trace["provisional_strength"]
    assert trace["override"] is None


def test_result_carries_the_rule_base_and_weight_set_versions():
    from bazi.rules import library
    meta = client.post("/bazi/chart", json=body()).json()["meta"]
    assert meta["rule_base"] == library.load().version and meta["weight_set"] == Inference().parameters("weights").then["weight_set"]


def test_every_citation_in_the_response_can_be_checked_against_the_knowledge_base():
    import pytest
    from bazi.research import knowledge
    if not knowledge.available():
        pytest.skip("knowledge base not present")
    d = client.post("/bazi/chart", json=body()).json()
    for f in d["reasoning_trace"]["factors"]:
        assert f["kb_url"] and f["chapter"] and f["quotation"]
        assert knowledge.check(f["kb_url"], f["chapter"], f["quotation"]) == [], f["rule_id"]
