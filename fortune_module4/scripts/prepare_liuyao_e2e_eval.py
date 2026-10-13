"""Build a fixed, source-labelled pilot through the production core and retriever.

No user data, altered corpus, supplied answers, or forged chart facts enter inference.
Question context is a controlled fixture: chat extraction/UI are outside this pilot.
"""

# ruff: noqa: E402 -- standalone script must set the package path before imports.
import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from dotenv import load_dotenv
from sqlalchemy import create_engine, select

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "fortune_module4"))
load_dotenv(ROOT / "fortune_module4/.env")

from app.services.embeddings import get_embedding_provider
from app.services.knowledge_v2 import schema as s
from app.services.knowledge_v2.hybrid import run_text_reasoning
from app.services.knowledge_v2.ingest import canonical, sha
from app.services.knowledge_v2.retrieval import quotes
from app.services.knowledge_v2.runtime import freeze, verify_chart
from app.services.knowledge_v2.vectorize import verify_provider

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
if (OUT / "manifest.json").exists():
    raise ValueError("Evaluation directory already has frozen inputs; choose a new run directory")
DATA = ROOT / "data/liuyao_knowledge/stage9-text-reasoning-v2"
RELEASE = json.loads((DATA / "preparation_report.json").read_text())["release_id"]
WHEN = datetime.fromisoformat("2026-10-11T04:00:00+00:00")

# Labels are fixed before retrieval or model calls. They are engineering source
# expectations, not expert-certified gold or real-world prediction labels.
SPECS = [
    (
        "self_health",
        "我问自己的疾病能否好转，只分析取用，不需要医疗建议。",
        "本人",
        "疾病",
        "能否好转",
        "self",
        "any",
        ["自占疾病取世"],
        False,
    ),
    (
        "mother_health",
        "我本人起念、自己提供数字，问母亲的疾病能否好转，只分析取用。",
        "母亲",
        "疾病",
        "能否好转",
        "parents",
        "single",
        ["父母类：父母、长辈与师长", "为亲属问事，按关系确定目标"],
        False,
    ),
    (
        "wife_husband",
        "我是妻子，自己提供数字，问丈夫此次出行能否平安。",
        "丈夫",
        "出行",
        "是否平安",
        "officials",
        "single",
        ["官鬼类：功名、官府与妻问夫", "行人：归期与平安不可互换"],
        False,
    ),
    (
        "own_wealth",
        "我问自己的买卖能否赚到钱，目标是求财。",
        "本人",
        "求财",
        "是否得财",
        "wealth",
        "single",
        ["妻财类：妻与财物"],
        False,
    ),
    (
        "brother_travel",
        "我自己起念问哥哥在外是否平安，不问归来日期。",
        "哥哥",
        "行人",
        "是否平安",
        "siblings",
        "single",
        ["兄弟类：同辈亲属与结拜关系", "行人：归期与平安不可互换"],
        False,
    ),
    (
        "child_target",
        "我自己提供数字，问儿子此次出行能否平安。",
        "儿子",
        "行人",
        "是否平安",
        "offspring",
        "single",
        ["子孙类：晚辈与门生", "为亲属问事，按关系确定目标"],
        False,
    ),
    (
        "multiple_wealth",
        "我问自己的买卖能否赚到钱。如果妻财多现，请保留各候选及分歧，不要机械选一爻。",
        "本人",
        "求财",
        "是否得财",
        "wealth",
        "multiple",
        ["妻财类：妻与财物", "未能消歧时返回并列候选"],
        True,
    ),
    (
        "hidden_wealth",
        "我问自己的买卖能否赚到钱。如果本卦妻财不现，请区分伏神和实际动爻变出，不要认定伏神存在就一定可用。",
        "本人",
        "求财",
        "是否得财",
        "wealth",
        "hidden",
        ["妻财类：妻与财物", "区分明爻、变出、日月与伏神"],
        True,
    ),
    (
        "aunt_conflict",
        "我自己起念和提供数字，问姑姨的出行是否平安。",
        "姑姨",
        "行人",
        "是否平安",
        None,
        "any",
        ["姑姨、姊丈妹夫等冲突词暂停自动取用"],
        True,
    ),
    (
        "unclear_goal",
        "我想问未来三个月工作方面的事情。",
        "本人",
        "工作",
        None,
        None,
        "any",
        [],
        True,
    ),
    (
        "proxy_unclear",
        "朋友让我代操作，他给我数字，想问他母亲的事情，我不知道是谁起念，也不知道具体想问什么。",
        "未明确占问视角",
        "未明确",
        None,
        None,
        "any",
        ["受托代操作与本人代问分开"],
        True,
    ),
    (
        "self_exam",
        "我问这次公务员考试能否通过，自己起念并提供数字，只问录取目标。",
        "本人",
        "考试",
        "是否通过",
        "officials",
        "single",
        ["官鬼类：功名、官府与妻问夫"],
        False,
    ),
]


