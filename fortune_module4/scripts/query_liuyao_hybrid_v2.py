"""Local audit entry point for §17–24. Review access is deliberately CLI-only."""

import argparse
import json
from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine

from app.services.embeddings import get_embedding_provider
from app.services.knowledge_v2.hybrid import run_production, run_review_local
from app.services.knowledge_v2.runtime import RuntimeStore
from app.services.knowledge_v2.vectorize import verify_provider


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("question")
    parser.add_argument("--numbers", type=int, nargs=3, required=True)
    parser.add_argument("--review", action="store_true")
    parser.add_argument("--keyword-only", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    data = root / "data/liuyao_knowledge/stage7-v2.2"
    release = json.loads((data / "preparation_report.json").read_text())["release_id"]
    engine = create_engine("sqlite:///" + str(data / "knowledge.sqlite3"))
    store = RuntimeStore(root / "fortune_module4/.runtime/liuyao-hybrid.sqlite3")
    chart = store.freeze_once("local-audit", str(uuid4()), args.numbers, args.question)
    provider = None
    if args.review and not args.keyword_only:
        provider = get_embedding_provider()
        verify_provider(provider, data / "probe_baseline.json")
    if args.review:
        pack = run_review_local(engine, release, args.question, chart, provider=provider)
    else:
        pack = run_production(
            engine,
            release,
            args.question,
            chart_id=chart["chart_id"],
            core_loader=lambda cid: store.load("local-audit", cid),
        )
    store.save("local-audit", pack)
    engine.dispose()
    output = json.dumps(pack, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output)
        print(args.output.resolve())
    else:
        print(output)


if __name__ == "__main__":
    main()
