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
        "pillars",
        "elements",
        "luck_cycles",
        "current_period",
        "day_master",
        "ten_gods",
        "disposition",
        "reasoning_trace",
        "advisory",
        "overview",
    ):
        assert key in body, f"missing contract field: {key}"


def test_uses_real_engine_instead_of_mock():
    meta = post().json()["meta"]
    assert meta["mock"] is False
    assert meta["engine_version"], "real responses must identify the engine version"


def test_solar_and_lunar_inputs_agree():
    """2000-01-01 is lunar 1999-11-25; both routes must build the same pillars."""
    solar = post()
    lunar = post({"birth_date": "1999-11-25", "calendar": "lunar", "is_leap_month": False})
    assert solar.status_code == 200
    assert lunar.status_code == 200

    def stem_branches(body):
        return [(pillar["stem"], pillar["branch"]) for pillar in body["pillars"]]

    assert stem_branches(solar.json()) == stem_branches(lunar.json())


def test_known_chart_matches_classical_pillars():
    """Regression for the reported conversion bug: 2000-01-01 12:30 Singapore."""
    body = post().json()
    stem_branches = [(pillar["stem"], pillar["branch"]) for pillar in body["pillars"]]
    assert stem_branches == [
        ("ji", "mao"),
        ("bing", "zi"),
        ("wu", "wu_branch"),
        ("wu", "wu_branch"),
    ]


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


def test_advisory_covers_three_domains():
    domains = [d["domain"] for d in post().json()["advisory"]]
    assert domains == ["career", "study", "wealth"]


def test_every_advisory_category_is_cited():
    """Traceability is the one automatable 1.4 metric; no category may be uncited."""
    for domain in post().json()["advisory"]:
        for category in domain["categories"]:
            assert category["citations"], (
                f"{domain['domain']}/{category['category']} has no citations"
            )


def test_advisory_ranks_are_sequential():
    for domain in post().json()["advisory"]:
        ranks = [c["rank"] for c in domain["categories"]]
        assert ranks == sorted(ranks) == list(range(1, len(ranks) + 1))


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
