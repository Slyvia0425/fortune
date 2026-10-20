# 六爻卦盘字段生成规则与源码

本说明依据当前仓库源码整理。下方附三份完整源码快照；实际运行以原文件为准。

## 1. 入口与输出层次

`python_algorithm/app.py` 的 `POST /divination/cast` 调用：
`calculate(method, numbers)` → `enrich(result, instant, timezone)`。

公开 API 当前只接收 three_numbers 和三个正整数；底层引擎另支持旧版 numbers、coins、random。未提供 casting_receipt 时使用当前 UTC 时刻，再转换到历法时区。

顶层 primary、transformed、moving_lines、mutual、opposite、reversed 由 hexagram_engine.py 生成；core_facts 由 liuyao_core.py 生成。本卦、变卦名称不在 core_facts 内。core_facts.palace 描述本卦所属宫及阶段，不单列变卦所属宫。

## 2. 起卦、本变卦、互错综卦

六爻数组一律自下而上：索引 0 为初爻、5 为上爻。6=老阴、7=少阳、8=少阴、9=老阳。偶数阴，奇数阳，6/9 发动。

三数字规则：第一个数定上卦，第二个数定下卦，第三个数定动爻。八卦顺序为乾兑离震巽坎艮坤；(n-1)%8 选卦，(n3-1)%6 定动爻。每次仅产生一个动爻。铜钱法每爻三个 2/3 求和，可产生零到六个动爻。

每个三爻卦按初爻最低位编码，阳1阴0；下卦为前3爻，上卦为后3爻。HEXAGRAMS[(上卦编码, 下卦编码)] 查六十四卦序号与名字。

变爻：6→7、9→8，7/8 保持不变。互卦下卦取本卦2/3/4爻，上卦取3/4/5爻；错卦六爻阴阳全部反转；综卦将本卦六爻顺序反转，计算前先去掉动静属性。

## 3. 卦宫、八宫阶段与世应

纯宫编码为 p | (p << 3)，依次异或掩码 [0,1,3,7,15,31,23,16]，得到本宫、一世、二世、三世、四世、五世、游魂、归魂八个阶段。
世爻位置依次为 [6,1,2,3,4,5,4,3]；应爻位置为 (世位+2)%6+1。

宫五行：乾兑金、离火、震巽木、坎水、艮坤土。
palace 返回 trigram、element、stage、self_position、response_position。

## 4. 纳甲、五行与六亲

NAJIA 每行保存“内卦天干、内卦三地支、外卦天干、外卦三地支”，各组三支均自下而上。每爻按所在上下卦查对应干支；ganzhi=stem+branch。

地支五行按子水、丑土、寅木、卯木、辰土、巳火、午火、未土、申金、酉金、戌土、亥水。

五行循环为木火土金水。以本卦宫五行为“我”：
同我兄弟、我生子孙、我克妻财、克我官鬼、生我父母。
代码用 (爻五行序号-本卦宫五行序号)%5 查 KIN。

本卦、变卦、伏神六亲均以本卦宫为准，即 kin_basis=primary_palace。变卦逐爻纳甲会随上下卦结构改变，静爻的纳甲变化不表示该爻发动。

## 5. 六神与逐爻字段

六神循环：青龙、朱雀、勾陈、螣蛇、白虎、玄武。
初爻起点：甲乙青龙、丙丁朱雀、戊勾陈、己螣蛇、庚辛白虎、壬癸玄武；随后自下而上依序排列。

decorate() 的字段：
- ref：作用域 main/transformed/hidden 加爻位；position：1～6。
- yin_yang_value、yin_yang、age：爻数、阴阳、老少。
- moving：仅 main 作用域且数值为6/9时为 true。
- stem、branch、ganzhi、element：纳甲及支五行。
- kin、kin_name、kin_basis：六亲英文、中文、计算基准。
- position_role：本卦世爻 self、应爻 response，其余 null；变卦和伏神均不标世应。
- six_spirit：日干起六神。
- strength：日月关系等局部事实，见下节。
- transformation：仅本卦动爻附对应变爻关系；静爻为 null。

