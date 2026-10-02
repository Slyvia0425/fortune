"""T1 contract tests.

These assert the shape of the response, not the correctness of any value —
there is nothing correct to assert yet. They exist so that when the real
engine lands, any accidental contract drift fails loudly.
"""

from fastapi.testclient import TestClient

# The combined service in python_algorithm/app.py, with the bazi router
# mounted — testing it here also proves the router is actually wired in.
from app import app

client = TestClient(app)

VALID_REQUEST = {
    "birth_date": "2000-01-01",
    "birth_time": "12:30",
    "birth_place": {
        "country_code": "SG",
        "country": "Singapore",
        "city": "Singapore",
        "latitude": 1.3521,
        "longitude": 103.8198,
        "source": "dropdown",
    },
    "gender": "unspecified",
    "calendar": "solar",
}


def post(overrides: dict | None = None):
    payload = {**VALID_REQUEST, **(overrides or {})}
    return client.post("/bazi/chart", json=payload)


# ------------------------------------------------------------------ #
# Happy path                                                          #
# ------------------------------------------------------------------ #


def test_returns_every_contract_section():
    body = post().json()
    for key in (
        "resolved_time",
        "solar_term",
        "pillars",
        "elements",
        "luck_onset",
        "luck_cycles",
        "current_period",
        "day_master",
        "ten_gods",
        "disposition",
        "derivation",
        "reasoning_trace",
        "domain_tallies",
        "overview",
    ):
        assert key in body, f"missing contract field: {key}"


def test_flagged_as_mock():
    meta = post().json()["meta"]
    assert meta["mock"] is True
    assert meta["warnings"], "mock responses must carry a warning"


def test_four_pillars_in_order():
    pillars = post().json()["pillars"]
    assert [p["label"] for p in pillars] == ["year", "month", "day", "hour"]


def test_day_pillar_ten_god_is_explicit_null():
    """The day master has no ten-god relation to itself.

    The key must be present and null — not absent — or TypeScript consumers
    see `undefined` where the contract promises `TenGod | null`.
    """
    day = next(p for p in post().json()["pillars"] if p["label"] == "day")
    assert "ten_god" in day
    assert day["ten_god"] is None


def test_every_branch_carries_hidden_stems():
    """Hidden stems feed the 1.2 weighting; an empty list would silently zero it."""
    for pillar in post().json()["pillars"]:
        assert pillar["hidden_stems"], f"{pillar['label']} has no hidden stems"


def test_elements_cover_all_five():
    elements = post().json()["elements"]
    assert set(elements) == {"wood", "fire", "earth", "metal", "water"}


def test_reasoning_trace_has_all_four_factors():
    trace = post().json()["reasoning_trace"]
    assert {f["key"] for f in trace["factors"]} == {
        "seasonal_command",
        "rootedness",
        "revealed_support",
        "assisting_support",
    }


def test_fused_score_matches_weighted_sum():
    """Guards against a trace that displays numbers which don't add up."""
    trace = post().json()["reasoning_trace"]
    total = sum(f["weighted_score"] for f in trace["factors"])
    assert abs(total - trace["fused_score"]) < 1e-6





def test_luck_cycles_do_not_overlap():
    cycles = post().json()["luck_cycles"]
    for earlier, later in zip(cycles, cycles[1:]):
        assert earlier["end_age"] < later["start_age"]
        assert earlier["end_year"] < later["start_year"]


# ------------------------------------------------------------------ #
# Request validation                                                  #
# ------------------------------------------------------------------ #


def test_rejects_bad_time_format():
    assert post({"birth_time": "25:00"}).status_code == 422
    assert post({"birth_time": "9:5"}).status_code == 422


def test_rejects_bad_date_format():
    assert post({"birth_date": "01/01/2000"}).status_code == 422


def test_rejects_out_of_range_coordinates():
    bad = {**VALID_REQUEST["birth_place"], "latitude": 91.0}
    assert post({"birth_place": bad}).status_code == 422


