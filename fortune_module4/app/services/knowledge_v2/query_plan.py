"""Evidence-grounded templates. Aliases are search vocabulary, never user facts."""

import re

VERSION = "question-template-v2.1"
DICTIONARY_VERSION = "liuyao-search-terms-v1"
TOPICS = {
    "考试": ("考试", "考試", "考研", "高考", "科考"),
    "求财": ("求财", "求財", "生意", "赚钱", "投资"),
    "疾病": ("病", "健康", "治疗"),
    "婚姻": ("婚姻", "结婚", "感情", "复合"),
    "工作": ("工作", "职位", "升职", "求职"),
}
ALIASES = {"考试": ["功名", "科举"], "工作": ["仕途"], "求财": ["财利"]}
RELATIONS = ("妹妹", "姐姐", "弟弟", "哥哥", "母亲", "父亲", "儿子", "女儿", "妻子", "丈夫", "朋友")
RULE_TYPES = ["subject_relation", "object_classification", "topic_override"]


def extract(question):
    if not isinstance(question, str) or not 1 <= len(question.strip()) <= 500:
        raise ValueError("Question must be 1–500 characters")
    evidence = {}

    def field(name, value, quote):
        start = question.index(quote)
        evidence[name] = {
            "quote": quote,
            "start": start,
            "end": start + len(quote),
            "confirmed": True,
        }
        return value

    topics = [
        (topic, word) for topic, words in TOPICS.items() for word in words if word in question
    ]
    distinct = list(dict.fromkeys(t for t, _ in topics))
    topic = field("topic", topics[0][0], topics[0][1]) if len(distinct) == 1 else None
    relations = [r for r in RELATIONS if r in question]
    # Only explicit target syntax establishes a relationship.
    targets = [r for r in relations if re.search(r"(?:替|代|帮|问|占|我(?:的)?|^)" + r, question)]
    relation = field("subject_relation", targets[0], targets[0]) if len(targets) == 1 else None
    if not relations and re.search(r"(?:我|自己)", question):
        word = "自己" if "自己" in question else "我"
        relation = field("subject_relation", "本人", word)
    proxy = re.search(r"(?:替|代|帮)(?:我的)?(?:" + "|".join(RELATIONS) + r")", question)
    subject_mode = field("subject_mode", "代占", proxy[0]) if proxy else None
    exam = next((word for word in ("高考", "考研", "公务员考试", "科考") if word in question), None)
    exam_type = field("exam_type", exam, exam) if exam else None
    goals = [
        (label, word)
        for label, words in {
            "是否通过": ("能不能过", "能否通过", "是否通过", "能过吗", "考得过"),
            "何时": ("什么时候", "何时", "几时"),
            "是否成功": ("能否成功", "是否成功", "能不能成"),
        }.items()
        for word in words
        if word in question
    ]
    goal = field("goal", goals[0][0], goals[0][1]) if len(set(g[0] for g in goals)) == 1 else None
    timing = re.search(r"这次|本次|明天|今天|今年|明年|下个月|\d{4}年\d{1,2}月\d{1,2}日", question)
    time_raw = field("time_scope", timing[0], timing[0]) if timing else None
    ambiguities = []
    if relation is None:
        ambiguities.append("问事对象关系未明确")
    if goal is None:
        ambiguities.append("问题目标未明确")
    if len(distinct) > 1:
        ambiguities.append("涉及多个专题，未确定主问")
    if topic == "考试" and exam_type is None:
        ambiguities.append("考试类型未提供")
    return {
        "original_question": question,
        "topic": topic,
        "subtopic": exam_type,
        "subject_mode": subject_mode,
        "subject_relation": relation,
        "asked_object": relation,
        "goal": goal,
        "exam_type": exam_type,
        "time_scope": {"raw": time_raw, "normalized": None},
        "field_evidence": evidence,
        "explicit_facts": {k: v["quote"] for k, v in evidence.items()},
        "ambiguities": ambiguities,
    }


def make_query(text, lane, purpose, fields, *, rule_types=(), aliases=(), round_number=0):
    return {
        "text": text[:500],
        "lane": lane,
        "purpose": purpose,
        "rule_types": list(rule_types),
        "round": round_number,
        "provenance": [{"field": f} for f in fields]
        + [
            {"historical_search_alias": a, "dictionary_version": DICTIONARY_VERSION}
            for a in aliases
        ],
    }


def plan(question):
    context = extract(question)
    relation, topic, goal = (context[k] or "" for k in ("subject_relation", "topic", "goal"))
    aliases = ALIASES.get(topic, [])
    relation = " ".join(filter(None, [context["subject_mode"], relation]))
    queries = [
        make_query(
            f"{relation} 对象关系 条件 取用",
            "rule",
            "关系与对象分类",
            ["subject_mode", "subject_relation"],
            rule_types=["subject_relation", "object_classification"],
        ),
        make_query(
            " ".join([topic, *aliases, "专题 取用条件 例外"]),
            "rule",
            "专题条件与例外",
            ["topic"],
            rule_types=["topic_override"],
            aliases=aliases,
        ),
        make_query(
            " ".join(filter(None, [relation, topic, goal])) or question,
            "case",
            "问事相似案例",
            ["subject_mode", "subject_relation", "topic", "goal"],
        ),
    ]
    for i, query in enumerate(queries, 1):
        query["query_id"] = f"q{i}"
    return {
        "original_question": question,
        "question_context": context,
        "template_version": VERSION,
        "dictionary_version": DICTIONARY_VERSION,
        "queries": queries,
        "rejected_rewrites": [],
        "rewrite_mode": "deterministic_templates",
        "consumption": {},
    }
