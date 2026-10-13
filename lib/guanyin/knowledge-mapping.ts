import mappingData from "../../data/guanyin/knowledge-concept-mappings.json";

import { guanyinTagVocabulary } from "./semantic";

export type GuanyinKnowledgeMatchType = "direct" | "related" | "unmapped";

export interface GuanyinKnowledgeConcept {
  id: string;
  label: string;
  description: string;
}

export interface GuanyinKnowledgeTagMapping {
  tagId: string;
  conceptId: string | null;
  matchType: GuanyinKnowledgeMatchType;
  searchTerms: readonly string[];
  boundary: string;
}

export interface GuanyinMappedKnowledgeConcept {
  tagId: string;
  matchType: GuanyinKnowledgeMatchType;
  concept: GuanyinKnowledgeConcept | null;
  searchTerms: readonly string[];
  boundary: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`观音签知识概念映射无效：${message}`);
}

const validMatchTypes = new Set<GuanyinKnowledgeMatchType>(["direct", "related", "unmapped"]);
const concepts = Object.freeze(mappingData.concepts.map((value): GuanyinKnowledgeConcept => {
  assert(/^[a-z]+\.[a-z0-9_]+$/.test(value.id), `概念 ID ${value.id} 无效。`);
  assert(value.label.trim().length > 0 && value.description.trim().length > 0, `${value.id} 缺少名称或定义。`);
  return Object.freeze({ ...value });
}));
const conceptsById = new Map(concepts.map((concept) => [concept.id, concept]));
assert(conceptsById.size === concepts.length, "概念 ID 不得重复。");

const mappings = Object.freeze(mappingData.mappings.map((value): GuanyinKnowledgeTagMapping => {
  assert(validMatchTypes.has(value.matchType as GuanyinKnowledgeMatchType), `${value.tagId} 的映射类型无效。`);
  assert(value.boundary.trim().length > 0, `${value.tagId} 缺少语义边界。`);
  if (value.matchType === "unmapped") {
    assert(value.conceptId === null && value.searchTerms.length === 0, `${value.tagId} 未映射时不能配置概念或检索词。`);
  } else {
    assert(value.conceptId !== null && conceptsById.has(value.conceptId), `${value.tagId} 引用了未知概念。`);
    assert(value.searchTerms.length > 0 && value.searchTerms.every((term) => term.trim().length > 0), `${value.tagId} 缺少有效检索词。`);
  }
  return Object.freeze({ ...value, matchType: value.matchType as GuanyinKnowledgeMatchType, searchTerms: Object.freeze([...value.searchTerms]) });
}));

const mappingsByTagId = new Map(mappings.map((mapping) => [mapping.tagId, mapping]));
assert(mappingsByTagId.size === mappings.length, "标签映射不得重复。");
const vocabularyIds = new Set(guanyinTagVocabulary.map((tag) => tag.id));
assert(mappings.every((mapping) => vocabularyIds.has(mapping.tagId)), "映射表包含未知语义标签。");
assert(guanyinTagVocabulary.every((tag) => mappingsByTagId.has(tag.id)), "每个受控语义标签都必须登记映射状态。");

export const guanyinKnowledgeMappingVersion = mappingData.version;
export const guanyinKnowledgeMappingPolicy = Object.freeze([...mappingData.policy]);
export const guanyinKnowledgeConcepts = concepts;
export const guanyinKnowledgeTagMappings = mappings;

export function getGuanyinKnowledgeMapping(tagId: string): GuanyinMappedKnowledgeConcept | null {
  const mapping = mappingsByTagId.get(tagId);
  if (!mapping) return null;
  return Object.freeze({
    tagId: mapping.tagId,
    matchType: mapping.matchType,
    concept: mapping.conceptId ? conceptsById.get(mapping.conceptId) ?? null : null,
    searchTerms: mapping.searchTerms,
    boundary: mapping.boundary,
  });
}

export function mapGuanyinTagsToKnowledgeConcepts(tagIds: readonly string[]): readonly GuanyinMappedKnowledgeConcept[] {
  const seen = new Set<string>();
  return Object.freeze(tagIds.flatMap((tagId) => {
    if (seen.has(tagId)) return [];
    seen.add(tagId);
    const mapping = getGuanyinKnowledgeMapping(tagId);
    return mapping ? [mapping] : [];
  }));
}
