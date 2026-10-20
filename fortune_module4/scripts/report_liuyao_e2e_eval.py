"""Summarize opt-in production pilot results without using a model judge."""
# ruff: noqa: E501 -- preserve readable report prose and Markdown table rows.

import json
import sys
from collections import Counter
from pathlib import Path

folder = Path(sys.argv[1])
inputs = json.loads((folder / "inputs.json").read_text())
results = {
    p.stem: json.loads(p.read_text())
    for p in (folder / "model_results").glob("*.json")
    if not p.name.endswith(".request.json")
}
assert len(inputs) == len(results) == 12, "Do not summarize an incomplete run as complete"
# Recompute citation coverage from all accepted output sections. A correct
# abstention may cite its rule in readings without proposing any candidate.
for item in inputs:
    r = results[item["test_id"]]
    accepted = r.get("production_result") or {}
    analysis = accepted.get("analysis") or {}
    cited = set()
    for candidate in analysis.get("candidates", []):
        cited.update(candidate["evidence_ids"])
        for condition in candidate["conditions"]:
            cited.update(condition["evidence_ids"])
    cited.update((analysis.get("selection") or {}).get("evidence_ids", []))
    for reading in accepted.get("readings", []):
        cited.update(reading["evidence_ids"])
    expected_ids = {v["entity_revision_id"] for v in item["expected"]["required_rules"]}
    r["checks"]["expected_rule_cited"] = bool(expected_ids & cited) if expected_ids else None
required = sum(item["retrieval_check"]["required"] for item in inputs)
hit = sum(item["retrieval_check"]["hit"] for item in inputs)
statuses = Counter(r["status"] for r in results.values())
raw_checks = {}
for item in inputs:
    result = results[item["test_id"]]
    try:
        raw = json.loads(result.get("raw_output") or "null")
    except (ValueError, TypeError):
        raw = None
    role = item["expected"]["candidate_role"]
    candidates = raw.get("candidates", []) if isinstance(raw, dict) else []
    refs = {ref for c in candidates if c.get("role") == role for ref in c.get("line_refs", [])}
    raw_checks[item["test_id"]] = {
        "parseable": isinstance(raw, dict),
        "expected_role_present": any(c.get("role") == role for c in candidates) if role else None,
        "role_refs": sorted(refs),
        "selected_line": (raw.get("selection") or {}).get("line_ref")
        if isinstance(raw, dict)
        else None,
    }
raw_roles = [
    r["expected_role_present"]
    for r in raw_checks.values()
    if r["expected_role_present"] is not None
]
checks = {}
for key in next(iter(results.values()))["checks"]:
    eligible = [r["checks"][key] for r in results.values() if r["checks"][key] is not None]
    checks[key] = {"passed": sum(eligible), "total": len(eligible)}
passing = []
for item in inputs:
    r = results[item["test_id"]]
    check = r["checks"]
    passing.append(
        not r["retrieval_check"]["missing"]
        and all(v is True for v in check.values() if v is not None)
    )
usage = Counter()
for r in results.values():
    for key, value in ((r.get("response_metadata") or {}).get("usage") or {}).items():
        if isinstance(value, int):
            usage[key] += value
