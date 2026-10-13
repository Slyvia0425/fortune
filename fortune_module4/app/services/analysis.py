from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models.entities import CollectionRecord, NoteRecord, PersonProfileRecord
from app.schemas.personal import (
    AgentAnalysisOut,
    AgentAnalysisRequest,
    AgentUsedRecordOut,
)
from app.services.llm import get_explanation_provider
from app.services.personal import (
    list_collections,
    list_notes,
    list_person_profiles,
    person_profile_to_schema,
)

DOMAIN_LABELS = {
    "career": "事业与职业发展",
    "wealth": "财务与资源安排",
    "relationship": "关系与婚恋",
    "health": "身心状态",
    "family": "家庭事务",
    "travel": "迁移、出行与环境变化",
    "study": "学习与成长",
    "general": "综合问题",
}

DOMAIN_KEYWORDS = {
    "career": ("事业", "工作", "职业", "升职", "跳槽", "求职", "岗位", "创业", "项目"),
    "wealth": ("财运", "财富", "财务", "收入", "投资", "金钱", "赚钱", "资金", "钱"),
    "relationship": ("感情", "婚姻", "婚恋", "恋爱", "伴侣", "对象", "分手", "复合", "姻缘"),
    "health": ("健康", "身体", "疾病", "睡眠", "压力", "情绪"),
    "family": ("家庭", "家人", "父母", "子女", "亲属", "家宅"),
    "travel": ("出行", "旅行", "搬迁", "迁移", "异地", "国外", "出国", "环境变化"),
    "study": ("学习", "考试", "升学", "研究", "课程", "论文"),
}

STEM_LABELS = {
    "jia": "甲",
    "yi": "乙",
    "bing": "丙",
    "ding": "丁",
    "wu": "戊",
    "ji": "己",
    "geng": "庚",
    "xin": "辛",
    "ren": "壬",
    "gui": "癸",
}

BRANCH_LABELS = {
    "zi": "子",
    "chou": "丑",
    "yin": "寅",
    "mao": "卯",
    "chen": "辰",
    "si": "巳",
    "wu_branch": "午",
    "wei": "未",
    "shen": "申",
    "you": "酉",
    "xu": "戌",
    "hai": "亥",
}

ELEMENT_LABELS = {
    "wood": "木",
    "fire": "火",
    "earth": "土",
    "metal": "金",
    "water": "水",
}

STRENGTH_LABELS = {
    "strong": "偏强",
    "balanced": "相对平衡",
    "weak": "偏弱",
    "very_strong": "明显偏强",
    "very_weak": "明显偏弱",
}

TEN_GOD_LABELS = {
    "friend": "比肩",
    "rob_wealth": "劫财",
    "eating_god": "食神",
    "hurting_officer": "伤官",
    "indirect_wealth": "偏财",
    "direct_wealth": "正财",
    "seven_killings": "七杀",
    "direct_officer": "正官",
    "indirect_resource": "偏印",
    "direct_resource": "正印",
}

PILLAR_LABELS = {
    "year": "年柱",
    "month": "月柱",
    "day": "日柱",
    "hour": "时柱",
}


