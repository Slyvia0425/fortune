"""Build immutable stage-two artifacts; default is read-only dry run."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.liuyao_corpus import build_corpus  # noqa: E402


def serialize(corpus: dict) -> dict[str, bytes]:
    files = {}
    for name in ("sources", "chapters", "passages", "cases", "chunks", "issues"):
        files[f"{name}.jsonl"] = "".join(
            json.dumps(row, ensure_ascii=False, sort_keys=True)+"\n"
            for row in corpus[name]).encode()
    manifest = dict(corpus["manifest"])
    manifest["files"] = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    files["manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2)+"\n").encode()
    report = ["# 六爻知识库第二阶段构建报告", "", "状态：review_only，未启用正式召回。", "",
              "## 数量", "", *[f"- {k}: {v}" for k, v in manifest["counts"].items()], "",
              "## 处理原则", "", "原文完整保留，清洗只处理换行和行尾空白。",
              "章节为自动识别候选；卦例保留至下一候选或章末，可能包含后续通论。",
              "不补写数字、日期、卦盘、原断或结果；混排来源隔离。", "",
              "## 章节清单", "", "| 原记录 | 标题 | 类型 |", "|---|---|---|"]
    sources = {s["source_revision_id"]: s for s in corpus["sources"]}
    for c in corpus["chapters"]:
        report.append(f"| {sources[c['source_revision_id']]['title']} | {c['title']} | {c['kind']} |")
    report += ["", "## 复核重点", "", "- 核对章界、重复编号和漏识别标题。",
               "- 人工拆分卦例包络中的通论，确认多次占问的关联。",
               "- 隔离的《卜筮正宗》需对照底本恢复列布局。",
               "- 所有片段未完成人工来源审核，不可直接作为已验证规则或评测答案。"]
    files["report.md"] = ("\n".join(report)+"\n").encode()
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    original = args.dataset.read_bytes()
    corpus = build_corpus(json.loads(original), hashlib.sha256(original).hexdigest())
    files = serialize(corpus)
    print(json.dumps(corpus["manifest"], ensure_ascii=False, indent=2))
    if not args.write:
        print("Dry run: no files written. Use --write for review artifacts.")
        return 0
    if args.output.exists():
        if (all((args.output/name).is_file() and (args.output/name).read_bytes() == data
                for name, data in files.items())
                and set(p.name for p in args.output.iterdir()) == set(files)):
            print("Identical output already exists; no changes.")
            return 0
        raise ValueError("Output differs; choose a new version directory")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".liuyao-stage-", dir=args.output.parent))
    try:
        for name, data in files.items():
            (staging/name).write_bytes(data)
        if args.dataset.read_bytes() != original:
            raise ValueError("Source changed during build")
        os.rename(staging, args.output)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    print(f"Wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
