"""Versioned deterministic six-line decoration; no question interpretation.

Calendar policy: fixed Asia/Shanghai calendar clock, exact jie month boundary,
midnight day rollover; caller timezone retained for display. No true-solar-time.
"""

from zoneinfo import ZoneInfo

from lunar_python import Solar

VERSION = "liuyao-decoration-v1"
POLICY = "shanghai-jie-midnight-water-earth-v1"
BRANCHES = "子丑寅卯辰巳午未申酉戌亥"
STEMS = "甲乙丙丁戊己庚辛壬癸"
ELEMENTS = "木火土金水"  # generating cycle
BRANCH_ELEMENT = dict(zip(BRANCHES, "水土木木土火火土金金土水", strict=True))
TRIGRAMS = {7: "乾", 3: "兑", 5: "离", 1: "震", 6: "巽", 2: "坎", 4: "艮", 0: "坤"}
PALACE_ELEMENT = {
    7: "金",
    3: "金",
    5: "火",
    1: "木",
    6: "木",
    2: "水",
    4: "土",
    0: "土",
}
# Inner then outer: each triple runs bottom to top. Source: local Zengshan preface.
NAJIA = {
    7: ("甲", "子寅辰", "壬", "午申戌"),
    0: ("乙", "未巳卯", "癸", "丑亥酉"),
    1: ("庚", "子寅辰", "庚", "午申戌"),
    6: ("辛", "丑亥酉", "辛", "未巳卯"),
    2: ("戊", "寅辰午", "戊", "申戌子"),
    5: ("己", "卯丑亥", "己", "酉未巳"),
    4: ("丙", "辰午申", "丙", "戌子寅"),
    3: ("丁", "巳卯丑", "丁", "亥酉未"),
}
KIN = {0: "siblings", 1: "offspring", 2: "wealth", 3: "officials", 4: "parents"}
KIN_NAMES = dict(
    zip(KIN.values(), ["兄弟", "子孙", "妻财", "官鬼", "父母"], strict=True)
)
SPIRITS = ["青龙", "朱雀", "勾陈", "螣蛇", "白虎", "玄武"]
STAGES = [
    "长生",
    "沐浴",
    "冠带",
    "临官",
    "帝旺",
    "衰",
    "病",
    "死",
    "墓",
    "绝",
    "胎",
    "养",
]
LIFE_START = {"木": 11, "火": 2, "土": 8, "金": 5, "水": 8}
PALACE_MASKS = [0, 1, 3, 7, 15, 31, 23, 16]
SELF_POSITIONS = [6, 1, 2, 3, 4, 5, 4, 3]
PALACES = {
    (p | p << 3) ^ mask: (p, stage, SELF_POSITIONS[stage])
    for p in TRIGRAMS
    for stage, mask in enumerate(PALACE_MASKS)
}
assert len(PALACES) == 64


def relation(source, target):
    diff = (ELEMENTS.index(target) - ELEMENTS.index(source)) % 5
    return ["same", "generates", "controls", "controlled_by", "generated_by"][diff]


def branch_relation(source, target):
    a, b = BRANCHES.index(source), BRANCHES.index(target)
    return {
        "element_relation": relation(BRANCH_ELEMENT[source], BRANCH_ELEMENT[target]),
        "same_branch": a == b,
        "clash": (a - b) % 12 == 6,
        "combine": (a + b) % 12 == 1,
    }


def calendar(instant, timezone="Asia/Shanghai"):
    if instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError("cast_at must include timezone")
    display = instant.astimezone(ZoneInfo(timezone))
    clock = instant.astimezone(ZoneInfo("Asia/Shanghai"))
    if not 1901 <= clock.year <= 2099:
        raise ValueError("Supported calendar years: 1901..2099")
    lunar = Solar.fromYmdHms(
        clock.year, clock.month, clock.day, clock.hour, clock.minute, clock.second
    ).getLunar()
    day, month = lunar.getDayInGanZhiExact2(), lunar.getMonthInGanZhiExact()
    start = (BRANCHES.index(day[1]) - STEMS.index(day[0])) % 12
    empty = [BRANCHES[(start + 10) % 12], BRANCHES[(start + 11) % 12]]
    return {
        "policy_id": POLICY,
        "provider": "lunar-python==1.4.8",
        "calendar_timezone": "Asia/Shanghai",
        "display_timezone": timezone,
        "display_time": display.isoformat(),
        "calendar_time": clock.isoformat(),
        "year_ganzhi": lunar.getYearInGanZhiExact(),
        "month_ganzhi": month,
        "month_branch": month[1],
        "day_ganzhi": day,
        "day_branch": day[1],
        "day_stem": day[0],
        "xun_start": "甲" + BRANCHES[start],
        "empty_branches": empty,
        "day_rollover": "00:00",
        "month_rollover": "exact_jie",
        "true_solar_time": False,
    }


def code(lines):
    return sum((v % 2) << i for i, v in enumerate(lines))