def analyze_personal_question(
    db: Session,
    user_id: str,
    payload: AgentAnalysisRequest,
) -> AgentAnalysisOut:
    question = payload.question.strip()
    profiles = list_person_profiles(db, user_id)
    selected_profile = _select_profile(profiles, question, payload.profile_id)
    collections = list_collections(db, user_id)
    notes = list_notes(db, user_id)
    domain = _detect_domain(question)
    used_collections, used_notes = _select_records(
        question=question,
        domain=domain,
        profile=selected_profile,
        collections=collections,
        notes=notes,
    )
    facts = _extract_facts(selected_profile, used_collections)
    observations, suggestions, uncertainties = _build_analysis(
        question=question,
        domain=domain,
        profile=selected_profile,
        profiles=profiles,
        facts=facts,
        collections=used_collections,
        notes=used_notes,
    )
    base_answer = _compose_answer(
        profile=selected_profile,
        domain=domain,
        observations=observations,
        suggestions=suggestions,
        uncertainties=uncertainties,
    )
    used_records = [
        _collection_record(record) for record in used_collections
    ] + [_note_record(record) for record in used_notes]

    provider = get_explanation_provider()
    answer = provider.analyze_personal_records(
        {
            "question": question,
            "domain": DOMAIN_LABELS[domain],
            "person": (
                {
                    "name": selected_profile.name,
                    "relation": selected_profile.relation,
                }
                if selected_profile
                else None
            ),
            "facts": facts,
            "observations": observations,
            "suggestions": suggestions,
            "uncertainties": uncertainties,
            "records": [record.model_dump() for record in used_records],
            "base_answer": base_answer,
        }
    ).strip() or base_answer

    source_refs = sorted(
        {
            source_id
            for source_id in (
                [record.source_id for record in used_collections]
                + [record.source_id for record in used_notes]
            )
            if source_id
        }
    )
    return AgentAnalysisOut(
        answer=answer,
        person=person_profile_to_schema(selected_profile) if selected_profile else None,
        observations=observations,
        suggestions=suggestions,
        uncertainties=uncertainties,
        used_records=used_records,
        source_refs=source_refs,
        model=provider.name,
    )


def _select_profile(
    profiles: list[PersonProfileRecord],
    question: str,
    requested_profile_id: str | None,
) -> PersonProfileRecord | None:
    named = [
        profile
        for profile in profiles
        if profile.name and profile.name in question
    ]
    if named:
        return max(named, key=lambda profile: len(profile.name))
    if requested_profile_id:
        requested = next(
            (profile for profile in profiles if profile.id == requested_profile_id),
            None,
        )
        if requested is not None:
            return requested
    if len(profiles) == 1:
        return profiles[0]
    return None


def _detect_domain(question: str) -> str:
    normalized = question.replace(" ", "")
    scored = [
        (sum(1 for keyword in keywords if keyword in normalized), domain)
        for domain, keywords in DOMAIN_KEYWORDS.items()
    ]
    score, domain = max(scored, key=lambda item: item[0])
    return domain if score else "general"


def _select_records(
    *,
    question: str,
    domain: str,
    profile: PersonProfileRecord | None,
    collections: list[CollectionRecord],
    notes: list[NoteRecord],
) -> tuple[list[CollectionRecord], list[NoteRecord]]:
    terms = _query_terms(question)
    related_collection_ids: set[str] = set()
    scored: list[tuple[float, CollectionRecord]] = []

    for record in collections:
        metadata = record.source_metadata or {}
        item_type = record.item_type or ""
        module_name = _text(metadata.get("module"))
        person_name = _text(metadata.get("person_name"))
        profile_id = _text(metadata.get("profile_id"))
        belongs_to_profile = bool(
            profile
            and (
                profile_id == profile.id
                or (person_name and person_name == profile.name)
            )
        )
        unassigned = not person_name and not profile_id
        if (
            profile
            and not belongs_to_profile
            and module_name in {"bazi", "divination", "guanyin"}
        ):
            # Personal readings must never leak between named profiles. Public
            # knowledge records remain available as shared evidence.
            continue
        if profile and belongs_to_profile:
            related_collection_ids.add(record.id)

        haystack = " ".join(
            str(value)
            for value in (
                record.title,
                record.source_id,
                metadata.get("summary"),
                metadata.get("step"),
                metadata.get("action"),
                metadata.get("category"),
                person_name,
                " ".join(_string_list(metadata.get("tags"))),
            )
            if value
        ).lower()
        score = sum(4 for term in terms if term and term in haystack)
        score += _module_domain_score(module_name, item_type, domain, profile)
        if profile and belongs_to_profile:
            score += 20
        if profile and not unassigned and not belongs_to_profile:
            score -= 8
        if score > 0:
            scored.append((score, record))

    scored.sort(
        key=lambda item: (
            item[0],
            item[1].created_at.isoformat() if item[1].created_at else "",
        ),
        reverse=True,
    )
    selected_collections = [record for _, record in scored[:9]]

    selected_notes: list[NoteRecord] = []
    for note in notes:
        haystack = " ".join(
            [note.title or "", note.body, note.source_id or "", *note.tags]
        ).lower()
        belongs_to_profile = bool(
            profile
            and (
                profile.id in {*note.tags, note.source_id or ""}
                or profile.name in haystack
                or (note.collection_id and note.collection_id in related_collection_ids)
            )
        )
        if profile and not belongs_to_profile:
            continue
        score = sum(3 for term in terms if term and term in haystack)
        if belongs_to_profile:
            score += 15
        if domain != "general" and any(
            keyword in haystack for keyword in DOMAIN_KEYWORDS.get(domain, ())
        ):
            score += 4
        if score > 0:
            selected_notes.append(note)
    selected_notes.sort(
        key=lambda note: note.updated_at.isoformat() if note.updated_at else "",
        reverse=True,
    )
    return selected_collections, selected_notes[:4]


