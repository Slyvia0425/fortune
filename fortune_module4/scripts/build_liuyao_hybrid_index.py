"""Build the stage-four review-only hybrid retrieval index."""

from __future__ import annotations

import argparse
from pathlib import Path

from app.services.liuyao_retrieval import build_index, write_index


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage2", type=Path, required=True)
    parser.add_argument("--stage3", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--dimension",
        type=int,
        default=None,
        help="Use deterministic hash embeddings for offline builds",
    )
    args = parser.parse_args()
    write_index(build_index(args.stage2, args.stage3, dimension=args.dimension), args.output)


if __name__ == "__main__":
    main()
