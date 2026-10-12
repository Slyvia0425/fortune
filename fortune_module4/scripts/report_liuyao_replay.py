"""Compare a fixed-input model replay with its preserved baseline."""

import json
import sys
from collections import Counter
from pathlib import Path

folder = Path(sys.argv[1])
manifest = json.loads((folder / "manifest.json").read_text())
baseline = Path(manifest["baseline"])
inputs = json.loads((folder / "inputs.json").read_text())


def load_results(path):
    return {
        item["test_id"]: json.loads(
            (path / "model_results" / (item["test_id"] + ".json")).read_text()
        )
        for item in inputs
    }


old, new = load_results(baseline), load_results(folder)
summary = {
    "mode": "fixed_retrieval_replay",
    "baseline_statuses": dict(Counter(r["status"] for r in old.values())),
    "new_statuses": dict(Counter(r["status"] for r in new.values())),
    "checks": {},
    "diagnostic_flags": dict(Counter(flag for r in new.values() for flag in r["diagnostic_flags"])),
}
for key in next(iter(new.values()))["checks"]:
    values = [r["checks"][key] for r in new.values() if r["checks"][key] is not None]
    summary["checks"][key] = {"passed": sum(values), "total": len(values)}
summary["attempt_metrics"] = {
    "first_attempt_passed": sum(
        r.get("first_attempt_pass", r["status"] == "generated") for r in new.values()
    ),
    "repair_attempted": sum(bool(r.get("repair_attempted")) for r in new.values()),
    "repair_succeeded": sum(bool(r.get("repair_succeeded")) for r in new.values()),
    "attempts_recorded": sum(len(r.get("attempt_records", [])) for r in new.values()),
}
summary["required_rule_id_recall"] = {
    "hit": sum(i["retrieval_check"]["hit"] for i in inputs),
    "total": sum(i["retrieval_check"]["required"] for i in inputs),
}
summary["all_structural_checks_passed"] = sum(
    not item["retrieval_check"]["missing"]
    and all(v for v in new[item["test_id"]]["checks"].values() if v is not None)
    for item in inputs
)
(folder / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
lines = [
    "# 新版 Prompt 固定输入复测",
    "",
    "复用上一轮 12 题、固定 core 卦盘、问题上下文及真实检索证据。",
    "本轮实际重新调用生产 LLM 和 Guardian；未运行前置对话、重新排盘或重新调用向量检索。",
    "上轮向量检索的结果本轮原样回放，provider_status.json 是上轮记录，不是本轮探针。",
    "",
    "变更记录：" + manifest["changes"],
    "因此改善不能全部归因于 Prompt；模型单次采样也存在波动。",
    "参考标签是工程试测标签，未经领域专家认证。通过 Guardian 不等于语义或预测正确。",
    "",
    "## 汇总",
    "",
    "```json",
    json.dumps(summary, ensure_ascii=False, indent=2),
    "```",
    "",
    "## 逐题对比",
    "",
    "| 题目 | 首轮状态 | 本轮状态 | 候选类别符合预期 | 关键规则被引用 |",
    "| --- | --- | --- | --- | --- |",
]
for item in inputs:
    tid = item["test_id"]
    r = new[tid]
    c = r["checks"]
    lines.append(
        f"| {tid} | {old[tid]['status']} | {r['status']} | "
        f"{c['expected_role_present']} | {c['expected_rule_cited']} |"
    )
lines += [
    "",
    "检查值 null 表示该题不适用此项。被拒绝的输出不计入通过后的候选指标。",
    "对比目录：" + str(baseline) + "。旧结果保留，不覆盖历史。",
    "诊断标记只覆盖部分拒绝原因，标记为空不代表已经通过 Guardian。",
    "",
    "## 逐题结果",
    "",
]
for item in inputs:
    tid = item["test_id"]
    r = new[tid]
    accepted = (r.get("production_result") or {}).get("analysis")
    try:
        raw = json.loads(r.get("raw_output") or "null")
    except ValueError:
        raw = None
    lines += [
        f"### {tid}",
        "",
        item["question"],
        "",
        f"状态：{r['status']}；错误：{r.get('error')}；诊断：{r['diagnostic_flags']}。",
        "",
        "首次及修正记录：",
        "```json",
        json.dumps(
            [
                {k: a.get(k) for k in ("attempt", "status", "errors")}
                for a in r.get("attempt_records", [])
            ],
            ensure_ascii=False,
            indent=2,
        ),
        "```",
        "",
        "已通过校验的分析（null 表示无通过结果）：",
        "```json",
        json.dumps(accepted, ensure_ascii=False, indent=2),
        "```",
        "",
        "模型原始选择（不代表通过校验）：",
        "```json",
        json.dumps(
            raw.get("selection") if isinstance(raw, dict) else None, ensure_ascii=False, indent=2
        ),
        "```",
        "",
        f"[完整模型输出](model_results/{tid}.json) · [实际请求](model_results/{tid}.request.json)",
        "",
    ]
review_path = folder / "人工复核记录.md"
if review_path.exists():
    lines += [review_path.read_text(), ""]
lines += [
    "## 复现记录",
    "",
    "manifest.json 记录本轮代码与输入哈希；baseline_manifest.json 保留原始运行记录。",
    "model-use-analysis.snapshot.ts 保存本轮 Prompt 与校验器版本。",
    "inputs.json 保留题目、参考标签、固定卦盘及检索证据；标签不发送给模型。",
    "",
]
(folder / "新版Prompt复测报告.md").write_text("\n".join(lines))
print(json.dumps(summary, ensure_ascii=False, indent=2))