def _module_domain_score(
    module_name: str,
    item_type: str,
    domain: str,
    profile: PersonProfileRecord | None,
) -> float:
    score = 0.0
    if module_name == "bazi" and domain in {"career", "wealth", "relationship", "health", "family"}:
        score += 8
    if domain == "career" and module_name in {"bazi", "guanyin", "divination"}:
        score += 3
    if domain == "wealth" and module_name in {"bazi", "guanyin", "divination"}:
        score += 3
    if domain == "relationship" and module_name in {"bazi", "guanyin", "divination"}:
        score += 3
    if item_type in {"bazi_record", "bazi_analysis"}:
        score += 5
    if item_type == "bazi_luck":
        score += 6
    if profile and module_name == "bazi" and profile.chart_snapshot:
        score += 2
    return score


def _extract_facts(
    profile: PersonProfileRecord | None,
    collections: list[CollectionRecord],
) -> dict[str, Any]:
    chart: dict[str, Any] = dict(profile.chart_snapshot or {}) if profile else {}
    for record in collections:
        if record.item_type not in {"bazi_record", "bazi_analysis", "bazi_luck", "bazi_advisory"}:
            continue
        snapshot = (record.source_metadata or {}).get("snapshot")
        if not isinstance(snapshot, dict):
            continue
        if record.item_type == "bazi_record" and not chart:
            chart = {**snapshot, **chart}
        else:
            for key, value in snapshot.items():
                chart.setdefault(key, value)

    pillars = chart.get("pillars") if isinstance(chart.get("pillars"), list) else []
    day_pillar = next(
        (pillar for pillar in pillars if pillar.get("label") == "day"),
        {},
    )
    day_stem = _text(day_pillar.get("stem"))
    day_branch = _text(day_pillar.get("branch"))
    day_master = chart.get("day_master") if isinstance(chart.get("day_master"), dict) else {}
    disposition = chart.get("disposition") if isinstance(chart.get("disposition"), dict) else {}
    elements = chart.get("elements") if isinstance(chart.get("elements"), dict) else {}
    ten_gods_raw = chart.get("ten_gods") if isinstance(chart.get("ten_gods"), list) else []
    ten_gods = []
    for item in ten_gods_raw:
        relation = _text(item.get("ten_god")) if isinstance(item, dict) else ""
        label = TEN_GOD_LABELS.get(relation, relation)
        if label and label not in ten_gods:
            ten_gods.append(label)

    ordered_elements = sorted(
        (
            (ELEMENT_LABELS.get(_text(key), _text(key)), float(value))
            for key, value in elements.items()
            if isinstance(value, (int, float))
        ),
        key=lambda item: item[1],
        reverse=True,
    )
    useful = [
        ELEMENT_LABELS.get(_text(value), _text(value))
        for value in disposition.get("useful", [])
        if _text(value)
    ]
    current_period = (
        chart.get("current_period") if isinstance(chart.get("current_period"), dict) else {}
    )
    current_year = (
        current_period.get("year") if isinstance(current_period.get("year"), dict) else {}
    )
    advisory = chart.get("advisory") if isinstance(chart.get("advisory"), list) else []

    return {
        "pillars": [
            f"{PILLAR_LABELS.get(_text(pillar.get('label')), _text(pillar.get('label')))}"
            f"{STEM_LABELS.get(_text(pillar.get('stem')), _text(pillar.get('stem')))}"
            f"{BRANCH_LABELS.get(_text(pillar.get('branch')), _text(pillar.get('branch')))}"
            for pillar in pillars
            if isinstance(pillar, dict)
        ],
        "day_master": {
            "stem": STEM_LABELS.get(day_stem, day_stem),
            "element": ELEMENT_LABELS.get(
                _text(day_master.get("element") or day_pillar.get("element")),
                _text(day_master.get("element") or day_pillar.get("element")),
            ),
            "strength": STRENGTH_LABELS.get(
                _text(day_master.get("strength")),
                _text(day_master.get("strength")),
            ),
            "branch": BRANCH_LABELS.get(day_branch, day_branch),
        },
        "elements": [
            {"name": name, "score": value} for name, value in ordered_elements
        ],
        "useful_elements": useful,
        "unfavourable_elements": [
            ELEMENT_LABELS.get(_text(value), _text(value))
            for value in disposition.get("unfavourable", [])
            if _text(value)
        ],
        "ten_gods": ten_gods,
        "current_year": (
            f"{STEM_LABELS.get(_text(current_year.get('stem')), _text(current_year.get('stem')))}"
            f"{BRANCH_LABELS.get(_text(current_year.get('branch')), _text(current_year.get('branch')))}"
            if current_year
            else ""
        ),
        "advisory": advisory,
        "has_chart": bool(pillars or day_stem or elements),
    }