def test_rejects_unknown_field():
    """extra=forbid, so contract drift surfaces here rather than in production."""
    assert post({"lucky_number": 7}).status_code == 422


def test_accepts_manual_coordinates_without_city():
    """The fallback path: user's city isn't in the dropdown."""
    response = post(
        {
            "birth_place": {
                "latitude": 31.2304,
                "longitude": 121.4737,
                "source": "manual_coordinates",
            }
        }
    )
    assert response.status_code == 200


def test_calendar_defaults_to_solar():
    payload = {k: v for k, v in VALID_REQUEST.items() if k != "calendar"}
    assert client.post("/bazi/chart", json=payload).status_code == 200


def test_accepts_lunar_input():
    response = post({"calendar": "lunar", "is_leap_month": False})
    assert response.status_code == 200


def test_rejects_impossible_calendar_date():
    """Regex alone would accept 2000-02-31; app/api/bazi/chart/route.ts
    applies the same check, so the two layers must agree."""
    assert post({"birth_date": "2000-02-31"}).status_code == 422
    assert post({"birth_date": "2001-02-29"}).status_code == 422


def test_accepts_leap_day():
    assert post({"birth_date": "2000-02-29"}).status_code == 200


def test_carries_source_references():
    """Forwarded into ApiEnvelope.source_refs; an uncited chart is a defect."""
    body = post().json()
    assert body["source_refs"], "result must cite its classical sources"
    for ref in body["source_refs"]:
        assert ref["source_id"] and ref["title"]


def test_reasoning_trace_cites_its_rules():
    assert post().json()["reasoning_trace"]["sources"]



def test_solar_term_position_is_present():
    """1.2's climate branch keys off the term, so 1.1 must supply it."""
    term = post().json()["solar_term"]
    for key in ("current_term", "next_term", "month_term", "days_since_term",
                "days_to_next_term", "near_boundary"):
        assert key in term


def test_month_term_opens_a_month_pillar():
    """The month pillar is set by a 节, never by a 中气."""
    from bazi.models.enums import JIE_TERMS, SolarTerm

    term = post().json()["solar_term"]
    assert SolarTerm(term["month_term"]) in JIE_TERMS


def test_term_window_is_consistent():
    """Elapsed and remaining days should span a plausible term (~15 days)."""
    term = post().json()["solar_term"]
    assert term["days_since_term"] >= 0
    assert term["days_to_next_term"] >= 0
    span = term["days_since_term"] + term["days_to_next_term"]
    assert 13 <= span <= 17, f"term span {span} days is not plausible"



def test_factor_rules_resolve_to_a_source():
    """A rule id with no matching source_ref is a broken trace, not a citation."""
    body = post().json()
    known = {ref["source_id"] for ref in body["source_refs"]}
    for factor in body["reasoning_trace"]["factors"]:
        if factor.get("source_id"):
            assert factor["source_id"] in known, (
                f"factor {factor['key']} cites {factor['source_id']}, which is not in source_refs"
            )
        if factor.get("rule_id"):
            assert factor["rule_id"].strip(), "rule_id must not be blank"



def test_derivation_runs_both_methods():
    """Both chains must report, even when they agree — a silent method is
    exactly what the existing tools do."""
    methods = post().json()["derivation"]["methods"]
    assert {m["method"] for m in methods} == {"supporting", "climatic"}
    for method in methods:
        assert method["basis"].strip(), "每种方法都要说明它依据了什么"
        assert method["useful"], "每种方法都要给出用神"


def test_arbitration_is_recorded():
    arbitration = post().json()["derivation"]["arbitration"]
    assert isinstance(arbitration["conflict"], bool)
    assert arbitration["outcome"] in {"agree", "supporting", "climatic", "both", "other"}
    assert arbitration["rationale"].strip()


