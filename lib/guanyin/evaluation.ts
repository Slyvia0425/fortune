import evaluationData from "../../data/guanyin/evaluation-cases.json";

import { buildGuanyinStructuredReasoning } from "./reasoning";
import { getGuanyinTag, guanyinReviewedSemanticProfiles, guanyinSecondPassReview } from "./semantic";
import { isQuestionDomain, questionDomains, type GuanyinReasoningStatement, type QuestionDomain } from "./types";

export const guanyinExpectedDirections = ["advance", "hold", "wait", "hold_wait", "verify", "seek_help", "no_action"] as const;
export type GuanyinExpectedDirection = (typeof guanyinExpectedDirections)[number];

export interface GuanyinEvaluationCase {
  id: string;
  signId: number;
  domain: QuestionDomain;
  question: string;
  requiredTags: string[];
  forbiddenTags: string[];
  expectedDirection: GuanyinExpectedDirection;
}

export interface GuanyinEvaluationMetrics {
  casePassRate: number;
  requiredTagRecall: number;
  forbiddenTagLeakageRate: number;
  directionAccuracy: number;
  evidenceTraceabilityRate: number;
  domainBoundaryViolationRate: number;
  intentBoundaryViolationRate: number;
  rejectedTagLeakageRate: number;
  unavailableAbstentionRate: number;
}

export interface GuanyinEvaluationReport {
  version: string;
  caseCount: number;
  passedCaseCount: number;
  metrics: GuanyinEvaluationMetrics;
  thresholds: GuanyinEvaluationMetrics;
  criticalFailures: readonly string[];
  passed: boolean;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`观音签自动评价数据无效：${message}`);
}

const directions = new Set<string>(guanyinExpectedDirections);
const caseIds = new Set<string>();
const caseSignIds = new Set<number>();

export const guanyinEvaluationCases = Object.freeze(evaluationData.cases.map((value): GuanyinEvaluationCase => {
  assert(value.id.length > 0 && !caseIds.has(value.id), `案例 ID ${value.id} 为空或重复。`);
  assert(Number.isInteger(value.signId), `${value.id} 的签号无效。`);
  assert(!caseSignIds.has(value.signId), `第 ${value.signId} 签存在重复基准案例。`);
  assert(isQuestionDomain(value.domain), `${value.id} 的领域无效。`);
  assert(value.question.trim().length > 0, `${value.id} 缺少问题。`);
  assert(value.requiredTags.length > 0, `${value.id} 至少需要一个必需标签。`);
  assert(value.requiredTags.every((tagId) => getGuanyinTag(tagId)), `${value.id} 包含未知必需标签。`);
  assert(value.forbiddenTags.every((tagId) => getGuanyinTag(tagId)), `${value.id} 包含未知禁止标签。`);
  assert(directions.has(value.expectedDirection), `${value.id} 的预期方向无效。`);
  caseIds.add(value.id);
  caseSignIds.add(value.signId);
  return value as GuanyinEvaluationCase;
}));

assert(guanyinEvaluationCases.length === guanyinReviewedSemanticProfiles.length, "基准案例必须覆盖每支已复核签且每签一个案例。");
assert(guanyinReviewedSemanticProfiles.every((profile) => caseSignIds.has(profile.signId)), "存在未被基准案例覆盖的已复核签。");

export const guanyinEvaluationThresholds: GuanyinEvaluationMetrics = Object.freeze({
  casePassRate: 0.95,
  requiredTagRecall: 1,
  forbiddenTagLeakageRate: 0,
  directionAccuracy: 0.95,
  evidenceTraceabilityRate: 1,
  domainBoundaryViolationRate: 0,
  intentBoundaryViolationRate: 0,
  rejectedTagLeakageRate: 0,
  unavailableAbstentionRate: 1,
});

function inferDirection(tagIds: ReadonlySet<string>): GuanyinExpectedDirection {
  if (tagIds.has("action.wait") && tagIds.has("risk.rushing")) return "wait";
  if (tagIds.has("action.hold") && tagIds.has("action.wait")) return "hold_wait";
  if (tagIds.has("action.advance")) return "advance";
  if (tagIds.has("action.hold")) return "hold";
  if (tagIds.has("action.wait")) return "wait";
  if (tagIds.has("action.verify")) return "verify";
  if (tagIds.has("action.seek_help")) return "seek_help";
  return "no_action";
}

function collectStatements(result: ReturnType<typeof buildGuanyinStructuredReasoning>): GuanyinReasoningStatement[] {
  return [
    ...(result.coreJudgment ? [result.coreJudgment] : []),
    ...result.themes,
    ...result.trends,
    ...result.actions,
    ...result.risks,
    ...result.timing,
    ...result.symbols,
  ];
}

function rate(numerator: number, denominator: number) {
  return denominator === 0 ? 1 : numerator / denominator;
}

