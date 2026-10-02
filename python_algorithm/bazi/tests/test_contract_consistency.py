"""Cross-language contract consistency.

TypeScript checks its own two files against each other for free: `display.ts`
declares its maps as `Record<TenGod, string>`, so a value added to the union in
`bazi.ts` without a matching label fails the build.

Nothing does that across the language boundary. If Python grows a pattern the
TypeScript union doesn't have, both sides pass their own checks and the
frontend silently renders `undefined` when that value first appears. These
tests are the only thing standing between that and production.

Run from python_algorithm/; skipped automatically if the frontend isn't alongside
(e.g. when the service is checked out on its own).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from bazi.models.enums import (
    ArbitrationOutcome,
    DerivationMethod,
    DISPLAY_ARBITRATION,
    DISPLAY_LUCK_DIRECTION,
    DISPLAY_BRANCH,
    DISPLAY_METHOD,
    DISPLAY_ELEMENT,
    DISPLAY_PATTERN,
    DISPLAY_PILLAR,
    DISPLAY_STEM,
    DISPLAY_STRENGTH,
    DISPLAY_TEN_GOD,
    DayMasterStrength,
    DISPLAY_SOLAR_TERM,
    EarthlyBranch,
    ElementKey,
    HeavenlyStem,
    LuckDirection,
    SolarTerm,
    SpecialPattern,
    TenGod,
)

# python_algorithm/bazi/tests/<this file> → four levels up is the repo root.
REPO_ROOT = Path(__file__).resolve().parents[3]
CONTRACT_TS = REPO_ROOT / "lib" / "contracts" / "bazi.ts"
DISPLAY_TS = REPO_ROOT / "lib" / "bazi" / "display.ts"

pytestmark = pytest.mark.skipif(
    not CONTRACT_TS.exists(),
    reason="frontend contract not present; run from a full checkout",
)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def ts_union(name: str) -> set[str]:
    """Pull the string literals out of `export type <name> = "a" | "b";`."""
    source = _read(CONTRACT_TS)
    match = re.search(rf"export type {name}\s*=(.*?);", source, re.DOTALL)
    assert match, f"{name} not found in {CONTRACT_TS.name}"
    return set(re.findall(r'"([^"]+)"', match.group(1)))


def ts_record(name: str) -> dict[str, str]:
    """Pull the key/value pairs out of `export const <name>: Record<...> = {...};`."""
    source = _read(DISPLAY_TS)
    match = re.search(rf"export const {name}\s*:[^=]*=\s*\{{(.*?)\n\}};", source, re.DOTALL)
    assert match, f"{name} not found in {DISPLAY_TS.name}"
    return dict(re.findall(r'(\w+)\s*:\s*"([^"]*)"', match.group(1)))


def assert_same(label: str, ts: set[str], py: set[str]) -> None:
    only_ts = ts - py
    only_py = py - ts
    assert not (only_ts or only_py), (
        f"{label} has drifted — "
        f"only in bazi.ts: {sorted(only_ts) or 'none'}; "
        f"only in enums.py: {sorted(only_py) or 'none'}"
    )


# ------------------------------------------------------------------ #
# Closed sets: the union in bazi.ts vs the enum in enums.py           #
# ------------------------------------------------------------------ #


@pytest.mark.parametrize(
    "type_name,enum_cls",
    [
        ("ElementKey", ElementKey),
        ("HeavenlyStem", HeavenlyStem),
        ("EarthlyBranch", EarthlyBranch),
        ("TenGod", TenGod),
        ("DayMasterStrength", DayMasterStrength),
        ("SpecialPattern", SpecialPattern),
        ("SolarTerm", SolarTerm),
        ("DerivationMethod", DerivationMethod),
        ("ArbitrationOutcome", ArbitrationOutcome),
        ("LuckDirection", LuckDirection),
    ],
)
def test_enum_values_match(type_name, enum_cls):
    assert_same(type_name, ts_union(type_name), {member.value for member in enum_cls})


# ------------------------------------------------------------------ #
# Chinese display names: display.ts vs the DISPLAY_* maps in enums.py #
# ------------------------------------------------------------------ #

DISPLAY_PAIRS = [
    ("STEM_LABEL", DISPLAY_STEM),
    ("BRANCH_LABEL", DISPLAY_BRANCH),
    ("ELEMENT_LABEL", DISPLAY_ELEMENT),
    ("TEN_GOD_LABEL", DISPLAY_TEN_GOD),
    ("STRENGTH_LABEL", DISPLAY_STRENGTH),
    ("PATTERN_LABEL", DISPLAY_PATTERN),
    ("PILLAR_LABEL", DISPLAY_PILLAR),
    ("SOLAR_TERM_LABEL", DISPLAY_SOLAR_TERM),
    ("METHOD_LABEL", DISPLAY_METHOD),
    ("ARBITRATION_LABEL", DISPLAY_ARBITRATION),
    ("LUCK_DIRECTION_LABEL", DISPLAY_LUCK_DIRECTION),
]


@pytest.mark.parametrize("ts_name,py_map", DISPLAY_PAIRS)
def test_display_keys_match(ts_name, py_map):
    py_keys = {member.value for member in py_map}
    assert_same(f"{ts_name} keys", set(ts_record(ts_name)), py_keys)


@pytest.mark.parametrize("ts_name,py_map", DISPLAY_PAIRS)
def test_display_labels_match(ts_name, py_map):
    """Same key rendering differently on each side is a visible inconsistency."""
    ts_labels = ts_record(ts_name)
    for member, chinese in py_map.items():
        assert ts_labels[member.value] == chinese, (
            f"{ts_name}[{member.value}] is {ts_labels[member.value]!r} in display.ts "
            f"but {chinese!r} in enums.py"
        )
