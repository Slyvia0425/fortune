"""Query the local embedded snapshot; outputs review evidence, never a divination verdict."""

import argparse
import json
from pathlib import Path

from sqlalchemy import create_engine

from app.services.embeddings import get_embedding_provider
from app.services.knowledge_v2.retrieval import review_local
from app.services.knowledge_v2.vectorize import verify_provider


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("question")
    parser.add_argument("--keyword-only", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2] / "data/liuyao_knowledge/stage7-v2.2"
    prep = json.loads((root / "preparation_report.json").read_text())
    provider = None
    if not args.keyword_only:
        provider = get_embedding_provider()
        verify_provider(provider, root / "probe_baseline.json")
    engine = create_engine("sqlite:///" + str(root / "knowledge.sqlite3"))
    result = review_local(
        engine,
        args.question,
        prep["release_id"],
        method="zengshan-single-cast-v1",
        provider=provider,
    )
    engine.dispose()
    serialized = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(serialized)
        print(str(args.output.resolve()))
    else:
        print(serialized)


if __name__ == "__main__":
    main()