## 6. 历法、旬空

历法实现依赖 lunar_python.Solar，provider 字段标记 lunar-python==1.4.8。
固定 Asia/Shanghai 历法时间，display_timezone 仅保留展示时区；支持1901～2099年，不使用真太阳时。
getYearInGanZhiExact() 取年干支，getMonthInGanZhiExact() 按精确交节取月干支，getDayInGanZhiExact2() 按00:00换日。
当前 calendar 不输出时干支、农历日期、交节时刻，也不输出年/月/时柱旬空；empty_branches 只表示日旬空。

日支序号减日干序号模12得到旬首地支 start：
xun_start = 甲 + 地支[start]；
旬空取地支[(start+10)%12]、地支[(start+11)%12]。
其他字段包括 policy_id、provider、calendar/display_timezone、calendar/display_time、year/month/day_ganzhi、month/day_branch、day_stem、day/month_rollover、true_solar_time。

## 7. 日月关系、旺相休囚死、十二长生

relation(source,target) 是有方向的：same同类、generates源生目标、controls源克目标、controlled_by源被目标克、generated_by源被目标生。
branch_relation() 同时给出同支、六冲、六合。支序号差模12等于6为冲；两序号和模12等于1为六合。

strength 中月支为 source、爻为 target：
同类旺，月生爻相，爻生月休，爻克月囚，月克爻死。
四土月统一按土月基准，不细分月内司令权重。

month_relation/day_relation 分别存日月→爻的关系；month_break=月支冲爻支；day_clash=日支冲爻支；xun_empty=爻支属于日旬空。

十二长生顺序：长生、沐浴、冠带、临官、帝旺、衰、病、死、墓、绝、胎、养。
木长生亥、火寅、土申、金巳、水申；按地支顺排。month/day_life_stage 用月/日支减对应五行长生起点模12得到。

overall_strength 固定为 null，状态 requires_contextual_rule_evaluation。局部“旺”不能直接等同最终综合旺衰。

## 8. 伏神与飞神

本卦缺失六亲集合 = 五种六亲 - 本卦明爻出现的六亲。
构建本卦所属宫的纯宫卦，纳甲后选出属于缺失类别的爻，按纯宫原位置安伏；同一位置的本卦明爻作为飞神。
因此同一缺失类别如在纯宫多现，会保留多个位置。

伏神保留全部 decorate 字段，并加 flying_line_ref、flying_to_hidden、usable、usability_status。
flying_to_hidden 是飞神→伏神的关系；usable 固定 null，是否可用留待规则判断。
hidden_lines=[] 且 hidden_lines_complete=true 表示按该规则无须安伏，不等同于资料缺失。

## 9. 动变与动爻交互

本卦动爻 transformation.line_ref 指向同位置 transformed 爻；
return_relation 的方向为变爻→本爻，表达回头生克冲合；
life_stage_at_changed_branch 用本爻五行在变爻地支上的十二长生。

moving_line_interactions 对每个本卦动爻与其他五个本卦爻分别生成一条记录，方向 source_ref→target_ref。
仅包括五行关系、同支、六冲、六合；不含三合、三刑、六害、进退神或合化成立判断。
k个动爻产生5k条关系，动爻之间可同时出现两个方向。

## 10. 完整性与边界

main_lines_complete、transformed_lines_complete、hidden_lines_complete 在 enrich 成功后为 true；
core_version 为实现版本；capability_gaps 当前为空数组；
interpretation_limits 明示综合旺衰与伏神可用性需要额外规则。

core 不在此选择用神，不输出吉凶、应期或对人物心理的判断。
从资料恢复盘面时，本变卦可确定阴阳与动爻；月支和日干支可供局部关系与六神计算，但当前 enrich 接口仍要求带时区的实际时间。缺年份时不能伪造日期充当原始起卦时间。

## 11. 完整源码快照

### python_algorithm/hexagram_engine.py

