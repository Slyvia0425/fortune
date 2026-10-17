import { describe, expect, it } from "vitest";

import { contribution } from "../lib/bazi/strength";

describe("what a strength factor adds to the weighted total", () => {
  it("is degree × weight for a support, and (1 − degree) × |weight| for a resistance", () => {
    expect(contribution({ score: 0.75, weight: 0.5 })).toEqual({ formula: "0.75 × 0.5", value: 0.375 });
    const resistance = contribution({ score: 0.125, weight: -0.15 });
    expect(resistance.formula).toBe("（1 − 0.125）× 0.15");
    expect(resistance.value).toBeCloseTo(0.13125, 10);
  });
});