def strength(element, branch, cal):
    month = cal["month_branch"]
    # Four earth branches use earth-month baseline; no hidden seasonal day weights.
    seasonal = relation(BRANCH_ELEMENT[month], element)
    label = {
        "same": "旺",
        "generates": "相",
        "generated_by": "休",
        "controlled_by": "囚",
        "controls": "死",
    }[seasonal]
    return {
        "policy_id": POLICY,
        "month_seasonal_label": label,
        "month_relation": branch_relation(month, branch),
        "day_relation": branch_relation(cal["day_branch"], branch),
        "month_break": branch_relation(month, branch)["clash"],
        "day_clash": branch_relation(cal["day_branch"], branch)["clash"],
        "xun_empty": branch in cal["empty_branches"],
        "month_life_stage": STAGES[(BRANCHES.index(month) - LIFE_START[element]) % 12],
        "day_life_stage": STAGES[
            (BRANCHES.index(cal["day_branch"]) - LIFE_START[element]) % 12
        ],
        "overall_strength": None,
        "overall_strength_status": "requires_contextual_rule_evaluation",
    }


def decorate(lines, palace, cal, scope, self_pos=None):
    value = code(lines)
    spirit_start = [0, 0, 1, 1, 2, 3, 4, 4, 5, 5][STEMS.index(cal["day_stem"])]
    rows = []
    for index, line in enumerate(lines):
        trigram, offset = (value & 7, 0) if index < 3 else (value >> 3, 2)
        stem, branches = NAJIA[trigram][offset : offset + 2]
        branch = branches[index % 3]
        element = BRANCH_ELEMENT[branch]
        kin = KIN[
            (ELEMENTS.index(element) - ELEMENTS.index(PALACE_ELEMENT[palace])) % 5
        ]
        pos = index + 1
        position_role = None
        if self_pos:
            position_role = (
                "self"
                if pos == self_pos
                else ("response" if pos == (self_pos + 2) % 6 + 1 else None)
            )
        rows.append(
            {
                "ref": f"{scope}:{pos}",
                "position": pos,
                "yin_yang_value": line,
                "yin_yang": "yang" if line % 2 else "yin",
                "age": "old" if line in (6, 9) else "young",
                "moving": scope == "main" and line in (6, 9),
                "stem": stem,
                "branch": branch,
                "ganzhi": stem + branch,
                "element": element,
                "kin": kin,
                "kin_name": KIN_NAMES[kin],
                "kin_basis": "primary_palace",
                "position_role": position_role,
                "six_spirit": SPIRITS[(spirit_start + index) % 6],
                "strength": strength(element, branch, cal),
            }
        )
    return rows


def enrich(result, instant, timezone="Asia/Shanghai"):
    """Decorate a validated legacy result. Does not select the user's use-spirit."""
    lines = result["primary"]["lines"]
    if len(lines) != 6 or any(
        type(v) is not int or v not in (6, 7, 8, 9) for v in lines
    ):
        raise ValueError("Invalid six-line chart")
    changed = [7 if v == 6 else 8 if v == 9 else v for v in lines]
    if changed != result["transformed"]["lines"]:
        raise ValueError("Transformed chart mismatch")
    cal = calendar(instant, timezone)
    palace, stage, self_pos = PALACES[code(lines)]
    main = decorate(lines, palace, cal, "main", self_pos)
    transformed = decorate(changed, palace, cal, "transformed")
    pure = [7 if (palace | palace << 3) & (1 << i) else 8 for i in range(6)]
    missing = set(KIN.values()) - {row["kin"] for row in main}
    hidden = []
    for row in decorate(pure, palace, cal, "hidden"):
        if row["kin"] in missing:
            fly = main[row["position"] - 1]
            row.update(
                flying_line_ref=fly["ref"],
                flying_to_hidden=branch_relation(fly["branch"], row["branch"]),
                usable=None,
                usability_status="requires_rule_evaluation",
            )
            hidden.append(row)
    for row, other in zip(main, transformed, strict=True):
        row["transformation"] = (
            {
                "line_ref": other["ref"],
                "return_relation": branch_relation(other["branch"], row["branch"]),
                "life_stage_at_changed_branch": STAGES[
                    (BRANCHES.index(other["branch"]) - LIFE_START[row["element"]]) % 12
                ],
            }
            if row["moving"]
            else None
        )
    interactions = [
        {
            "source_ref": a["ref"],
            "target_ref": b["ref"],
            **branch_relation(a["branch"], b["branch"]),
        }
        for a in main
        if a["moving"]
        for b in main
        if a != b
    ]
    return {
        "core_version": VERSION,
        "calendar": cal,
        "palace": {
            "trigram": TRIGRAMS[palace],
            "element": PALACE_ELEMENT[palace],
            "stage": ["本宫", "一世", "二世", "三世", "四世", "五世", "游魂", "归魂"][
                stage
            ],
            "self_position": self_pos,
            "response_position": (self_pos + 2) % 6 + 1,
        },
        "main_lines": main,
        "main_lines_complete": True,
        "transformed_lines": transformed,
        "transformed_lines_complete": True,
        "hidden_lines": hidden,
        "hidden_lines_complete": True,
        "moving_line_interactions": interactions,
        "capability_gaps": [],
        "interpretation_limits": [
            "overall_strength_requires_rules",
            "hidden_usability_requires_rules",
        ],
    }