def _build_analysis(
    *,
    question: str,
    domain: str,
    profile: PersonProfileRecord | None,
    profiles: list[PersonProfileRecord],
    facts: dict[str, Any],
    collections: list[CollectionRecord],
    notes: list[NoteRecord],
) -> tuple[list[str], list[str], list[str]]:
    observations: list[str] = []
    suggestions: list[str] = []
    uncertainties: list[str] = []
    domain_label = DOMAIN_LABELS[domain]

    if profile:
        observations.append(
            f"问题“{question}”按人物档案“{profile.name}”进行分析，档案分类为{profile.relation or '其他'}。"
        )
    elif profiles:
        names = "、".join(record.name for record in profiles[:6])
        uncertainties.append(
            f"当前账号有多个可分析人物档案：{names}。问题未明确人物，因此本次只能分析未归档记录和公开依据；下次可在提问中使用姓名或选择分析档案。"
        )
    else:
        uncertainties.append("尚未建立人物档案，无法把命盘与本次问题稳定关联。")

    if facts.get("has_chart"):
        pillars = " ".join(facts.get("pillars") or [])
        day_master = facts.get("day_master") or {}
        if pillars:
            observations.append(f"命盘四柱为 {pillars}。")
        if day_master.get("stem") or day_master.get("element"):
            observations.append(
                f"日主为{day_master.get('stem', '')}{day_master.get('element', '')}，"
                f"旺衰判断为{day_master.get('strength') or '未记录'}，日支为{day_master.get('branch') or '未记录'}。"
            )
        elements = facts.get("elements") or []
        if elements:
            dominant = elements[0]
            weakest = elements[-1]
            observations.append(
                f"五行中以{dominant['name']}较突出（{dominant['score']}），"
                f"以{weakest['name']}相对较弱（{weakest['score']}）。"
            )
        useful = facts.get("useful_elements") or []
        if useful:
            observations.append(f"现有排盘记录列出的用神元素为{'、'.join(useful)}。")
        current_year = facts.get("current_year")
        if current_year:
            observations.append(f"命盘记录对应的当前流年为{current_year}。")
    else:
        uncertainties.append("没有找到可读取的完整命盘，命理结构部分无法实际展开。")

    matching_advisory = _advisory_categories(facts.get("advisory") or [], domain)
    if matching_advisory:
        observations.append(
            f"已保存的方向依据中，与{domain_label}相关的是：{'、'.join(matching_advisory[:5])}。"
        )

    divination_records = [
        record
        for record in collections
        if record.item_type.startswith("sign")
        or record.item_type.startswith("divination")
        or _text((record.source_metadata or {}).get("module")) in {"guanyin", "divination"}
    ]
    if divination_records:
        latest = divination_records[0]
        summary = _text((latest.source_metadata or {}).get("summary"))
        observations.append(
            f"最近一条签卦记录为“{latest.title or latest.source_id or '未命名记录'}”"
            f"{'：' + _compact(summary, 120) if summary else '。'}"
        )

    if notes:
        observations.append(
            f"本次同时纳入 {len(notes)} 条与问题或人物相关的个人笔记，用于校准关注重点。"
        )

    if domain == "career":
        suggestions.extend(_career_suggestions(facts))
    elif domain == "wealth":
        suggestions.extend(_wealth_suggestions(facts))
    elif domain == "relationship":
        suggestions.extend(_relationship_suggestions(facts))
    elif domain == "health":
        suggestions.append("健康的现实判断应以专业医疗信息为准；现有记录只能提示传统五行结构，不能替代诊断。")
    elif domain == "travel":
        suggestions.append("现有结构未包含完整的迁移神煞字段，因此不对出行结果作确定判断；应优先核对现实行程、工作与家庭条件。")
    elif domain == "study":
        suggestions.append("学习问题可结合日主强弱、印星与食伤记录观察吸收和表达倾向，同时仍需以实际考试成绩、课程反馈为依据。")
    else:
        suggestions.append("建议先明确要判断的领域，并补充对应时间的命盘、签卦或个人笔记，分析才会更聚焦。")

    if not collections and not notes:
        uncertainties.append("当前没有可用于该问题的个人记录。")
    if len(profiles) > 1 and not profile:
        suggestions.insert(0, "提问时使用“张三今年事业如何”这样的姓名加问题结构，或在提问框中先选择人物档案。")

    return observations, _dedupe(suggestions), _dedupe(uncertainties)