def test_arbitration_outcome_matches_conflict_flag():
    """agree and a conflict flag contradict each other; a conflict needs a rule."""
    arbitration = post().json()["derivation"]["arbitration"]
    if arbitration["conflict"]:
        assert arbitration["outcome"] != "agree"
        assert arbitration.get("rule_id"), "冲突时必须说明依据哪条优先规则裁决"
    else:
        assert arbitration["outcome"] == "agree"


def test_derivation_citations_resolve():
    body = post().json()
    known = {ref["source_id"] for ref in body["source_refs"]}
    entries = body["derivation"]["methods"] + [body["derivation"]["arbitration"]]
    for entry in entries:
        if entry.get("source_id"):
            assert entry["source_id"] in known


def test_final_disposition_follows_the_adopted_method():
    """The headline useful gods must match whichever method arbitration adopted,
    otherwise the trace explains one thing and the page shows another."""
    body = post().json()
    derivation = body["derivation"]
    outcome = derivation["arbitration"]["outcome"]
    if outcome in {"supporting", "climatic"}:
        adopted = next(m for m in derivation["methods"] if m["method"] == outcome)
        assert set(body["disposition"]["useful"]) == set(adopted["useful"])



def test_luck_onset_is_reported():
    """起运年龄与顺逆排是 1.1 中真正有算法的一步，必须给出，并说明推导。"""
    onset = post().json()["luck_onset"]
    assert onset["direction"] in {"forward", "reverse"}
    assert onset["years"] >= 0 and 0 <= onset["months"] < 12
    assert onset["rationale"].strip()


def test_luck_cycles_span_a_working_lifetime():
    """三步大运只覆盖到 32 岁，成年人看不到自己所处的一步。"""
    cycles = post().json()["luck_cycles"]
    assert len(cycles) >= 6
    assert cycles[-1]["end_age"] >= 60


def test_first_luck_cycle_starts_at_onset():
    body = post().json()
    assert body["luck_cycles"][0]["start_age"] == body["luck_onset"]["years"]


def test_domain_tallies_cover_three_domains():
    domains = [d["domain"] for d in post().json()["domain_tallies"]]
    assert domains == ["career", "study", "wealth"]


def test_tallies_carry_no_score_or_rank():
    """计分与排序已移除：典籍未给出组间高下，跨领域的分数也不可比。"""
    for domain in post().json()["domain_tallies"]:
        for group in domain["groups"]:
            assert "fit_score" not in group and "rank" not in group


def test_tally_count_matches_occurrences():
    """数量必须等于实际列出的位置，否则用户无从核对。"""
    for domain in post().json()["domain_tallies"]:
        for group in domain["groups"]:
            assert group["count"] == len(group["occurrences"])


def test_tally_groups_are_glossed_and_citations_resolve():
    body = post().json()
    known = {ref["source_id"] for ref in body["source_refs"]}
    for domain in body["domain_tallies"]:
        assert domain["groups"], f"{domain['domain']} 未列出任何十神组"
        for group in domain["groups"]:
            assert group["gloss"].strip(), f"{group['group']} 缺少典籍语汇"
            if group.get("quotation"):
                assert group.get("source_id") in known
            else:
                assert not group.get("source_id"), "无引文却标了出处，属于假托"


def test_zero_count_groups_are_kept():
    """数量为零的组照常列出：命中无财、无比劫本身就是命局的特征。"""
    groups = [g for d in post().json()["domain_tallies"] for g in d["groups"]]
    assert any(g["count"] == 0 for g in groups)



def test_domain_group_narrative_restates_only_what_the_row_holds():
    """白话说明是转述，不是新论断：出现次数与用忌状态都必须与本行一致。"""
    for tally in post().json()["domain_tallies"]:
        for group in tally["groups"]:
            text = group["narrative"]
            assert text.strip(), f"{group['group']} 缺少白话说明"
            if group["count"] == 0:
                assert "未见" in text
            else:
                assert str(group["count"]) in text
                if group["disposition"] == "useful":
                    assert "用神" in text and "忌神" not in text
                elif group["disposition"] == "unfavourable":
                    assert "忌神" in text
