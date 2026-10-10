"""Exact-match harness: compare an engine against the reference.

Accuracy is per chart: a chart passes only if all four pillars match, so one
wrong pillar scores zero for that chart. The target is 100%; anything lower is
a bug, not a score.

    from bazi.validation.harness import evaluate
    report = evaluate(my_engine, n=5000)   # my_engine(datetime) -> Pillars
    assert report.accuracy == 1.0, report.summary()
"""

import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable, Iterable, Iterator

from bazi.validation.reference import Pillars, reference_pillars

Engine = Callable[[datetime], Pillars]

YEAR_RANGE = (1900, 2100)


def random_moments(n: int, seed: int = 20260101,
                   years: tuple[int, int] = YEAR_RANGE) -> Iterator[datetime]:
    """Reproducible minute-resolution moments spread over the year range."""
    rng = random.Random(seed)
    start = datetime(years[0], 1, 1)
    minutes = int((datetime(years[1], 12, 31, 23, 59) - start).total_seconds() // 60)
    for _ in range(n):
        yield start + timedelta(minutes=rng.randrange(minutes + 1))


@dataclass
class Mismatch:
    when: datetime
    expected: Pillars
    got: Pillars

    def __str__(self) -> str:
        bad = [n for n, e, g in zip(Pillars._fields, self.expected, self.got) if e != g]
        return f"{self.when:%Y-%m-%d %H:%M}  expected {self.expected}  got {self.got}  ({'/'.join(bad)})"


@dataclass
class Report:
    total: int = 0
    passed: int = 0
    mismatches: list[Mismatch] = field(default_factory=list)

    @property
    def accuracy(self) -> float:
        return self.passed / self.total if self.total else 0.0

    def summary(self, limit: int = 10) -> str:
        head = f"exact-match {self.passed}/{self.total} = {self.accuracy:.4%}"
        return "\n".join([head, *map(str, self.mismatches[:limit])])


def evaluate(engine: Engine, moments: Iterable[datetime] | None = None,
             n: int = 2000, seed: int = 20260101) -> Report:
    report = Report()
    for when in (moments if moments is not None else random_moments(n, seed)):
        expected = reference_pillars(when)
        got = engine(when)
        report.total += 1
        if got == expected:
            report.passed += 1
        else:
            report.mismatches.append(Mismatch(when, expected, got))
    return report
