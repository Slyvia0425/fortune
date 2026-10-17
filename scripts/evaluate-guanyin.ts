import { evaluateGuanyinReasoning } from "../lib/guanyin/evaluation";

const report = evaluateGuanyinReasoning();
const percentage = (value: number) => `${(value * 100).toFixed(1)}%`;
const lines = [
  `观音签自动评价 v${report.version}`,
  `案例通过：${report.passedCaseCount}/${report.caseCount} (${percentage(report.metrics.casePassRate)})`,
  `必需标签召回率：${percentage(report.metrics.requiredTagRecall)}`,
  `禁止标签泄漏率：${percentage(report.metrics.forbiddenTagLeakageRate)}`,
  `行动方向准确率：${percentage(report.metrics.directionAccuracy)}`,
  `证据可追溯率：${percentage(report.metrics.evidenceTraceabilityRate)}`,
  `领域越界率：${percentage(report.metrics.domainBoundaryViolationRate)}`,
  `问题意图越界率：${percentage(report.metrics.intentBoundaryViolationRate)}`,
  `已拒绝标签泄漏率：${percentage(report.metrics.rejectedTagLeakageRate)}`,
  `未覆盖签停止推理率：${percentage(report.metrics.unavailableAbstentionRate)}`,
  `总评：${report.passed ? "通过" : "未通过"}`,
];
if (report.criticalFailures.length > 0) lines.push("严重问题：", ...report.criticalFailures.map((failure) => `- ${failure}`));
process.stdout.write(`${lines.join("\n")}\n`);
if (!report.passed) process.exitCode = 1;
