"""Deterministic I Ching casting rules used by the browser API.

Line arrays are always stored bottom-to-top (初爻 to 上爻).  This module has no
web dependency so its rules can be tested and reviewed independently.
"""
from __future__ import annotations

from dataclasses import dataclass
import secrets
from typing import Iterable

TRIGRAMS = {
    7: "乾", 3: "兑", 5: "离", 1: "震",
    6: "巽", 2: "坎", 4: "艮", 0: "坤",
}
TRIGRAM_ORDER = (7, 3, 5, 1, 6, 2, 4, 0)  # 1..8; 8 represents 坤
HEXAGRAMS = {
    (7, 7): (1, "乾"), (0, 0): (2, "坤"), (2, 1): (3, "水雷屯"), (4, 2): (4, "山水蒙"),
    (2, 7): (5, "水天需"), (7, 2): (6, "天水讼"), (0, 2): (7, "地水师"), (2, 0): (8, "水地比"),
    (6, 7): (9, "风天小畜"), (7, 3): (10, "天泽履"), (0, 7): (11, "地天泰"), (7, 0): (12, "天地否"),
    (7, 5): (13, "天火同人"), (5, 7): (14, "火天大有"), (0, 4): (15, "地山谦"), (1, 0): (16, "雷地豫"),
    (3, 1): (17, "泽雷随"), (4, 6): (18, "山风蛊"), (0, 3): (19, "地泽临"), (6, 0): (20, "风地观"),
    (5, 1): (21, "火雷噬嗑"), (4, 5): (22, "山火贲"), (4, 0): (23, "山地剥"), (0, 1): (24, "地雷复"),
    (7, 1): (25, "天雷无妄"), (4, 7): (26, "山天大畜"), (4, 1): (27, "山雷颐"), (3, 6): (28, "泽风大过"),
    (2, 2): (29, "坎为水"), (5, 5): (30, "离为火"), (3, 4): (31, "泽山咸"), (1, 6): (32, "雷风恒"),
    (7, 4): (33, "天山遁"), (1, 7): (34, "雷天大壮"), (5, 0): (35, "火地晋"), (0, 5): (36, "地火明夷"),
    (6, 5): (37, "风火家人"), (5, 3): (38, "火泽睽"), (2, 4): (39, "水山蹇"), (1, 2): (40, "雷水解"),
    (4, 3): (41, "山泽损"), (6, 1): (42, "风雷益"), (3, 7): (43, "泽天夬"), (7, 6): (44, "天风姤"),
    (3, 0): (45, "泽地萃"), (0, 6): (46, "地风升"), (3, 2): (47, "泽水困"), (2, 6): (48, "水风井"),
    (3, 5): (49, "泽火革"), (5, 6): (50, "火风鼎"), (1, 1): (51, "震为雷"), (4, 4): (52, "艮为山"),
    (6, 4): (53, "风山渐"), (1, 3): (54, "雷泽归妹"), (1, 5): (55, "雷火丰"), (5, 4): (56, "火山旅"),
    (6, 6): (57, "巽为风"), (3, 3): (58, "兑为泽"), (6, 2): (59, "风水涣"), (2, 3): (60, "水泽节"),
    (6, 3): (61, "风泽中孚"), (1, 4): (62, "雷山小过"), (2, 5): (63, "水火既济"), (5, 2): (64, "火水未济"),
}


@dataclass(frozen=True)
class Hexagram:
    number: int
    name: str
    upper_trigram: str
    lower_trigram: str
    lines: list[int]

    def as_dict(self) -> dict[str, object]:
        return {"number": self.number, "name": self.name, "upper_trigram": self.upper_trigram, "lower_trigram": self.lower_trigram, "lines": self.lines}


def _trigram_code(lines: Iterable[int]) -> int:
    result = 0
    for index, line in enumerate(lines):
        if line % 2:
            result |= 1 << index
    return result


def _hexagram(lines: list[int]) -> Hexagram:
    if len(lines) != 6 or any(line not in (6, 7, 8, 9) for line in lines):
        raise ValueError("lines must contain six values selected from 6, 7, 8, 9")
    lower, upper = _trigram_code(lines[:3]), _trigram_code(lines[3:])
    number, name = HEXAGRAMS[(upper, lower)]
    return Hexagram(number, name, TRIGRAMS[upper], TRIGRAMS[lower], lines)


def cast_from_numbers(numbers: list[int]) -> list[int]:
    """Map two numbers to upper/lower trigrams and derive a moving line.

    First number: upper trigram; second: lower trigram.  Values use modulo 8,
    where a zero remainder is 坤.  An optional third positive number specifies
    the moving line; otherwise the sum of the first two numbers specifies it.
    """
    if len(numbers) not in (2, 3) or any(not isinstance(number, int) or number <= 0 for number in numbers):
        raise ValueError("numbers casting requires two or three positive integers")
    upper = TRIGRAM_ORDER[(numbers[0] - 1) % 8]
    lower = TRIGRAM_ORDER[(numbers[1] - 1) % 8]
    lines = [7 if lower & (1 << index) else 8 for index in range(3)] + [7 if upper & (1 << index) else 8 for index in range(3)]
    moving_seed = numbers[2] if len(numbers) == 3 else numbers[0] + numbers[1]
    moving_index = (moving_seed - 1) % 6
    lines[moving_index] = 9 if lines[moving_index] == 7 else 6
    return lines


def cast_from_coins(coins: list[list[int]]) -> list[int]:
    if len(coins) != 6 or any(len(toss) != 3 or any(value not in (2, 3) for value in toss) for toss in coins):
        raise ValueError("coins casting requires six groups of three values (2 or 3)")
    return [sum(toss) for toss in coins]


def cast_random() -> list[int]:
    return [sum(secrets.choice((2, 3)) for _ in range(3)) for _ in range(6)]


def calculate(method: str, numbers: list[int] | None = None, coins: list[list[int]] | None = None) -> dict[str, object]:
    if method == "numbers":
        lines = cast_from_numbers(numbers or [])
    elif method == "coins":
        lines = cast_from_coins(coins or [])
    elif method == "random":
        lines = cast_random()
    else:
        raise ValueError("method must be numbers, coins, or random")
    primary = _hexagram(lines)
    moving_lines = [index + 1 for index, line in enumerate(lines) if line in (6, 9)]
    mutual_lines = lines[1:4] + lines[2:5]
    transformed_lines = [(7 if line == 6 else 8 if line == 9 else line) for line in lines]
    transformed = _hexagram(transformed_lines)
    return {
        "primary": primary.as_dict(), "moving_lines": moving_lines, "mutual": _hexagram(mutual_lines).as_dict(), "transformed": transformed.as_dict(),
        "traditional_meaning": "卦象、动爻、互卦与变卦均由固定规则计算；传统释义与出处由知识检索层补充。",
        "contextual_interpretation": "此结果用于传统文化学习与交互演示，不构成现实决策建议。",
    }


def hexagram_catalog() -> list[dict[str, object]]:
    """Return the full 64-hexagram catalog for cross-module search."""
    entries = []
    for (_upper, _lower), (number, name) in HEXAGRAMS.items():
        entries.append(
            {
                "number": number,
                "name": name,
                "description": "《周易》六十四卦之一，可结合典籍检索查看卦辞、彖传与象传。",
            }
        )
    return sorted(entries, key=lambda entry: int(entry["number"]))
