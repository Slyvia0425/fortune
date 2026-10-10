"""Builds the basic-knowledge data files (bazi/data/basics/*.json) from the project knowledge base.

The files are not written by hand: each fact is parsed out of the original text held in
data/knowledge_sources_complete, and carries where it came from (page, chapter, the verbatim stretch it was read
from). What the knowledge base does not hold at all (the year and day anchors of the sixty-cycle, the hour the day
changes, how many luck cycles are shown, the one place the qi order departs from the 司令 days) is kept apart in
`conventions.json`, which is written by hand and says why.

    python -m bazi.research.build_basics            # rewrite the files
    python -m bazi.research.build_basics --check    # fail if the files differ from what the knowledge base yields

The readers in this package (stems_branches, elements, ...) load the generated files and nothing else.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Tuple

from bazi.models.enums import EarthlyBranch, HeavenlyStem, SolarTerm, TenGod
from bazi.research import knowledge

DATA = Path(__file__).resolve().parent.parent / "data" / "basics"

# where the facts are read from (knowledge-base page urls)
SANMING = "https://ctext.org/wiki.pl?if=en&chapter=17423"            # 三命通会 卷二
YUANHAI = "https://ctext.org/wiki.pl?if=en&chapter=296619"           # 渊海子平 第1部分
FENYE = "https://luckclub.cn/bazi/002/005/"                          # 子平真诠评注 论阴阳生死 (十二月令人元司令分野表)
SHENGKE = "https://luckclub.cn/bazi/002/004/"                        # 子平真诠评注 论阴阳生克

ELEMENT = {"木": "wood", "火": "fire", "土": "earth", "金": "metal", "水": "water"}
TEN_GOD_NAMES = {"比肩": TenGod.FRIEND, "劫財": TenGod.ROB_WEALTH, "食神": TenGod.EATING_GOD, "傷官": TenGod.HURTING_OFFICER,
                 "偏財": TenGod.INDIRECT_WEALTH, "正財": TenGod.DIRECT_WEALTH, "偏官": TenGod.SEVEN_KILLINGS,
                 "正官": TenGod.DIRECT_OFFICER, "倒食": TenGod.INDIRECT_RESOURCE, "印綬": TenGod.DIRECT_RESOURCE}
RELATION_ORDER = ["same_element", "dm_generates", "dm_controls", "controls_dm", "generates_dm"]
STEMS_ZH = "甲乙丙丁戊己庚辛壬癸"
BRANCHES_ZH = "子丑寅卯辰巳午未申酉戌亥"
_CN = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


class BuildError(RuntimeError):
    pass


def _text(url: str) -> Tuple[str, str]:
    page = knowledge.page(url)
    if page is None:
        raise BuildError(f"knowledge-base page not found: {url}")
    return page.text(), page.title                 # the classical text and its old commentary, not the modern translation


def _book(url: str) -> str:
    """The book a page belongs to: the third level of its catalog path (明清 -> 八字命理 -> 三命通会 -> 卷二)."""
    page = knowledge.page(url)
    parts = page.catalog.split(" -> ")
    return parts[2] if len(parts) > 2 else page.title


def _src(url: str, title: str, quotation: str) -> dict:
    return {"kb_url": url, "book": _book(url), "chapter": title, "quotation": quotation}


def cn_number(s: str) -> int:
    """Chinese numerals up to the thousands: 七, 十六, 二十, 三百六十, 三千六百."""
    total, current = 0, 0
    for ch in s:
        if ch in _CN:
            current = _CN[ch]
        elif ch == "十":
            total += (current or 1) * 10
            current = 0
        elif ch == "百":
            total += current * 100
            current = 0
        elif ch == "千":
            total += current * 1000
            current = 0
        else:
            raise BuildError(f"not a numeral: {s!r}")
    return total + current


def _conventions() -> dict:
    return json.loads((DATA / "conventions.json").read_text(encoding="utf-8"))


# ------------------------------------------------------------------ stems, branches, elements
def parse_stem_element_yang() -> Tuple[Dict[str, dict], Dict[str, str], List[dict]]:
    """三命通会 论十干合: 「東方甲乙木畏西方庚辛金克。甲屬陽為兄,乙屬陰為妹...」 — the element of every stem, its polarity,
    and (from 畏...克) which element controls which."""
    text, title = _text(SANMING)
    stems, controls, src = {}, {}, []
    pat = re.compile(r"(?:東方|南方|中央|西方|北方)([甲乙丙丁戊己庚辛壬癸])([甲乙丙丁戊己庚辛壬癸])([木火土金水])畏(?:東方|南方|中央|西方|北方)([甲乙丙丁戊己庚辛壬癸])([甲乙丙丁戊己庚辛壬癸])([木火土金水])克。"
                     r"([甲乙丙丁戊己庚辛壬癸])屬?陽為兄,([甲乙丙丁戊己庚辛壬癸])屬陰為妹")
    for m in pat.finditer(text):
        yang_stem, yin_stem, element, _, _, controller = m.group(1), m.group(2), ELEMENT[m.group(3)], m.group(4), m.group(5), ELEMENT[m.group(6)]
        if (m.group(7), m.group(8)) != (yang_stem, yin_stem):
            raise BuildError(f"inconsistent pair in 论十干合: {m.group(0)}")
        stems[yang_stem] = {"element": element, "yang": True}
        stems[yin_stem] = {"element": element, "yang": False}
        controls[controller] = element                        # 木畏金克: 金 controls 木
        src.append(_src(SANMING, title, m.group(0)))
    if len(stems) != 10 or len(controls) != 5:
        raise BuildError(f"expected 10 stems and 5 controls from 论十干合, found {len(stems)} and {len(controls)}")
    return stems, controls, src


def parse_generates() -> Tuple[Dict[str, str], dict]:
    text, title = _text(SHENGKE)
    m = re.search(r"木生火,火生土,土生金,金生水,水复生木", text)
    if not m:
        raise BuildError("generating cycle not found in 论阴阳生克")
    chain = [ELEMENT[c] for c in "木火土金水"]
    return {chain[i]: chain[(i + 1) % 5] for i in range(5)}, _src(SHENGKE, title, m.group(0))


def _song() -> Tuple[List[Tuple[str, str]], str, str]:
    """The hidden-stem song of 渊海子平: [(branch, stems in the order the song names them)]."""
    text, title = _text(YUANHAI)
    start = text.index("子宮癸水在其中")
    end = text.index("。", text.index("亥藏壬甲"))
    verse = text[start:end + 1]
    clauses = [c for c in re.split(r"[;,，。;]", verse) if c]
    if len(clauses) != 12:
        raise BuildError(f"the song should have 12 clauses, has {len(clauses)}")
    return [(c[0], "".join(ch for ch in c[1:] if ch in STEMS_ZH)) for c in clauses], title, verse


def build_stems_branches() -> dict:
    stems, controls, src = parse_stem_element_yang()
    text, title = _text(YUANHAI)
    yang_block = text[text.index("五干屬陽"):text.index("五干屬陰")]
    order = re.findall(r"見([甲乙丙丁戊己庚辛壬癸]):為", yang_block)
    song, song_title, verse = _song()
    branch_order = "".join(b for b, _ in song)
    if "".join(order) != STEMS_ZH or branch_order != BRANCHES_ZH:
        raise BuildError(f"stem or branch order in 渊海子平 is not the sixty-cycle's: {order} {branch_order}")
    if len(HeavenlyStem) != 10 or len(EarthlyBranch) != 12:
        raise BuildError("the contract enums are not ten stems and twelve branches")
    return {
        "note": "天干地支的顺序取自《渊海子平》（见甲、见乙…的次序；又地支藏遁歌的次序），五行与阴阳取自《三命通会》论十干合。key 与契约枚举按位置对应。",
        "stems": [{"zh": z, "key": k.value, "element": stems[z]["element"], "yang": stems[z]["yang"]}
                  for z, k in zip(order, HeavenlyStem)],
        "branches": [{"zh": z, "key": k.value} for z, k in zip(branch_order, EarthlyBranch)],
        "sources": src + [_src(YUANHAI, title, yang_block[:48]),
                          _src(YUANHAI, song_title, verse)],
    }


def build_elements() -> dict:
    generates, g_src = parse_generates()
    _, controls, src = parse_stem_element_yang()
    return {
        "note": "五行相生取自《子平真诠评注》论阴阳生克；相克取自《三命通会》论十干合（「木畏金克」即金克木）。"
                "1.1 排盘独立于 1.2 规则库，故自带一份；test_rules_data 保证与规则库 R-SHENG-01、R-KE-01 逐项一致。",
        "generates": generates,
        "controls": controls,
        "sources": [g_src] + src,
    }


# ------------------------------------------------------------------ hidden stems
def parse_fenye_days() -> Tuple[Dict[str, Dict[str, int]], List[Tuple[str, str, str]], str, str]:
    """十二月令人元司令分野表: for each month the days each stem rules, and the two terms of the month."""
    text, title = _text(FENYE)
    days, terms = {}, []
    line = re.compile(r"^([子丑寅卯辰巳午未申酉戌亥])月\s+\S+?后(.+?)\s+(\S+)\s+(\S+)\s*$", re.M)
    for m in line.finditer(text):
        per = {}
        for item in m.group(2).split(","):
            g = re.fullmatch(r"([甲乙丙丁戊己庚辛壬癸]+)[木火土金水]([一二三四五六七八九十]+)日", item.strip())
            if not g:
                raise BuildError(f"cannot read {item!r} in 分野表")
            for stem in g.group(1):
                per[stem] = cn_number(g.group(2))
        days[m.group(1)] = per
        terms.append((m.group(1), m.group(3), m.group(4)))
    if len(days) != 12:
        raise BuildError(f"分野表 should list 12 months, found {len(days)}")
    return days, terms, title, text[text.index("十二月令人元司令分野表"):text.index("按此表人元司令日数")].strip()


def build_hidden_stems() -> dict:
    song, song_title, verse = _song()
    days, _, fenye_title, table_text = parse_fenye_days()
    override = _conventions()["hidden_stem_order_override"]
    table = {}
    for branch, stems in song:
        if not set(stems) <= set(days[branch]):
            raise BuildError(f"{branch}: the song names stems the 分野表 does not: {stems} vs {sorted(days[branch])}")
        ordered = "".join(sorted(stems, key=lambda s: -days[branch][s]))          # stable: ties keep the song's order
        if branch in override:
            if set(override[branch]["order"]) != set(ordered):
                raise BuildError(f"override for {branch} changes the stems, not just their order")
            ordered = override[branch]["order"]
        table[branch] = ordered
    return {
        "convention": "yuanhai",
        "note": "地支藏干：藏哪几个干取自《渊海子平》又地支藏遁歌；本气、中气、余气的次序按《子平真诠评注》十二月令人元司令分野表里"
                "各干当令的日数由多到少（同日数按歌诀次序）。申的次序是一处例外，见 conventions.json。"
                "口径定案于 2026-10-08：《渊海子平》歌诀（通行说法，lunar-python 与万年历亦同；任铁樵书中写作午中己土、亥中甲，与之一致）。"
                "已知分歧：分野表本身子=癸壬、午=丁丙己、亥=壬戊甲、申=庚戊己壬；徐乐吾《论用神变化》自述子午卯酉单气、亥=壬戊甲，"
                "与本表只差午、亥。在 618 个标注案例上换成其他两套，强弱档位约变 4–5%，留给 E 阶段做灵敏度实验。",
        "tiers": ["primary", "middle", "residual"],
        "table": table,
        "overrides": {b: o for b, o in override.items()},
        "sources": [_src(YUANHAI, song_title, verse), _src(FENYE, fenye_title, table_text)],
    }


# ------------------------------------------------------------------ ten gods
def build_ten_gods() -> dict:
    stems, controls, _ = parse_stem_element_yang()
    generates, _ = parse_generates()
    controls_of = controls                                                # controller -> the element it controls
    text, title = _text(YUANHAI)
    yang_block = text[text.index("五干屬陽"):text.index("五干屬陰")]
    yin_block = text[text.index("五干屬陰"):text.index("《論天干地支暗藏總訣》")]

    def relation(dm: str, other: str) -> str:
        a, b = stems[dm]["element"], stems[other]["element"]
        if a == b:
            return "same_element"
        if generates[a] == b:
            return "dm_generates"
        if controls_of[a] == b:
            return "dm_controls"
        if controls_of[b] == a:
            return "controls_dm"
        return "generates_dm"

    def read(block: str, dm: str) -> Dict[Tuple[str, str], TenGod]:
        out = {}
        for other, names in re.findall(r"見([甲乙丙丁戊己庚辛壬癸]):為([^,。\n]+)", block):
            first = re.split(r"[、]", names)[0]
            if first == "七殺":
                first = "偏官"
            if first not in TEN_GOD_NAMES:
                raise BuildError(f"unknown ten-god name {first!r}")
            polarity = "same_polarity" if stems[dm]["yang"] == stems[other]["yang"] else "diff_polarity"
            out[(relation(dm, other), polarity)] = TEN_GOD_NAMES[first]
        return out

    a, b = read(yang_block, "甲"), read(yin_block, "乙")
    if len(a) != 10 or a != b:
        raise BuildError("the 甲 and 乙 examples of 渊海子平 do not give the same ten-god table")
    rows = sorted(a.items(), key=lambda kv: (RELATION_ORDER.index(kv[0][0]), kv[0][1] != "same_polarity"))
    return {
        "note": "十神 = 他干与日主的五行关系 × 阴阳同异。取自《渊海子平》「五干属阳（以甲为例）／五干属阴（以乙为例）」，两例得出同一张表。"
                "规则库有同样的表（R-SHISHEN-01..10），test_rules_data 保证一致。",
        "table": [{"relation": r, "polarity": p, "ten_god": g.value} for (r, p), g in rows],
        "sources": [_src(YUANHAI, title, yang_block[:64])],
    }


# ------------------------------------------------------------------ solar terms
def build_solar_terms() -> dict:
    _, terms, title, table_text = parse_fenye_days()
    flat = []
    for branch, jie, zhong in terms:
        flat.append((jie, True, branch))
        flat.append((zhong, False, None))
    if len(flat) != 24:
        raise BuildError("expected 24 terms")
    return {
        "note": "二十四节气，自立春起；节（jie）开启一个月柱，branch 为该月的地支。取自《子平真诠评注》十二月令人元司令分野表每月末尾列出的两个节气。"
                "第 i 个节气的太阳黄经为 (315 + 15 i) mod 360 度（天文事实，写在 terms.py）。key 与契约枚举按位置对应。",
        "terms": [{"key": k.value, "zh": zh, "jie": jie, **({"branch": br} if br else {})}
                  for k, (zh, jie, br) in zip(SolarTerm, flat)],
        "sources": [_src(FENYE, title, table_text)],
    }


# ------------------------------------------------------------------ month and hour stems, luck rules
def _verse(text: str, pattern: str) -> Tuple[List[str], str]:
    m = re.search(pattern, text)
    if not m:
        raise BuildError(f"verse not found: {pattern}")
    return list(m.groups()), m.group(0)


def build_pillar_rules() -> dict:
    text, title = _text(SANMING)
    month, mq = _verse(text, r"甲[已己]之年([甲乙丙丁戊己庚辛壬癸])作首,乙庚之歲([甲乙丙丁戊己庚辛壬癸])為頭,丙辛之歲尋([甲乙丙丁戊己庚辛壬癸])上,丁壬([甲乙丙丁戊己庚辛壬癸])位順行流,更有戊癸何處起\?([甲乙丙丁戊己庚辛壬癸])寅之上")
    hour, hq = _verse(text, r"甲[已己]還加([甲乙丙丁戊己庚辛壬癸]),乙庚([甲乙丙丁戊己庚辛壬癸])作初,丙辛從([甲乙丙丁戊己庚辛壬癸])起,丁壬([甲乙丙丁戊己庚辛壬癸])子居,戊癸何方發\?([甲乙丙丁戊己庚辛壬癸])子是直途")
    # the verse gives the first stem of 寅 (month) or 子 (hour) for the five stem pairs 甲己 乙庚 丙辛 丁壬 戊癸
    pairs = ["甲己", "乙庚", "丙辛", "丁壬", "戊癸"]
    expand = lambda targets: {s: t for pair, t in zip(pairs, targets) for s in pair}
    month_stems, hour_stems = expand(month), expand(hour)
    # in the hour verse the 丁壬 and 戊癸 targets are named with the branch (庚子, 壬子); only the stem is kept
    return {
        "note": "四柱的推算规则。月柱：五虎遁，给出各年干所起寅月的天干，其后每月顺推一位。时柱：五鼠遁，给出各日干所起子时的天干，其后每个时辰顺推一位。"
                "取自《三命通会》论遁月日时的两首古歌。",
        "month_stem_start": {s: month_stems[s] for s in STEMS_ZH},
        "hour_stem_start": {s: hour_stems[s] for s in STEMS_ZH},
        "sources": [_src(SANMING, title, mq), _src(SANMING, title, hq)],
    }


def build_luck_rules() -> dict:
    text, title = _text(SANMING)
    m = re.search(r"陽男陰女,大運以生日後未來節氣日時為數,順而行之;陰男陽女,大運以生日前過去節氣日時為數,逆而行之", text)
    r = re.search(r"一月之中有([一二三四五六七八九十百]+)時,折除節氣,算計([一二三四五六七八九十百千]+)日為一辰之([一二三四五六七八九十]+)歲", text)
    if not (m and r):
        raise BuildError("luck-cycle rules not found in 三命通会")
    hours_in_month, _, years = cn_number(r.group(1)), cn_number(r.group(2)), cn_number(r.group(3))
    minutes_per_year = hours_in_month * 2 * 60 // years              # 时 here is the double hour (时辰): two clock hours
    return {
        "note": "大运：阳男阴女顺行（数至生日后的下一节），阴男阳女逆行（数至生日前的上一节）；一月三百六十时（时辰）折十岁，"
                "即每岁三十六时辰＝三日＝4320 分钟，每月 360 分钟（月向下取整）；每步大运十岁。取自《三命通会》。",
        "forward_when": [["yang", "male"], ["yin", "female"]],
        "reverse_when": [["yin", "male"], ["yang", "female"]],
        "minutes_per_year": minutes_per_year,
        "minutes_per_month": minutes_per_year // 12,
        "years_per_cycle": years,
        "sources": [_src(SANMING, title, m.group(0)), _src(SANMING, title, r.group(0))],
    }


BUILDERS = {"stems_branches": build_stems_branches, "elements": build_elements, "hidden_stems": build_hidden_stems,
            "ten_gods": build_ten_gods, "solar_terms": build_solar_terms, "pillar_rules": build_pillar_rules,
            "luck_rules": build_luck_rules}


def build_all() -> Dict[str, dict]:
    return {name: fn() for name, fn in BUILDERS.items()}


def render(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=1) + "\n"


if __name__ == "__main__":
    built = build_all()
    if "--check" in sys.argv:
        stale = [n for n, o in built.items() if (DATA / f"{n}.json").read_text(encoding="utf-8") != render(o)]
        print("stale:", stale or "none")
        sys.exit(1 if stale else 0)
    for name, obj in built.items():
        (DATA / f"{name}.json").write_text(render(obj), encoding="utf-8")
        print("wrote", name)
