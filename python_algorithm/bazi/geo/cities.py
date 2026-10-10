"""City lookup over the GeoNames table.

English names only for now. Matching is case-insensitive; a name that starts
with the query ranks above one that merely contains it, and within each group
the larger city comes first (the file is pre-sorted by population).
"""

import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data" / "cities.tsv"


@dataclass(frozen=True)
class City:
    id: str
    name: str
    country_code: str
    latitude: float
    longitude: float
    timezone: str
    population: int
    aliases: tuple[str, ...] = ()


@dataclass(frozen=True)
class Hit:
    city: City
    alias: str | None  # the other spelling that matched, when the main name did not


@lru_cache(maxsize=1)
def _load() -> tuple[tuple[City, ...], tuple[str, ...]]:
    with open(DATA, encoding="utf-8", newline="") as f:
        cities = tuple(
            City(r["geonameid"], r["name"], r["country_code"], float(r["latitude"]),
                 float(r["longitude"]), r["timezone"], int(r["population"] or 0),
                 tuple(a for a in r["aliases"].split("|") if a))
            for r in csv.DictReader(f, delimiter="\t")
        )
    return cities, tuple(c.name.lower() for c in cities)


def search_hits(query: str, limit: int = 10) -> list[Hit]:
    """Ranked: the name is exactly the query, the name starts with it, an alias
    starts with it, the name contains it, an alias contains it. Larger cities
    first inside each group (the file is sorted by population)."""
    q = query.strip().lower()
    if not q:
        return []
    cities, lowered = _load()
    tiers: list[list[Hit]] = [[], [], [], [], []]
    for city, name in zip(cities, lowered):
        if name == q:
            tiers[0].append(Hit(city, None))
        elif name.startswith(q):
            tiers[1].append(Hit(city, None))
        elif q in name:
            tiers[3].append(Hit(city, None))
        else:
            alias_start = alias_in = None
            for a in city.aliases:
                la = a.lower()
                if la.startswith(q):
                    alias_start = a
                    break
                if alias_in is None and q in la:
                    alias_in = a
            if alias_start:
                tiers[2].append(Hit(city, alias_start))
            elif alias_in:
                tiers[4].append(Hit(city, alias_in))
    return [h for tier in tiers for h in tier][:limit]


def search(query: str, limit: int = 10) -> list[City]:
    return [h.city for h in search_hits(query, limit)]