def fixed_chart(tid, question, role, shape):
    for upper in range(1, 9):
        for lower in range(1, 9):
            chart = freeze([upper, lower, 1], question, cast_at=WHEN, timezone="Asia/Hong_Kong")
            core = chart["facts"]
            main = [line for line in core["main_lines"] if line["kin"] == role]
            hidden = [line for line in core["hidden_lines"] if line["kin"] == role]
            ok = (
                shape == "any"
                or (shape == "single" and len(main) == 1)
                or (shape == "multiple" and len(main) >= 2)
                or (shape == "hidden" and not main and hidden)
            )
            if ok:
                chart["chart_id"] = str(uuid5(NAMESPACE_URL, "fortune-e2e-pilot-v1:" + tid))
                chart["chart_hash"] = sha(
                    canonical({k: v for k, v in chart.items() if k != "chart_hash"})
                )
                return verify_chart(chart)
    raise ValueError("No chart satisfies fixture " + tid)


def main():
    engine = create_engine(
        "sqlite:///file:" + str(DATA / "knowledge.sqlite3") + "?mode=ro&uri=true"
    )
    with engine.connect() as conn:
        rules = conn.execute(select(s.entity).where(s.entity.c.kind == "rule")).mappings().all()
        by_title = {r["text"].splitlines()[0].removeprefix("标题："): r for r in rules}
        labelled = []
        for tid, question, relation, topic, goal, role, shape, titles, abstain in SPECS:
            refs = [
                {
                    "entity_revision_id": by_title[t]["revision_id"],
                    "title": t,
                    "source_quotes": quotes(conn, by_title[t]["revision_id"]),
                }
                for t in titles
            ]
            ctx = {
                "topic_candidates": [topic],
                "relationships": [{"relation": relation}],
                "goal": {"value": goal},
                "ambiguities": ["问事目标或主体视角未明确"] if goal is None else [],
            }
            labelled.append(
                {
                    "test_id": tid,
                    "question": question,
                    "question_context": ctx,
                    "chart": fixed_chart(tid, question, role, shape),
                    "expected": {
                        "candidate_role": role,
                        "chart_shape": shape,
                        "must_abstain": abstain,
                        "required_rules": refs,
                    },
                }
            )
    manifest = {
        "version": "production-core-retrieval-llm-guardian-pilot-v1",
        "count": len(labelled),
        "knowledge_release_id": RELEASE,
        "knowledge_sha256": hashlib.sha256((DATA / "knowledge.sqlite3").read_bytes()).hexdigest(),
        "cast_at": WHEN.isoformat(),
        "timezone": "Asia/Hong_Kong",
        "labels": "source_checked_engineering_pilot_not_expert_gold",
        "question_context": "controlled_fixtures_not_live_chat_extraction",
        "label_sha256": sha(canonical(labelled)),
        "source_hashes": {
            n: sha((ROOT / n).read_text())
            for n in (
                "lib/divination/model-use-analysis.ts",
                "lib/server/divination-llm.ts",
                "fortune_module4/app/services/knowledge_v2/hybrid.py",
                "fortune_module4/app/services/knowledge_v2/query_plan.py",
            )
        },
    }
    (OUT / "fixtures.json").write_text(json.dumps(labelled, ensure_ascii=False, indent=2))
    # Persist labels before inference. None of 'expected' is passed to retrieval/model.
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    provider = None
    provider_status = {}
    try:
        candidate = get_embedding_provider()
        verify_provider(candidate, DATA / "probe_baseline.json")
        provider = candidate
        provider_status = {"verified": True, "model": provider.name}
    except Exception as exc:
        provider_status = {
            "verified": False,
            "error_type": type(exc).__name__,
            "fallback": "bm25_and_structured",
        }
    (OUT / "provider_status.json").write_text(
        json.dumps(provider_status, ensure_ascii=False, indent=2)
    )
    print(json.dumps(provider_status), flush=True)
    rows = []
    for item in labelled:
        chart = item["chart"]
        pack = run_text_reasoning(
            engine,
            RELEASE,
            item["question"],
            chart_id=chart["chart_id"],
            core_loader=lambda cid, frozen=chart: verify_chart(frozen),
            provider=provider,
            question_context=item["question_context"],
        )
        received = {u["entity_revision_id"] for u in pack["reasoning_evidence"]}
        expected_ids = {r["entity_revision_id"] for r in item["expected"]["required_rules"]}
        row = {
            **item,
            "pack": pack,
            "retrieval_check": {
                "required": len(expected_ids),
                "hit": len(expected_ids & received),
                "missing": sorted(expected_ids - received),
                "rules": sum(u["kind"] == "rule" for u in pack["reasoning_evidence"]),
                "cases": sum(u["kind"] == "case" for u in pack["reasoning_evidence"]),
                "vector_used": any(
                    "vector" in u.get("channel_ranks", {}) for u in pack["reasoning_evidence"]
                ),
            },
        }
        rows.append(row)
        (OUT / "inputs.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2))
        print(json.dumps({"id": item["test_id"], **row["retrieval_check"]}), flush=True)
    engine.dispose()


if __name__ == "__main__":
    main()
