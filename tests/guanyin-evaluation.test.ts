import { describe, expect, it } from "vitest";

import {
  evaluateGuanyinReasoning,
  guanyinEvaluationCases,
  guanyinEvaluationThresholds,
} from "../lib/guanyin/evaluation";

describe("观音签自动评价", () => {
  it("基准案例一一覆盖完整 100 支签", () => {
    expect(guanyinEvaluationCases).toHaveLength(100);
    expect(new Set(guanyinEvaluationCases.map((item) => item.signId)).size).toBe(100);
  });

  it("全部自动指标达到上线门槛", () => {
    const report = evaluateGuanyinReasoning();
    expect(report.criticalFailures).toEqual([]);
    expect(report.passedCaseCount).toBe(report.caseCount);
    expect(report.metrics.casePassRate).toBeGreaterThanOrEqual(guanyinEvaluationThresholds.casePassRate);
    expect(report.metrics.requiredTagRecall).toBeGreaterThanOrEqual(guanyinEvaluationThresholds.requiredTagRecall);
    expect(report.metrics.forbiddenTagLeakageRate).toBeLessThanOrEqual(guanyinEvaluationThresholds.forbiddenTagLeakageRate);
    expect(report.metrics.directionAccuracy).toBeGreaterThanOrEqual(guanyinEvaluationThresholds.directionAccuracy);
    expect(report.metrics.evidenceTraceabilityRate).toBeGreaterThanOrEqual(guanyinEvaluationThresholds.evidenceTraceabilityRate);
    expect(report.metrics.domainBoundaryViolationRate).toBeLessThanOrEqual(guanyinEvaluationThresholds.domainBoundaryViolationRate);
    expect(report.metrics.rejectedTagLeakageRate).toBeLessThanOrEqual(guanyinEvaluationThresholds.rejectedTagLeakageRate);
    expect(report.metrics.unavailableAbstentionRate).toBeGreaterThanOrEqual(guanyinEvaluationThresholds.unavailableAbstentionRate);
    expect(report.passed).toBe(true);
  });
});