def _career_suggestions(facts: dict[str, Any]) -> list[str]:
    ten_gods = set(facts.get("ten_gods") or [])
    suggestions = []
    if ten_gods & {"正官", "七杀"}:
        suggestions.append("命局出现官杀信息，事业分析可重点观察责任、规则、职位竞争及上级关系。")
    if ten_gods & {"正印", "偏印"}:
        suggestions.append("印星信息适合用于判断学习、资格、专业背书和岗位稳定性，应结合现实履历一起看。")
    if ten_gods & {"食神", "伤官"}:
        suggestions.append("食伤信息适合判断表达、创造、产品和专业输出，但也需检查是否与官杀形成冲突。")
    suggestions.append("结合当前流年，优先检查用神是否被支持，再比较主动求变与稳住现状两种路径，而不是只凭单一吉凶词下结论。")
    return suggestions


def _wealth_suggestions(facts: dict[str, Any]) -> list[str]:
    ten_gods = set(facts.get("ten_gods") or [])
    suggestions = []
    if ten_gods & {"正财", "偏财"}:
        suggestions.append("财星已经出现在现有十神记录中，可分别观察稳定收入与机会型资源的倾向。")
    if ten_gods & {"食神", "伤官"}:
        suggestions.append("食伤生财结构适合从技能、产品、内容或项目输出角度核对增收路径。")
    suggestions.append("财运分析只能作为传统命理结构参考，实际决策应同时核对现金流、风险和合同条件。")
    return suggestions