retries = {
    p.stem: json.loads(p.read_text())
    for p in (folder / "model_results_retry1").glob("*.json")
    if not p.name.endswith(".request.json")
}
summary = {
    "total": len(inputs),
    "supplementary_retry": {
        tid: {k: r.get(k) for k in ("status", "error", "elapsed_ms", "diagnostic_flags")}
        for tid, r in retries.items()
    },
    "statuses": dict(statuses),
    "raw_output_checks": raw_checks,
    "raw_expected_role_presence": {"hit": sum(raw_roles), "total": len(raw_roles)},
    "diagnostic_flags": dict(
        Counter(flag for r in results.values() for flag in r["diagnostic_flags"])
    ),
    "checks": checks,
    "required_rule_id_recall": {"hit": hit, "required": required, "rate": hit / required},
    "all_required_rules_retrieved": sum(
        not i["retrieval_check"]["missing"] for i in inputs if i["retrieval_check"]["required"]
    ),
    "labelled_retrieval_questions": sum(bool(i["retrieval_check"]["required"]) for i in inputs),
    "vector_used_questions": sum(i["retrieval_check"]["vector_used"] for i in inputs),
    "cases_returned_questions": sum(i["retrieval_check"]["cases"] > 0 for i in inputs),
    "all_structural_pilot_checks_passed": sum(passing),
    "recorded_usage": dict(usage),
    "not_measured": [
        "expert semantic accuracy",
        "full prose hallucination rate",
        "chat extraction",
        "browser UI",
        "HTTP authentication",
        "independent calendar correctness",
    ],
}
(folder / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
(folder / "evaluation_checks.json").write_text(
    json.dumps({tid: r["checks"] for tid, r in results.items()}, ensure_ascii=False, indent=2)
)
names = {
    "self_health": "自占疾病",
    "mother_health": "问母亲疾病",
    "wife_husband": "妻问夫出行",
    "own_wealth": "自己求财",
    "brother_travel": "问哥哥平安",
    "child_target": "问儿子平安",
    "multiple_wealth": "妻财多现",
    "hidden_wealth": "妻财不现/伏神",
    "aunt_conflict": "姑姨关系分歧",
    "unclear_goal": "目标不明确",
    "proxy_unclear": "受托代操作视角不明",
    "self_exam": "自问考试",
}
lines = [
    "# 生产解释链路试测：固定 core＋真实检索＋LLM＋Guardian",
    "",
    "## 范围",
    "",
    "本轮为 12 题工程试测。问题与规则 ID 预期在调用前保存，卦盘由现有三数字 core 在固定时刻生成。为了覆盖单现、多现和伏神，按预定盘面条件选择数字；没有手改卦盘字段。",
    "",
    "执行真实 run_text_reasoning 检索、真实 interpretHybridEvidence 模型调用和 parseModelUseAnalysis 校验，使用原样生产 Prompt。预期答案没有进入模型请求。",
    "",
    "控制变量：问题理解采用固定 question_context，未运行前置聊天提取；没有覆盖网页、鉴权或 HTTP 路由。此处端到端指 core→检索→解释→校验这一业务片段，不是全应用验收。",
    "",
    "参考预期由已审核规则的文字及来源建立，属于工程标签，未经领域专家认证。规则 ID 召回只统计预先指定条目，其他命中原文可能也含相关语义；该指标不是穷尽标注的通用检索准确率。",
    "",
    "## 结果",
    "",
    "| 指标 | 结果 |",
    "| --- | --- |",
    f"| 实际使用向量检索 | {summary['vector_used_questions']}/12 |",
    f"| 返回古籍案例 | {summary['cases_returned_questions']}/12 |",
    f"| 预标关键规则 ID 召回 | {hit}/{required}（{hit / required:.1%}） |",
    f"| 有标签题关键规则全部命中 | {summary['all_required_rules_retrieved']}/{summary['labelled_retrieval_questions']} |",
    f"| 模型结果通过生产 Guardian | {statuses.get('generated', 0)}/12 |",
    f"| 模型结果被 Guardian 拒绝 | {statuses.get('guardian_rejected', 0)}/12 |",
    f"| 请求错误 | {statuses.get('request_error', 0)}/12 |",
    f"| 原始回答出现预期类别（未必通过校验） | {sum(raw_roles)}/{len(raw_roles)} |",
    f"| 同时通过本轮全部结构化预期 | {sum(passing)}/12 |",
    "",
    "最后一项要求关键规则召回、生产输出通过校验、预期候选类别/引用及适用的保留多候选/伏神/不选定约束全部满足。它是诊断检查通过率，不是现实预测准确率或全部解释语义正确率。",
    "",
    "## 逐题概览",
    "",
    "| 场景 | 关键规则 | 模型/校验状态 | 原始回答含预期类别 | 通过校验且符合不选定要求 |",
    "| --- | --- | --- | --- | --- |",
]
for item in inputs:
    r = results[item["test_id"]]
    c = r["checks"]
    retrieval = item["retrieval_check"]
    lines.append(
        f"| {names[item['test_id']]} | {retrieval['hit']}/{retrieval['required']} | {r['status']} | {raw_checks[item['test_id']]['expected_role_present']} | {c['required_abstention']} |"
    )
lines += [
    "",
    "## 超时题补跑（不替换首轮统计）",
    "",
    "首轮 own_wealth 报请求超时，耗时记录约 179 万毫秒，存在运行环境计时异常，不能将其解释为正常模型延迟。保留原始结果，仅对该题使用同一输入与生产 Prompt 补跑一次。",
    "",
]
for tid, retry in retries.items():
    lines += [
        f"- {tid}：{retry['status']}；耗时 {retry['elapsed_ms'] / 1000:.1f} 秒；诊断：{retry['diagnostic_flags']}。",
        f"  [补跑原始结果](model_results_retry1/{tid}.json)",
    ]
lines += [
    "",
    "## 判读边界与可定位问题",
    "",
    "- generated 仅表示结果通过程序校验，不表示每个候选的原文语义推理都正确。",
    "- 被 Guardian 拒绝的结果不会当成成功解释；预期候选计数也只使用通过校验的输出。",
    "- 无依据断言率不能从 JSON 通过率反推。逐题保留原始模型回答，供语义复核。",
    "- 常规 vitest 显示绿色仅表示评测脚本完成记录，真实业务通过率以上表及 summary.json 为准。",
    "- 规则引用覆盖在汇总阶段按通过校验的 candidates/conditions/selection/readings 合计核验；正确拒答不必为了引用规则强造候选。原始模型结果不改写，最终检查见 evaluation_checks.json。",
    "- 多现/伏神规则检索依赖程序先导出角色，现有 36 条规则未执行化；当前模型候选不会回流驱动补检索，可能遗漏相应规则。",
    "- 此轮频繁出现 CONDITION_FACT_NOT_DECLARED：模型条件引用了 question_context.subject_relation 等字段，但事实目录只提供 question.original 及 core 展开字段；有时也未把引用的已有字段列入 known_facts。",
    "- 自占疾病、子女和多现题出现额外候选/条件没有规则 ID。即使主要候选正确，一个无依据的额外条目也会使整份输出被拒绝。",
    "- 部分原始回答一边声明 missing_information 非空，一边选定唯一用神，与生产约束冲突。",
    "- 抽查通过校验的 unclear_goal：能够保留名/利两种候选并追问，但把谒贵语境的规则泛化为工作，又写出自身资质可能有优势等延伸解释。其语义支持仍需审核，不能因 Guardian 通过就宣称解读正确。",
    "",
    "## 建议修复顺序（本轮未修改生产行为）",
    "",
    "1. 把已确认且带用户证据的问题字段加入统一 fact_catalog；明确问题事实与卦盘事实的命名空间，禁止模型猜字段路径。",
    "2. 收紧生产输出指令：只生成有规则支持的候选；每个条件引用已声明事实与真实规则；有关键缺失时 selection 必须为空。必要时加入一次受控格式修复，保留首次失败。",
    "3. 调整检索查询和名额，保证关系类别规则、专题规则都有覆盖；候选多现或不现后补检索相应规则，保留召回日志。",
    "4. 用同一批固定盘复测并比较首次结果，另建未用于调优的留出题集。不得通过关闭 Guardian 或放宽虚构字段来提高通过率。",
    "",
    "## 逐题输入、候选与错误",
    "",
]
for item in inputs:
    tid = item["test_id"]
    r = results[tid]
    expected = item["expected"]
    analysis = (r.get("production_result") or {}).get("analysis") or {}
    lines += [
        "### " + names[tid] + " — " + tid,
        "",
        item["question"],
        "",
        f"固定数字：{item['chart']['numbers']}；盘面形状：{expected['chart_shape']}；预期类别：{expected['candidate_role']}。",
        "",
        "预期规则：" + "；".join(v["title"] for v in expected["required_rules"]),
        "",
        "漏召回条目："
        + "；".join(
            v["title"]
            for v in expected["required_rules"]
            if v["entity_revision_id"] in item["retrieval_check"]["missing"]
        ),
        "",
        f"状态：{r['status']}；错误：{r.get('error')}；诊断标记：{r['diagnostic_flags']}。",
        "",
        "候选与选用：",
        "```json",
        json.dumps(analysis, ensure_ascii=False, indent=2),
        "```",
        "",
        f"[完整原始回答与校验结果](model_results/{tid}.json) · [实际模型请求（无密钥）](model_results/{tid}.request.json)",
        "",
    ]
lines += [
    "## 可复现文件",
    "",
    "- fixtures.json：运行前固定的题目、core 和参考规则原文。",
    "- inputs.json：真实检索结果及逐题召回核验。",
    "- provider_status.json：本次向量探针校验状态。",
    "- manifest.json：固定时刻、知识库版本和生产代码哈希。",
    "- model_results：实际模型请求、原始回答、校验结果与耗时。",
    "- summary.json：不依赖 LLM 评分的结构化指标。",
    "",
]
(folder / "生产链路测评报告.md").write_text("\n".join(lines))
print(json.dumps(summary, ensure_ascii=False, indent=2))
