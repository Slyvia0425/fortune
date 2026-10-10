"""T4: GeoNames city lookup and its endpoint."""

import pytest
from fastapi.testclient import TestClient

from app import app
from bazi.geo import cities

client = TestClient(app)


def test_known_cities_have_expected_coordinates():
    sh = cities.search("Shanghai", 1)[0]
    assert (sh.country_code, sh.timezone) == ("CN", "Asia/Shanghai")
    assert sh.latitude == pytest.approx(31.2, abs=0.2)
    assert sh.longitude == pytest.approx(121.5, abs=0.2)
    sg = cities.search("singapore", 1)[0]  # case-insensitive
    assert sg.timezone == "Asia/Singapore"


def test_prefix_matches_rank_before_substring_matches():
    hits = cities.search("york", 25)
    names = [c.name.lower() for c in hits]
    first_contains = next(i for i, n in enumerate(names) if not n.startswith("york"))
    assert all(n.startswith("york") for n in names[:first_contains])


def test_blank_and_unknown_queries_return_nothing():
    assert cities.search("   ") == []
    assert cities.search("zzzzqqqq") == []


def test_every_row_is_in_valid_range():
    all_cities, _ = cities._load()
    assert len(all_cities) > 30000
    for c in all_cities:
        assert -90 <= c.latitude <= 90 and -180 <= c.longitude <= 180, c
        assert len(c.country_code) == 2 and c.timezone, c


def test_endpoint_returns_hits_and_respects_limit():
    r = client.get("/bazi/cities", params={"q": "San", "limit": 3})
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 3
    assert set(body[0]) == {"id", "name", "country_code", "latitude", "longitude", "timezone", "alias"}


@pytest.mark.parametrize("params", [{}, {"q": ""}, {"q": "x", "limit": 0}, {"q": "x", "limit": 99}])
def test_endpoint_rejects_bad_params(params):
    assert client.get("/bazi/cities", params=params).status_code == 422


def test_alternate_spellings_find_the_city():
    # GeoNames files Urumqi as "UEruemqi"; the usual spelling must still find it.
    hits = cities.search_hits("Urumqi", 3)
    assert hits and hits[0].city.timezone == "Asia/Urumqi" and hits[0].alias == "Urumqi"
    assert cities.search_hits("Shanghai", 1)[0].alias is None      # a real name match carries none


def test_endpoint_reports_the_matching_alias():
    body = client.get("/bazi/cities", params={"q": "Urumqi"}).json()
    assert body[0]["alias"] == "Urumqi" and body[0]["name"] != "Urumqi"


def test_name_matches_rank_before_alias_matches():
    hits = cities.search_hits("Mumbai", 10)
    first_alias = next((i for i, h in enumerate(hits) if h.alias), len(hits))
    assert all(h.alias is None for h in hits[:first_alias])


def test_an_exact_name_outranks_longer_names_that_start_with_it():
    # "Van" must not be buried under Vancouver, nor "Taiz" under Taizhou
    assert cities.search("Van", 1)[0].name == "Van"
    assert cities.search("Taiz", 1)[0].name == "Taiz"