```python
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


def cast_from_three_numbers(numbers: list[int]) -> list[int]:
    """The production adapter: exactly three ordered positive integers.

    This preserves the established numeric method while removing the legacy
    two-number fallback from the user-facing Core contract.
    """
    if len(numbers) != 3 or any(not isinstance(number, int) or number <= 0 for number in numbers):
        raise ValueError("three_numbers casting requires exactly three positive integers")
    return cast_from_numbers(numbers)


def cast_from_coins(coins: list[list[int]]) -> list[int]:
    if len(coins) != 6 or any(len(toss) != 3 or any(value not in (2, 3) for value in toss) for toss in coins):
        raise ValueError("coins casting requires six groups of three values (2 or 3)")
    return [sum(toss) for toss in coins]


def cast_random() -> list[int]:
    return [sum(secrets.choice((2, 3)) for _ in range(3)) for _ in range(6)]


def calculate(method: str, numbers: list[int] | None = None, coins: list[list[int]] | None = None) -> dict[str, object]:
    if method == "three_numbers":
        lines = cast_from_three_numbers(numbers or [])
    elif method == "numbers":
        lines = cast_from_numbers(numbers or [])
    elif method == "coins":
        lines = cast_from_coins(coins or [])
    elif method == "random":
        lines = cast_random()
    else:
        raise ValueError("method must be numbers, coins, or random")
    primary = _hexagram(lines)
    moving_lines = [index + 1 for index, line in enumerate(lines) if line in (6, 9)]
    static_lines = [7 if line % 2 else 8 for line in lines]
    mutual_lines = static_lines[1:4] + static_lines[2:5]
    transformed_lines = [(7 if line == 6 else 8 if line == 9 else line) for line in lines]
    transformed = _hexagram(transformed_lines)
    return {
        "primary": primary.as_dict(), "moving_lines": moving_lines, "mutual": _hexagram(mutual_lines).as_dict(), "transformed": transformed.as_dict(),
        "opposite": _hexagram([8 if line % 2 else 7 for line in lines]).as_dict(),
        "reversed": _hexagram(list(reversed(static_lines))).as_dict(),
        "traditional_meaning": "卦象、动爻、互卦与变卦均由固定规则计算；传统释义与出处由知识检索层补充。",
        "contextual_interpretation": "此结果用于传统文化学习与交互演示，不构成现实决策建议。",
    }
```

### python_algorithm/liuyao_core.py

```python
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
```

### python_algorithm/app.py

```python
from fastapi import FastAPI, HTTPException
from typing import Literal
from datetime import datetime, timezone
from zoneinfo import ZoneInfoNotFoundError
from liuyao_core import enrich

from pydantic import AwareDatetime, BaseModel, Field, StrictInt

from hexagram_engine import calculate

app = FastAPI(title="Fortune deterministic algorithm service")

class CastingCalendarReceipt(BaseModel):
    cast_at: AwareDatetime
    timezone: str = "Asia/Shanghai"


class DivinationRequest(BaseModel):
    question: str = Field(min_length=1, max_length=300)
    method: Literal["three_numbers"]
    numbers: list[StrictInt] = Field(min_length=3, max_length=3)
    casting_receipt: CastingCalendarReceipt | None = None

@app.post("/divination/cast")
def cast_divination(request: DivinationRequest):
    try:
        result = calculate(request.method, request.numbers)
        receipt = request.casting_receipt
        instant = receipt.cast_at if receipt else datetime.now(timezone.utc)
        result["core_facts"] = enrich(result, instant, receipt.timezone if receipt else "Asia/Shanghai")
        return result
    except (ValueError, ZoneInfoNotFoundError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


# --- BaZi module (bazi/) -----------------------------------------------------
# Mounted here so both modules share one service, one port and the single
# PYTHON_ALGORITHM_BASE_URL. Everything BaZi-specific lives under bazi/.
from bazi.routers.bazi import router as bazi_router  # noqa: E402

app.include_router(bazi_router)
```


