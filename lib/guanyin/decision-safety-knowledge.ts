import data from "../../data/guanyin/decision-safety-knowledge.json";

import { guanyinQuestionIntents, type GuanyinQuestionIntent, type QuestionDomain } from "./types";

export interface GuanyinDecisionSafetyRecord {
  id: string;
  conceptId: string;
  title: string;
  tagIds: readonly string[];
  domains: readonly QuestionDomain[];
  alwaysApply?: boolean;
  intents?: readonly GuanyinQuestionIntent[];
  keywords: readonly string[];
  content: string;
  boundary: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`观音签现实决策安全知识无效：${message}`);
}

export const guanyinDecisionSafetyKnowledgeVersion = data.version;
export const guanyinDecisionSafetyRecords = Object.freeze(data.records.map((record): GuanyinDecisionSafetyRecord => {
  const intents = "intents" in record ? record.intents : undefined;
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.id), `${record.id} 的 ID 无效。`);
  assert((record.tagIds.length > 0 || record.alwaysApply === true) && record.domains.length > 0 && record.keywords.length > 0, `${record.id} 缺少适用范围。`);
  assert(!intents || (intents.length > 0 && intents.every((intent) => (guanyinQuestionIntents as readonly string[]).includes(intent))), `${record.id} 的问题意图无效。`);
  assert(record.content.trim().length > 0 && record.boundary.trim().length > 0, `${record.id} 缺少正文或边界。`);
  return Object.freeze({
    id: record.id,
    conceptId: record.conceptId,
    title: record.title,
    tagIds: Object.freeze([...record.tagIds]),
    domains: Object.freeze([...record.domains] as QuestionDomain[]),
    ...("alwaysApply" in record && record.alwaysApply ? { alwaysApply: true } : {}),
    ...(intents ? { intents: Object.freeze([...intents] as GuanyinQuestionIntent[]) } : {}),
    keywords: Object.freeze([...record.keywords]),
    content: record.content,
    boundary: record.boundary,
  });
}));

assert(new Set(guanyinDecisionSafetyRecords.map((record) => record.id)).size === guanyinDecisionSafetyRecords.length, "记录 ID 不得重复。");
