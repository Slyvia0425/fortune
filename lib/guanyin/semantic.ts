import assignmentData from "../../data/guanyin/sign-tag-assignments.json";
import reviewData from "../../data/guanyin/second-pass-review.json";
import vocabularyData from "../../data/guanyin/tag-vocabulary.json";

import { getGuanyinStick } from "./library";
import {
  questionDomains,
  guanyinQuestionIntents,
  semanticTagTypes,
  type GuanyinSemanticEvidenceResult,
  type GuanyinSignSemanticProfile,
  type GuanyinTagAssignment,
  type GuanyinTagReviewException,
  type SemanticTagDefinition,
  type TagEvidenceType,
} from "./types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`观音签语义数据校验失败：${message}`);
}

const tagTypes = new Set<string>(semanticTagTypes);
const domainNames = new Set<string>(questionDomains);
const intentNames = new Set<string>(guanyinQuestionIntents);
const reviewDecisions = new Set(["accept", "reject", "change_tag", "lower_confidence"]);

export const guanyinTagVocabulary = Object.freeze(vocabularyData.tags.map((value): SemanticTagDefinition => {
  assert(typeof value.id === "string" && /^[a-z]+\.[a-z0-9_]+$/.test(value.id), `标签 ID ${String(value.id)} 无效。`);
  assert(typeof value.label === "string" && value.label.length > 0, `${value.id} 缺少名称。`);
  assert(tagTypes.has(value.type), `${value.id} 的标签类型无效。`);
  assert(typeof value.description === "string" && value.description.length > 0, `${value.id} 缺少定义。`);
  assert(Array.isArray(value.aliases), `${value.id} 的别名必须是数组。`);
  return { ...value, type: value.type as SemanticTagDefinition["type"] };
}));

const tagsById = new Map(guanyinTagVocabulary.map((tag) => [tag.id, tag]));

function evidenceCorpus(signId: number, evidenceType: TagEvidenceType): string {
  const stick = getGuanyinStick(signId);
  if (evidenceType === "poem") return stick.poem.join("；");
  if (evidenceType === "jieyue") return stick.traditional.jieyue;
  if (evidenceType === "xianji") return stick.traditional.xianji;
  if (evidenceType === "topic") return Object.values(stick.traditional.topics).join("；");
  if (evidenceType === "diangu") return stick.traditional.diangu;
  return "";
}

const seenSignIds = new Set<number>();

export const guanyinSemanticProfiles = Object.freeze(assignmentData.assignments.map((value): GuanyinSignSemanticProfile => {
  getGuanyinStick(value.signId);
  assert(!seenSignIds.has(value.signId), `第 ${value.signId} 签存在重复语义档案。`);
  seenSignIds.add(value.signId);
  assert(Array.isArray(value.tags) && value.tags.length > 0, `第 ${value.signId} 签没有标签。`);
  const tags = value.tags.map((assignment) => {
    assert(tagsById.has(assignment.tagId), `第 ${value.signId} 签引用未知标签 ${assignment.tagId}。`);
    assert(assignment.confidence >= 0 && assignment.confidence <= 1, `第 ${value.signId} 签 ${assignment.tagId} 置信度越界。`);
    assert(assignment.sourceId.startsWith(`guanyin-100-v1:sign:${String(value.signId).padStart(3, "0")}:`), `第 ${value.signId} 签 ${assignment.tagId} 来源 ID 无效。`);
    if (assignment.domains) {
      assert(assignment.domains.length > 0 && assignment.domains.every((domain) => domainNames.has(domain)), `第 ${value.signId} 签 ${assignment.tagId} 的适用领域无效。`);
    }
    if (assignment.intents) {
      assert(assignment.intents.length > 0 && assignment.intents.every((intent) => intentNames.has(intent)), `第 ${value.signId} 签 ${assignment.tagId} 的适用意图无效。`);
    }
    if (assignment.evidenceType === "topic") {
      assert(Boolean(assignment.domains?.length), `第 ${value.signId} 签 ${assignment.tagId} 的 topic 证据必须声明适用领域。`);
    }
    if (assignment.evidenceType !== "editorial") {
      const corpus = evidenceCorpus(value.signId, assignment.evidenceType as TagEvidenceType);
      const clauses = assignment.evidenceText.split("；").map((part) => part.trim()).filter(Boolean);
      assert(clauses.every((clause) => corpus.includes(clause)), `第 ${value.signId} 签 ${assignment.tagId} 的证据不在原始字段中。`);
    }
    return assignment as GuanyinSignSemanticProfile["tags"][number];
  });
  return { signId: value.signId, tags };
}));

function assignmentKey(signId: number, tagId: string, sourceId: string) {
  return `${signId}|${tagId}|${sourceId}`;
}

const originalAssignments = new Map<string, GuanyinTagAssignment>();
for (const profile of guanyinSemanticProfiles) {
  for (const assignment of profile.tags) {
    const key = assignmentKey(profile.signId, assignment.tagId, assignment.sourceId);
    assert(!originalAssignments.has(key), `第 ${profile.signId} 签 ${assignment.tagId} 存在重复标注。`);
    originalAssignments.set(key, assignment);
  }
}

const reviewedAssignmentCount = [...originalAssignments.values()].filter((assignment) => assignment.reviewStatus === "reviewed").length;
assert(reviewData.assignmentCount === reviewedAssignmentCount, `复核记录声称有 ${reviewData.assignmentCount} 条已复核标注，实际为 ${reviewedAssignmentCount} 条。`);
assert(reviewData.defaultDecision === "accept", "当前只支持默认接受、例外修正的复核策略。");