def _relationship_suggestions(facts: dict[str, Any]) -> list[str]:
    day_master = facts.get("day_master") or {}
    suggestions = [f"当前日支为{day_master.get('branch') or '未记录'}，可把它作为配偶宫结构的一部分，但不能单独决定关系结果。"]
    ten_gods = set(facts.get("ten_gods") or [])
    if ten_gods & {"正官", "七杀", "正财", "偏财"}:
        suggestions.append("关系分析可继续检查官杀或财星与日主、用神之间的支持与冲突。")
    suggestions.append("应结合双方真实沟通、边界和共同目标判断，不以命盘替代关系事实。")
    return suggestions


def _advisory_categories(advisory: list[Any], domain: str) -> list[str]:
    labels = []
    for item in advisory:
        if not isinstance(item, dict) or item.get("domain") != domain:
            continue
        categories = item.get("categories")
        if not isinstance(categories, list):
            continue
        for category in categories:
            if isinstance(category, dict) and category.get("display_name"):
                labels.append(str(category["display_name"]))
    return _dedupe(labels)


def _compose_answer(
    *,
    profile: PersonProfileRecord | None,
    domain: str,
    observations: list[str],
    suggestions: list[str],
    uncertainties: list[str],
) -> str:
    lines: list[str] = []
    subject = f"{profile.name}的人物档案" if profile else "当前可用资料"
    lines.append(f"针对{subject}，按{DOMAIN_LABELS[domain]}进行综合分析。")
    if observations:
        lines.extend(["", "分析依据：", *[f"{index + 1}. {item}" for index, item in enumerate(observations)]])
    if suggestions:
        lines.extend(["", "分析结论与建议：", *[f"{index + 1}. {item}" for index, item in enumerate(suggestions)]])
    if uncertainties:
        lines.extend(["", "需要说明：", *[f"{index + 1}. {item}" for index, item in enumerate(uncertainties)]])
    lines.extend(["", "以上内容来自已保存的命盘、签卦、典籍与个人笔记，只能作为传统文化分析参考。"])
    return "\n".join(lines)


def _collection_record(record: CollectionRecord) -> AgentUsedRecordOut:
    metadata = record.source_metadata or {}
    return AgentUsedRecordOut(
        id=record.id,
        title=record.title or record.source_id or "未命名收藏",
        source_id=record.source_id,
        item_type=record.item_type,
        excerpt=_compact(_text(metadata.get("summary")) or "已保存的个人收藏记录"),
        module=_text(metadata.get("module")) or None,
        tags=_string_list(metadata.get("tags")),
        url=_text(metadata.get("url")) or None,
    )


def _note_record(record: NoteRecord) -> AgentUsedRecordOut:
    return AgentUsedRecordOut(
        id=record.id,
        title=record.title or "个人笔记",
        source_id=record.source_id,
        item_type="personal_note",
        excerpt=_compact(record.body),
        module="notes",
        tags=record.tags or [],
        url=None,
    )


def _query_terms(question: str) -> list[str]:
    normalized = question.replace(" ", "").lower()
    terms = {
        word
        for word in (
            "事业", "工作", "职业", "跳槽", "财运", "财富", "投资", "感情", "婚姻",
            "健康", "家庭", "出行", "学习", "考试", "八字", "命盘", "五行", "十神",
            "用神", "流年", "大运", "灵签", "签文", "卦象", "笔记",
        )
        if word in normalized
    }
    for index in range(len(normalized) - 1):
        chunk = normalized[index : index + 2]
        if all("\u3400" <= character <= "\u9fff" for character in chunk):
            terms.add(chunk)
    return list(terms)


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _compact(value: str, limit: int = 180) -> str:
    normalized = " ".join(value.split())
    return normalized if len(normalized) <= limit else f"{normalized[:limit]}…"


def _dedupe(values: list[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))
