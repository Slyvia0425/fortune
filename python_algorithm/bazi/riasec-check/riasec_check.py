"""Check the ten-god → RIASEC mapping with sentence embeddings.

Usage
    pip install sentence-transformers
    python riasec_check.py                     # default model, all three renderings
    python riasec_check.py --model BAAI/bge-m3
    python riasec_check.py --selftest          # no model; verifies the plumbing only

What it does
    For each ten god, embeds the cited passage and the six RIASEC definitions,
    then reports where the hand-assigned type ranks by cosine similarity.

How to read it
    The headline number is not the hit rate but the SPREAD. If the six
    similarities for one passage sit within about 0.05 of each other, the model
    cannot separate the types and the hit rate is noise — that is what happened
    with averaged word vectors. Look for:
      · spread ≳ 0.15 within each row
      · top-2 hit rate clearly above the 33% baseline
      · no single type winning most rows (that is a bias, not a finding)
      · the three renderings broadly agreeing with each other
"""

import argparse
import json
import math
from pathlib import Path

DATA = Path(__file__).with_name("riasec_check_data.json")
BASELINE_TOP1, BASELINE_TOP2 = 1 / 6, 2 / 6


def binomial_tail(hits: int, n: int, p: float) -> float:
    """P(X >= hits) — how surprising the result would be by chance."""
    return sum(math.comb(n, k) * p**k * (1 - p) ** (n - k) for k in range(hits, n + 1))


def load_encoder(model_name: str, selftest: bool):
    if selftest:
        # Deterministic pseudo-embeddings: exercises the plumbing, means nothing.
        import hashlib

        def encode(texts):
            out = []
            for t in texts:
                h = hashlib.sha256(t.encode()).digest()
                out.append([b / 255 for b in h[:64]])
            return out

        return encode, "selftest (no model)"

    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(model_name)
    return (lambda texts: model.encode(texts, normalize_embeddings=True)), model_name


def cosine(a, b) -> float:
    dot = float(sum(x * y for x, y in zip(a, b)))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def run(rendering: str, data: dict, encode) -> dict:
    lang = "en" if rendering == "english" else "zh"
    types = list(data["riasec"][lang])
    type_vecs = dict(zip(types, encode([data["riasec"][lang][t] for t in types])))
    passage_vecs = encode([g[rendering] for g in data["ten_gods"]])

    rows, top1, top2, spreads, winners = [], 0, 0, [], {}
    for god, vec in zip(data["ten_gods"], passage_vecs):
        scores = sorted(((t, cosine(vec, type_vecs[t])) for t in types), key=lambda x: -x[1])
        rank = [t for t, _ in scores].index(god["assigned"]) + 1
        top1 += rank == 1
        top2 += rank <= 2
        spreads.append(scores[0][1] - scores[-1][1])
        winners[scores[0][0]] = winners.get(scores[0][0], 0) + 1
        # float() 不可省：sentence-transformers 返回 numpy 标量，json 无法序列化
        rows.append(dict(name=god["name"], assigned=god["assigned"], rank=rank,
                         scores=[(t, round(float(s), 3)) for t, s in scores]))

    n = len(rows)
    return dict(rendering=rendering, rows=rows, n=n, top1=top1, top2=top2,
                mean_spread=float(sum(spreads) / n),
                p_top2=binomial_tail(top2, n, BASELINE_TOP2),
                winners=winners)


def report(result: dict) -> None:
    n = result["n"]
    print(f"\n=== {result['rendering']} ===")
    for r in result["rows"]:
        mark = "✓" if r["rank"] == 1 else ("○" if r["rank"] <= 2 else "✗")
        seq = "  ".join(f"{t}{s:.2f}" for t, s in r["scores"])
        print(f"  {r['name']:<4} 指定 {r['assigned']}  {mark} 第 {r['rank']} 位   {seq}")
    print(f"  第一位 {result['top1']}/{n}（基线 {BASELINE_TOP1:.0%}）"
          f"　前两位 {result['top2']}/{n}（基线 {BASELINE_TOP2:.0%}，p={result['p_top2']:.3f}）")
    print(f"  平均极差 {result['mean_spread']:.3f}"
          f"{'  ← 过小，模型无法区分六型，命中率不可信' if result['mean_spread'] < 0.08 else ''}")
    top = max(result["winners"].items(), key=lambda x: x[1])
    if top[1] > n / 2:
        print(f"  ⚠ {top[0]} 在 {top[1]}/{n} 行位列第一，存在系统性偏向")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="sentence-transformers/paraphrase-multilingual-mpnet-base-v2")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--out", default="riasec_check_result.json")
    args = ap.parse_args()

    data = json.loads(DATA.read_text(encoding="utf-8"))
    encode, model_name = load_encoder(args.model, args.selftest)
    print(f"模型：{model_name}　样本：{len(data['ten_gods'])} 条带引文的映射"
          f"（{'、'.join(e['name'] for e in data['excluded'])} 无引文，不参与）")

    results = [run(r, data, encode) for r in ("classical", "modern", "english")]
    for r in results:
        report(r)

    print("\n=== 三种表述是否一致 ===")
    for i, god in enumerate(data["ten_gods"]):
        ranks = [r["rows"][i]["rank"] for r in results]
        flag = "" if max(ranks) - min(ranks) <= 1 else "  ← 三者分歧大，该条结果不稳定"
        print(f"  {god['name']:<4} 文言 {ranks[0]}　白话 {ranks[1]}　英文 {ranks[2]}{flag}")

    Path(args.out).write_text(
        json.dumps({"model": model_name, "results": results}, ensure_ascii=False, indent=1),
        encoding="utf-8")
    print(f"\n完整结果已写入 {args.out}")


if __name__ == "__main__":
    main()
