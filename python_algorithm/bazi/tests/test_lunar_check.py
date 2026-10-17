"""The form's lunar-date check endpoint."""

from fastapi.testclient import TestClient

from app import app

client = TestClient(app)


def check(date, leap=False):
    return client.get("/bazi/lunar-date", params={"date": date, "leap": leap}).json()


def test_valid_dates_return_the_solar_date():
    assert check("1992-10-13") == {"valid": True, "solar_date": "1992-11-07", "message": None}
    assert check("2020-04-01", leap=True)["solar_date"] == "2020-05-23"


def test_invalid_dates_explain_why():
    leap = check("2021-04-01", leap=True)
    assert leap["valid"] is False and "闰" in leap["message"] and "不存在" in leap["message"]
    assert check("2021-01-30")["valid"] is False       # that month has only 29 days
    assert check("2021-02-30")["valid"] is True        # a real date, though not a Gregorian one
    assert check("2021-13-01")["valid"] is False
    assert check("1500-01-01")["valid"] is False       # outside the supported range


def test_malformed_dates_are_rejected_by_validation():
    assert client.get("/bazi/lunar-date", params={"date": "nope"}).status_code == 422
