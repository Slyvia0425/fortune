/**
 * What a strength factor adds to the weighted total. A resistance (negative weight) counts for what is left once it is taken off,
 * (1 − degree) × |weight|, so every row is added and the rows sum to the total.
 */
export function contribution(factor: { score: number; weight: number }): { formula: string; value: number } {
  if (factor.weight < 0) {
    const weight = Math.abs(factor.weight);
    return { formula: `（1 − ${factor.score}）× ${weight}`, value: (1 - factor.score) * weight };
  }
  return { formula: `${factor.score} × ${factor.weight}`, value: factor.score * factor.weight };
}