export function evaluateGuanyinReasoning(): GuanyinEvaluationReport {
  let passedCases = 0;
  let requiredFound = 0;
  let requiredTotal = 0;
  let forbiddenLeaks = 0;
  let forbiddenTotal = 0;
  let correctDirections = 0;
  let traceableStatements = 0;
  let statementTotal = 0;
  let domainViolations = 0;
  let intentViolations = 0;
  let evidenceTotal = 0;
  let rejectedLeaks = 0;
  const criticalFailures: string[] = [];
  const rejectedKeys = new Set(guanyinSecondPassReview.exceptions
    .filter((exception) => exception.decision === "reject")
    .map((exception) => `${exception.signId}|${exception.tagId}|${exception.sourceId}`));

  for (const evaluationCase of guanyinEvaluationCases) {
    const result = buildGuanyinStructuredReasoning({ signId: evaluationCase.signId, domain: evaluationCase.domain, question: evaluationCase.question });
    const tagIds = new Set(result.evidence.map((item) => item.tag.id));
    const missingRequired = evaluationCase.requiredTags.filter((tagId) => !tagIds.has(tagId));
    const leakedForbidden = evaluationCase.forbiddenTags.filter((tagId) => tagIds.has(tagId));
    const direction = inferDirection(tagIds);
    requiredFound += evaluationCase.requiredTags.length - missingRequired.length;
    requiredTotal += evaluationCase.requiredTags.length;
    forbiddenLeaks += leakedForbidden.length;
    forbiddenTotal += evaluationCase.forbiddenTags.length;
    if (direction === evaluationCase.expectedDirection) correctDirections += 1;

    const evidencePairs = new Set(result.evidence.map((item) => `${item.tag.id}|${item.sourceId}`));
    const statements = collectStatements(result);
    for (const statement of statements) {
      statementTotal += 1;
      const traceable = statement.tagIds.length > 0
        && statement.tagIds.length === statement.sourceIds.length
        && statement.tagIds.every((tagId, index) => evidencePairs.has(`${tagId}|${statement.sourceIds[index]}`));
      if (traceable) traceableStatements += 1;
      else criticalFailures.push(`${evaluationCase.id} 存在无法回溯的推理陈述。`);
    }

    for (const item of result.evidence) {
      evidenceTotal += 1;
      if (item.domains && !item.domains.includes(evaluationCase.domain)) domainViolations += 1;
      if (item.intents && !item.intents.some((intent) => result.questionAnalysis.intents.includes(intent))) intentViolations += 1;
      if (rejectedKeys.has(`${evaluationCase.signId}|${item.tag.id}|${item.sourceId}`)) rejectedLeaks += 1;
    }

    const casePassed = result.coverage === "reviewed"
      && missingRequired.length === 0
      && leakedForbidden.length === 0
      && direction === evaluationCase.expectedDirection
      && statements.every((statement) => statement.tagIds.length === statement.sourceIds.length
        && statement.tagIds.every((tagId, index) => evidencePairs.has(`${tagId}|${statement.sourceIds[index]}`)));
    if (casePassed) passedCases += 1;
    else criticalFailures.push(`${evaluationCase.id} 未通过：缺少 [${missingRequired.join(", ")}]，泄漏 [${leakedForbidden.join(", ")}]，方向 ${direction}/${evaluationCase.expectedDirection}。`);
  }

  const coveredSignIds = new Set(guanyinReviewedSemanticProfiles.map((profile) => profile.signId));
  let unavailableChecks = 0;
  let unavailableAbstentions = 0;
  for (let signId = 1; signId <= 100; signId += 1) {
    if (coveredSignIds.has(signId)) continue;
    for (const domain of questionDomains) {
      unavailableChecks += 1;
      const result = buildGuanyinStructuredReasoning({ signId, domain, question: "" });
      if (result.coverage === "unavailable" && result.coreJudgment === null && result.evidence.length === 0) unavailableAbstentions += 1;
      else criticalFailures.push(`第 ${signId} 签 ${domain} 未在无覆盖时停止推理。`);
    }
  }

  const metrics: GuanyinEvaluationMetrics = Object.freeze({
    casePassRate: rate(passedCases, guanyinEvaluationCases.length),
    requiredTagRecall: rate(requiredFound, requiredTotal),
    forbiddenTagLeakageRate: rate(forbiddenLeaks, forbiddenTotal),
    directionAccuracy: rate(correctDirections, guanyinEvaluationCases.length),
    evidenceTraceabilityRate: rate(traceableStatements, statementTotal),
    domainBoundaryViolationRate: rate(domainViolations, evidenceTotal),
    intentBoundaryViolationRate: rate(intentViolations, evidenceTotal),
    rejectedTagLeakageRate: rate(rejectedLeaks, evidenceTotal),
    unavailableAbstentionRate: rate(unavailableAbstentions, unavailableChecks),
  });
  const passed = criticalFailures.length === 0
    && metrics.casePassRate >= guanyinEvaluationThresholds.casePassRate
    && metrics.requiredTagRecall >= guanyinEvaluationThresholds.requiredTagRecall
    && metrics.forbiddenTagLeakageRate <= guanyinEvaluationThresholds.forbiddenTagLeakageRate
    && metrics.directionAccuracy >= guanyinEvaluationThresholds.directionAccuracy
    && metrics.evidenceTraceabilityRate >= guanyinEvaluationThresholds.evidenceTraceabilityRate
    && metrics.domainBoundaryViolationRate <= guanyinEvaluationThresholds.domainBoundaryViolationRate
    && metrics.intentBoundaryViolationRate <= guanyinEvaluationThresholds.intentBoundaryViolationRate
    && metrics.rejectedTagLeakageRate <= guanyinEvaluationThresholds.rejectedTagLeakageRate
    && metrics.unavailableAbstentionRate >= guanyinEvaluationThresholds.unavailableAbstentionRate;

  return Object.freeze({
    version: evaluationData.version,
    caseCount: guanyinEvaluationCases.length,
    passedCaseCount: passedCases,
    metrics,
    thresholds: guanyinEvaluationThresholds,
    criticalFailures: Object.freeze(criticalFailures),
    passed,
  });
}
