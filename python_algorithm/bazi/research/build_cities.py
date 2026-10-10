"""Build data/cities.tsv from a GeoNames cities15000.txt dump

    python bazi/research/build_cities.py path/to/cities15000.txt

Source: https://download.geonames.org/export/dump/cities15000.zip
(cities with population > 15000). Licence CC BY 4.0, see ATTRIBUTION.md.

Kept columns: geonameid, name, country_code, latitude, longitude, timezone,
population, aliases. `name` is GeoNames' ASCII name, i.e. the English display
name; `aliases` are its other Latin-script spellings ('|'-separated), so that a
user typing "Urumqi" finds the city GeoNames files as "UEruemqi".
Sorted by population (desc) so that search ties resolve to the bigger city.
"""

import csv
import re
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "data" / "cities.tsv"
HEADER = ["geonameid", "name", "country_code", "latitude", "longitude", "timezone", "population", "aliases"]
LATIN = re.compile(r"^[A-Za-z][A-Za-z .'\-]*$")


def main(src: str) -> None:
    rows = []
    with open(src, encoding="utf-8", newline="") as f:
        for r in csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            # 0 id, 2 asciiname, 3 alternatenames, 4 lat, 5 lon, 8 country, 14 population, 17 timezone
            aliases = sorted({a for a in r[3].split(",") if LATIN.match(a) and a != r[2]})
            rows.append([r[0], r[2], r[8], r[4], r[5], r[17], r[14], "|".join(aliases)])
    rows.sort(key=lambda r: -int(r[6] or 0))
    with open(OUT, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t", lineterminator="\n")
        w.writerow(HEADER)
        w.writerows(rows)
    print(f"wrote {len(rows)} cities to {OUT}")


if __name__ == "__main__":
    main(sys.argv[1])
