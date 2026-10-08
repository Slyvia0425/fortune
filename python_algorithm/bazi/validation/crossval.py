"""Full-path cross-validation against lunar-python (task T12).

    python -m bazi.validation.crossval --n 5000

Each trial is a random birth (minute resolution, 1900-2100) at a random city
with that city's IANA zone. The engine under test is resolve_birth, i.e. zone
offset -> CST -> true solar time -> pillars. The oracle is lunar-python read on
the clocks the rules prescribe:

    year, month  <- oracle(CST instant)          CST from zoneinfo's own UTC math
    day,  hour   <- oracle(true solar time)      the engine's true solar time is
                                                 fed in, so this checks the pillar
                                                 and clock logic, not the equation
                                                 of time (checked against almanac
                                                 values in test_solar_time.py)

Score = exact match per chart (all four pillars). A birth within TERM_WINDOW
seconds of a solar term is excluded from the score and counted separately: our
term instants differ from lunar-python's by up to ~20 s (see calc/terms.py), so
such a chart is not a defect either way.
"""

import argparse
import csv
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from bazi.calc import terms
from bazi.calc.resolve import resolve_birth
from bazi.geo import cities
from bazi.validation.reference import reference_pillars

CST = timezone(timedelta(hours=8))
TERM_WINDOW = 90  # seconds
YEARS = (1900, 2100)


@dataclass
class Case:
    civil: datetime
    city: cities.City

    def __str__(self) -> str:
        return f"{self.civil:%Y-%m-%d %H:%M} {self.city.name}/{self.city.country_code} ({self.city.timezone})"


@dataclass
class Result:
    total: int = 0
    scored: int = 0
    passed: int = 0
    near_term: int = 0
    failures: list = field(default_factory=list)
    by_zone: dict = field(default_factory=dict)

    @property
    def accuracy(self) -> float:
        return self.passed / self.scored if self.scored else 0.0

    def summary(self, limit: int = 8) -> str:
        lines = [f"trials {self.total}; excluded near a solar term {self.near_term}; "
                 f"exact-match {self.passed}/{self.scored} = {self.accuracy:.4%}"]
        lines += [f"  FAIL {c}: ours {a}  oracle {b}" for c, a, b in self.failures[:limit]]
        return "\n".join(lines)


def sample_cases(n: int, seed: int = 20260101, pool: int = 4000) -> list[Case]:
    rng = random.Random(seed)
    all_cities, _ = cities._load()
    top = all_cities[:pool]                                   # sorted by population
    start = datetime(YEARS[0], 1, 1)
    minutes = int((datetime(YEARS[1], 12, 31, 23, 59) - start).total_seconds() // 60)
    return [Case(start + timedelta(minutes=rng.randrange(minutes + 1)), rng.choice(top))
            for _ in range(n)]


def oracle_for(case: Case, solar: datetime):
    aware = case.civil.replace(tzinfo=ZoneInfo(case.city.timezone), fold=0)
    cst = aware.astimezone(CST).replace(tzinfo=None)
    by_cst, by_solar = reference_pillars(cst), reference_pillars(solar)
    return cst, (by_cst.year, by_cst.month, by_solar.day, by_solar.hour)


def run(cases: list[Case]) -> Result:
    res = Result()
    for case in cases:
        res.total += 1
        r = resolve_birth(case.civil, case.city.latitude, case.city.longitude, case.city.timezone)
        cst, expected = oracle_for(case, r.true_solar)
        (_, _, t0), (_, _, t1) = terms.terms_around(cst)
        if min((cst - t0).total_seconds(), (t1 - cst).total_seconds()) < TERM_WINDOW:
            res.near_term += 1
            continue
        res.scored += 1
        if tuple(r.pillars) == expected:
            res.passed += 1
        else:
            res.failures.append((case, " ".join(r.pillars), " ".join(expected)))
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=5000)
    ap.add_argument("--seed", type=int, default=20260101)
    args = ap.parse_args()
    print(run(sample_cases(args.n, args.seed)).summary(limit=20))


if __name__ == "__main__":
    main()
