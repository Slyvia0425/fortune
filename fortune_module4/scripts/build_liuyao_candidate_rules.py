"""Materialize reviewed-source candidate useful-god rules without enabling them."""
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
from app.services.liuyao_rule_dataset import validate_and_materialize  # noqa: E402


def as_jsonl(rows: list[dict]) -> bytes:
    return "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows).encode()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("proposal", type=Path, help="The human-authored proposal JSON")
    parser.add_argument("--stage2", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    proposal_bytes = args.proposal.read_bytes()
    corpus = validate_and_materialize(
        json.loads(proposal_bytes), args.stage2, hashlib.sha256(proposal_bytes).hexdigest()
    )
    files = {
        "rules.jsonl": as_jsonl(corpus["rules"]),
        "method_profiles.jsonl": as_jsonl(corpus["method_profiles"]),
        "conflict_groups.jsonl": as_jsonl(corpus["conflict_groups"]),
    }
    manifest = dict(corpus["manifest"])
    manifest["files"] = {name: hashlib.sha256(value).hexdigest() for name, value in files.items()}
    files["manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
    files["report.md"] = (
        "# 六爻候选用神规则（审阅版）\n\n"
        "- 规则数：%d\n- 全部待审核：是\n- 可执行规则：0\n"
        "- 正式规则执行：禁用\n\n"
        "每条规则均已校验到第二阶段原文段落；规则含义、条件、例外仍须人工审核。\n"
        % manifest["rule_count"]
    ).encode()
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    if not args.write:
        print("Dry run: no files written. Use --write for review artifacts.")
        return 0
    if args.output.exists():
        same = all((args.output / name).is_file() and (args.output / name).read_bytes() == data for name, data in files.items())
        if same and {path.name for path in args.output.iterdir()} == set(files):
            print("Identical output already exists; no changes.")
            return 0
        raise ValueError("Output differs; choose a new version directory")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".liuyao-rules-", dir=args.output.parent))
    try:
        for name, data in files.items():
            (staging / name).write_bytes(data)
        if args.proposal.read_bytes() != proposal_bytes:
            raise ValueError("Proposal changed during build")
        os.rename(staging, args.output)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    print(f"Wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
