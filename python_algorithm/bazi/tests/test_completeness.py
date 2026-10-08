"""Completeness (proposal section 3): every legal input yields a full chart, and
the manual-coordinates fallback is the route when the city search finds nothing."""

import random

import pytest
from fastapi.testclient import TestClient

from app import app
from bazi.engine import build_chart
from bazi.geo import cities
from bazi.models.bazi import BaziChartRequest

client = TestClient(app)

LATS = (-90, -66.6, -45, 0, 45, 66.6, 89.9, 90)
LONS = (-180, -120, -60, 0, 60, 120, 179.9, 180)


def _manual(lat, lon, **over):
    return dict(birth_date="1999-12-31", birth_time="23:30", gender="female",
                birth_place=dict(latitude=lat, longitude=lon, source="manual_coordinates")) | over


@pytest.mark.parametrize("lat", LATS)
@pytest.mark.parametrize("lon", LONS)
def test_any_legal_coordinate_gives_a_full_chart(lat, lon):
    chart = build_chart(BaziChartRequest.model_validate(_manual(lat, lon)))
    assert len(chart.pillars) == 4 and len(chart.luck_cycles) == 8
    assert chart.resolved_time.timezone                    # open ocean falls back to an Etc/GMT zone
    assert sum(chart.elements.values()) == 8


def test_manual_entry_over_the_api_needs_no_city_or_country():
    r = client.post("/bazi/chart", json=_manual(43.8256, 87.6168))
    assert r.status_code == 200
    d = r.json()
    assert d["resolved_time"]["timezone"] == "Asia/Urumqi"
    assert d["pillars"][3]["branch"]


def test_coordinates_out_of_range_are_rejected_not_guessed():
    assert client.post("/bazi/chart", json=_manual(91, 0)).status_code == 422
    assert client.post("/bazi/chart", json=_manual(0, 181)).status_code == 422


# -------- when to fall back: search must find the city or find nothing
def test_exact_city_names_find_that_city_first():
    all_cities, _ = cities._load()
    wrong = []
    for c in all_cities[:300]:
        top = cities.search(c.name, 1)
        # several cities share a name (London GB / CA); the top hit must at least carry the name
        if not top or top[0].name.lower() != c.name.lower():
            wrong.append(c.name)
    assert not wrong, wrong[:5]


def test_places_that_are_not_in_the_list_return_nothing_so_the_form_offers_coordinates():
    rng = random.Random(4)
    all_cities, _ = cities._load()
    for c in rng.sample(all_cities[:5000], 200):
        assert cities.search(c.name + "qzx", 5) == [], c.name         # never a near-miss city
    assert cities.search("Xqzvkw", 5) == []