const reviewExceptions = new Map<string, GuanyinTagReviewException>();
for (const value of reviewData.exceptions) {
  const exception = value as GuanyinTagReviewException;
  const key = assignmentKey(exception.signId, exception.tagId, exception.sourceId);
  assert(originalAssignments.has(key), `复核例外未找到原标注：第 ${exception.signId} 签 ${exception.tagId}。`);
  assert(!reviewExceptions.has(key), `复核例外重复：第 ${exception.signId} 签 ${exception.tagId}。`);
  assert(reviewDecisions.has(exception.decision), `第 ${exception.signId} 签 ${exception.tagId} 的复核决定无效。`);
  assert(exception.reason.trim().length > 0, `第 ${exception.signId} 签 ${exception.tagId} 的复核理由为空。`);
  if (exception.decision === "change_tag") {
    assert(Boolean(exception.proposedTagId && tagsById.has(exception.proposedTagId)), `第 ${exception.signId} 签 ${exception.tagId} 的替代标签无效。`);
  }
  if (exception.proposedConfidence !== undefined) {
    assert(exception.proposedConfidence >= 0 && exception.proposedConfidence <= 1, `第 ${exception.signId} 签 ${exception.tagId} 的复核置信度越界。`);
  }
  if (exception.decision === "lower_confidence") {
    const original = originalAssignments.get(key)!;
    assert(exception.proposedConfidence !== undefined && exception.proposedConfidence < original.confidence, `第 ${exception.signId} 签 ${exception.tagId} 降低置信度时必须提供更低的新值。`);
  }
  reviewExceptions.set(key, exception);
}

function applySecondPassReview(signId: number, assignment: GuanyinTagAssignment): GuanyinTagAssignment | null {
  const exception = reviewExceptions.get(assignmentKey(signId, assignment.tagId, assignment.sourceId));
  if (!exception || exception.decision === "accept") return assignment;
  if (exception.decision === "reject") return null;
  if (exception.decision === "change_tag") {
    return { ...assignment, tagId: exception.proposedTagId!, confidence: exception.proposedConfidence ?? assignment.confidence };
  }
  return { ...assignment, confidence: exception.proposedConfidence ?? assignment.confidence };
}

export const guanyinSecondPassReview = Object.freeze({
  version: reviewData.version,
  reviewedAt: reviewData.reviewedAt,
  scope: reviewData.scope,
  humanAdjudicationRequired: reviewData.humanAdjudicationRequired,
  overlapFindings: reviewData.overlapFindings,
  exceptions: Object.freeze([...reviewExceptions.values()]),
});

export const guanyinReviewedSemanticProfiles = Object.freeze(
  guanyinSemanticProfiles
    .map((profile): GuanyinSignSemanticProfile => ({
      signId: profile.signId,
      tags: profile.tags
        .filter((assignment) => assignment.reviewStatus === "reviewed")
        .map((assignment) => applySecondPassReview(profile.signId, assignment))
        .filter((assignment): assignment is GuanyinTagAssignment => assignment !== null),
    }))
    .filter((profile) => profile.tags.length > 0),
);

const profilesBySign = new Map(guanyinReviewedSemanticProfiles.map((profile) => [profile.signId, profile]));

export function getGuanyinSemanticProfile(signId: number) {
  return profilesBySign.get(signId) ?? null;
}

export function getGuanyinTag(tagId: string) {
  return tagsById.get(tagId) ?? null;
}

export function retrieveGuanyinSemanticEvidence(signId: unknown, domain: unknown, intents: readonly string[] = ["general"]): GuanyinSemanticEvidenceResult {
  const stick = getGuanyinStick(signId);
  if (typeof domain !== "string" || !domainNames.has(domain)) {
    throw new TypeError(`问题领域 ${String(domain)} 无效，可用领域为：${questionDomains.join("、")}。`);
  }
  const questionDomain = domain as GuanyinSemanticEvidenceResult["domain"];
  assert(intents.length > 0 && intents.every((intent) => intentNames.has(intent)), `问题意图 ${intents.join("、")} 无效。`);
  const activeIntents = new Set(intents);
  const profile = profilesBySign.get(stick.id);
  if (!profile) {
    return Object.freeze({ signId: stick.id, domain: questionDomain, coverage: "unavailable", tags: Object.freeze([]) });
  }

  const tags = profile.tags
    .filter((assignment) => !assignment.domains || assignment.domains.includes(questionDomain))
    .filter((assignment) => !assignment.intents || assignment.intents.some((intent) => activeIntents.has(intent)))
    .map((assignment) => Object.freeze({
      tag: tagsById.get(assignment.tagId)!,
      evidenceType: assignment.evidenceType,
      evidenceText: assignment.evidenceText,
      sourceId: assignment.sourceId,
      confidence: assignment.confidence,
      method: assignment.method,
      ...(assignment.domains ? { domains: Object.freeze([...assignment.domains]) } : {}),
      ...(assignment.intents ? { intents: Object.freeze([...assignment.intents]) } : {}),
    }));

  return Object.freeze({ signId: stick.id, domain: questionDomain, coverage: "reviewed", tags: Object.freeze(tags) });
}

export function findGuanyinSignsByTag(tagId: string) {
  if (!tagsById.has(tagId)) return [];
  return guanyinReviewedSemanticProfiles.filter((profile) => profile.tags.some((assignment) => assignment.tagId === tagId)).map((profile) => profile.signId);
}
