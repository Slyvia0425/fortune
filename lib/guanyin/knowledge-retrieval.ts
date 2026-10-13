import type { KnowledgeCategory, KnowledgeSearchItem } from "../contracts/knowledge";
import { searchKnowledge } from "../knowledge/library";
import { guanyinDecisionSafetyRecords } from "./decision-safety-knowledge";
import { guanyinKnowledgeMappingVersion, mapGuanyinTagsToKnowledgeConcepts, type GuanyinMappedKnowledgeConcept } from "./knowledge-mapping";
import type { GuanyinQuestionIntent, GuanyinStructuredReasoning, QuestionDomain } from "./types";

export type GuanyinKnowledgeRetrievalStatus = "supported" | "partial" | "unavailable";

export interface GuanyinKnowledgeEvidenceItem {
  sourceId: string;
  title: string;
  catalog: string;
  categories: readonly KnowledgeCategory[];
  url: string;
  sourceType: "traditional" | "system_safety";
  boundary: string | null;
  excerpt: string;
  score: number;
  matchedTerms: readonly string[];
  tagIds: readonly string[];
  conceptIds: readonly string[];
}

export interface GuanyinKnowledgeRetrievalResult {
  status: GuanyinKnowledgeRetrievalStatus;
  mappingVersion: string;
  requestedTagIds: readonly string[];
  mappings: readonly GuanyinMappedKnowledgeConcept[];
  evidence: readonly GuanyinKnowledgeEvidenceItem[];
  unsupportedTagIds: readonly string[];
  noEvidenceTagIds: readonly string[];
  warnings: readonly string[];
}

export interface RetrieveGuanyinKnowledgeOptions {
  limit?: number;
  perTermLimit?: number;
  domain?: QuestionDomain;
  intents?: readonly GuanyinQuestionIntent[];
}

const traditionalCharacters: Readonly<Record<string, string>> = Object.freeze({
  时: "時", 后: "後", 难: "難", 进: "進", 动: "動", 为: "為", 虚: "虛", 里: "裡", 劳: "勞", 无: "無",
  费: "費", 转: "轉", 渐: "漸", 旧: "舊", 误: "誤", 实: "實", 谋: "謀", 迟: "遲", 云: "雲", 开: "開",
  见: "見", 变: "變", 际: "際", 机: "機", 缘: "緣", 诚: "誠", 传: "傳", 伤: "傷", 显: "顯", 疑: "疑",
});

function traditionalVariant(term: string) {
  return [...term].map((character) => traditionalCharacters[character] ?? character).join("");
}

function queryVariants(term: string) {
  return Object.freeze([...new Set([term, traditionalVariant(term)])]);
}

function isRelevantCorpusItem(item: KnowledgeSearchItem) {
  return !item.catalog.includes("八字命理") && !item.catalog.includes("现代译注与研究") && !item.catalog.includes("现代校注与研究");
}

function contextExcerpt(content: string, terms: readonly string[], radius = 105) {
  const compact = content.replace(/[#*`>|_\[\]]+/g, " ").replace(/\s+/g, " ").trim();
  const positions = terms.map((term) => compact.indexOf(term)).filter((index) => index >= 0);
  if (!positions.length) return compact.slice(0, radius * 2) + (compact.length > radius * 2 ? "…" : "");
  const position = Math.min(...positions);
  const start = Math.max(0, position - radius);
  const end = Math.min(compact.length, position + radius);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}

function categoryWeight(categories: readonly KnowledgeCategory[]) {
  if (categories.includes("original")) return 4;
  if (categories.includes("commentary")) return 3;
  if (categories.includes("translation")) return 2;
  return 1;
}

function catalogWeight(catalog: string) {
  if (catalog.includes("关圣帝君灵签")) return 5;
  if (catalog.includes("占卜文献")) return 4;
  if (catalog.includes("经典文献")) return 3;
  if (catalog.includes("基础理论")) return 2;
  return 0;
}

function compactText(value: string) {
  return value.replace(/[#*`>|_\[\]]+/g, " ").replace(/\s+/g, " ").trim();
}

function termContext(content: string, term: string, radius = 180) {
  const compact = compactText(content);
  const position = compact.indexOf(term);
  if (position < 0) return "";
  return compact.slice(Math.max(0, position - radius), Math.min(compact.length, position + term.length + radius));
}

const certaintyTerms = /天數難逃|天数难逃|天定|注定|天作之合|百年偕老|必成|必亨通|終身無成|终身无成|竟無成|竟无成|必可|必然|定然/;
const fatalisticTerms = /必能轉旺|必能转旺|可即定之|天必佑之|不可交|不可就|終不遂|终不遂|萬事成空|万事成空|富貴前定|富贵前定|飲啄皆前定|饮啄皆前定|行止聽安排|行止听安排|到底無益|到底无益|命之所致|時也命也|时也命也|付之命|聽天推|听天推|與無緣|与无缘|無緣|无缘|改行|無望|无望/;
const fixedTimingTerms = /五年之[厄難难]|逢卯|遇卯|卯日|卯年|秋期|仲秋|晚成|終獲出頭|终获出头|必待.*(?:月|年|日)|定於.*(?:月|年|日)|定于.*(?:月|年|日)/;
const rebuttalTerms = /殊不知|未必|不可執|不可执|不以此論|不以此论|不作此論|不作此论|非此論|非此论/;
const quotedRuleTerms = /古法|古云|諸書|诸书|有曰|舊說|旧说|謂之|谓之/;

const domainHeadings: Readonly<Record<QuestionDomain, readonly string[]>> = Object.freeze({
  career: Object.freeze(["功名", "事业", "事業", "时运", "時運"]),
  marriage: Object.freeze(["婚姻"]),
  wealth: Object.freeze(["求财", "求財", "生意"]),
  health: Object.freeze(["疾病"]),
  family: Object.freeze(["丁口", "家宅"]),
  travel: Object.freeze(["出行", "行人"]),
});
const allDomainHeadings = Object.freeze(Object.values(domainHeadings).flat());

function matchesRequestedDomain(content: string, term: string, domain?: QuestionDomain) {
  if (!domain) return true;
  const lines = content.split(/\r?\n/).filter((line) => line.includes(term));
  if (!lines.length) return true;
  return lines.some((line) => {
    const heading = allDomainHeadings.find((candidate) => new RegExp(`(?:^|[*#\\s])${candidate}\\s*[:：]`).test(line));
    return !heading || domainHeadings[domain].includes(heading);
  });
}

function requestedDomainHasUnsafeConclusion(content: string, domain?: QuestionDomain) {
  if (!domain) return false;
  return content.split(/\r?\n/).some((line) => domainHeadings[domain].some((heading) => new RegExp(`(?:^|[*#\\s])${heading}\\s*[:：]`).test(line))
    && (certaintyTerms.test(line) || fatalisticTerms.test(line)));
}

function associationAllowed(tagId: string, item: KnowledgeSearchItem, term: string, domain?: QuestionDomain) {
  const context = termContext(item.content, term);
  const document = compactText(item.content);
  if (!context) return false;
  if (!matchesRequestedDomain(item.content, term, domain)) return false;
  if (requestedDomainHasUnsafeConclusion(item.content, domain)) return false;
  if (quotedRuleTerms.test(context) && rebuttalTerms.test(context)) return false;
  if ((tagId === "symbol.moon_cloud" || tagId === "pattern.obscured_then_clear" || tagId === "risk.uncertainty") && /納甲六爻|纳甲六爻/.test(item.catalog)) return false;
  if (tagId === "risk.hidden_harm" && /納甲六爻|纳甲六爻|官鬼|刑克/.test(`${item.catalog} ${context}`)) return false;
  if ((tagId === "theme.deception" || tagId === "action.verify" || tagId === "risk.false_promise") && /納甲六爻|纳甲六爻|基礎理論|基础理论/.test(item.catalog)) return false;
  if (tagId === "theme.foundation" && (/^序$/.test(item.title.trim()) || /五行大義|五行大义|基礎理論|基础理论|納甲六爻|纳甲六爻|六沖|六冲|爻象|世爻|卦宮|卦宫/.test(`${item.catalog} ${document}`))) return false;
  if (tagId === "theme.help_from_others" && /納甲六爻|纳甲六爻|六親|六亲|兄爻|父母化出/.test(`${item.catalog} ${context}`)) return false;
  if (tagId === "action.wait" && /納甲六爻|纳甲六爻/.test(item.catalog)) return false;
  if ((tagId === "theme.opportunity" || tagId === "theme.integrity" || tagId === "action.hold") && fatalisticTerms.test(context)) return false;
  if ((tagId === "action.wait" || tagId === "risk.uncertainty") && fixedTimingTerms.test(document) && (fatalisticTerms.test(document) || certaintyTerms.test(document))) return false;
  if (tagId === "risk.false_promise" && !/消息|音信|承諾|承诺|虛言|虚言|妄言|不實|不实|欺|誑|诳/.test(context)) return false;
  if (tagId === "action.verify" && !/探問|探问|查|核|辨|察|詳|详|虛實|虚实|真假|消息|音信/.test(context)) return false;
  if (tagId === "risk.uncertainty" && !/查|核|辨|察|觀望|观望|觀察|观察|條件|条件|消息|音信|事實|事实|真假|煽惑/.test(context)) return false;
  if (tagId === "risk.goal_distortion" && /梅花易數|梅花易数|物象|克應|克应/.test(`${item.catalog} ${document}`)) return false;
  if (tagId === "theme.new_beginning" && /立基/.test(term) && !/開創|开创|重建|新局|初開|初开|創業|创业/.test(context)) return false;
  if ((tagId === "symbol.moon_cloud" || tagId === "pattern.obscured_then_clear") && !/(雲|云).{0,12}(月|明)|(月).{0,12}(雲|云)|(遮蔽|轉明|转明|由暗轉明|由暗转明)/.test(context)) return false;
  if (tagId === "symbol.tree" && /病|死|亡|疾|醫|医|藥|药/.test(document)) return false;
  if (tagId === "risk.hidden_harm" && (!/核實|核实|查證|查证|保護|保护|保全|存證|存证|求助|援助|申訴|申诉|報官|报官|避險|避险/.test(context) || /小人侵害|暗箭/.test(context))) return false;
  if ((tagId === "risk.goal_distortion" || tagId === "risk.wasted_effort" || tagId === "pattern.repeated_failure") && /必亨通|謀望盡皆亨|谋望尽皆亨/.test(document)) return false;
  if ((tagId === "theme.effort_without_result" || tagId === "risk.wasted_effort" || tagId === "pattern.repeated_failure") && quotedRuleTerms.test(document) && rebuttalTerms.test(document)) return false;
  if ((tagId === "theme.relationship_harmony" || tagId === "theme.opportunity") && /姻緣天定|姻缘天定|天作之合|必成|可成連理|可成连理/.test(document)) return false;
  return true;
}

function safetyPenalty(tagIds: ReadonlySet<string>, item: KnowledgeSearchItem, terms: ReadonlySet<string>) {
  const context = [...terms].map((term) => termContext(item.content, term)).join(" ");
  let penalty = certaintyTerms.test(context) ? 12 : 0;
  if (fatalisticTerms.test(context)) penalty += 30;
  if (fixedTimingTerms.test(context)) penalty += 10;
  if (tagIds.has("risk.goal_distortion") || tagIds.has("risk.wasted_effort") || tagIds.has("pattern.repeated_failure")) {
    if (/天數難逃|天数难逃|終身無成|终身无成|竟無成|竟无成/.test(context)) penalty += 10;
  }
  if (tagIds.has("theme.opportunity") && /必成|必可|天定|注定/.test(context)) penalty += 12;
  return penalty;
}

type Candidate = {
  item: KnowledgeSearchItem;
  sourceType: GuanyinKnowledgeEvidenceItem["sourceType"];
  boundary: string | null;
  score: number;
  matchedTerms: Set<string>;
  tagIds: Set<string>;
  conceptIds: Set<string>;
  scoredConceptIds: Set<string>;
};

type QueryPlan = { conceptId: string; term: string; mappings: GuanyinMappedKnowledgeConcept[] };

export function retrieveGuanyinKnowledgeEvidence(tagIds: readonly string[], options: RetrieveGuanyinKnowledgeOptions = {}): GuanyinKnowledgeRetrievalResult {
  const requestedTagIds = Object.freeze([...new Set(tagIds)]);
  const mappings = mapGuanyinTagsToKnowledgeConcepts(requestedTagIds);
  const unsupportedTagIds = Object.freeze(mappings.filter((mapping) => mapping.matchType === "unmapped").map((mapping) => mapping.tagId));
  const candidates = new Map<string, Candidate>();
  const tagsWithEvidence = new Set<string>();
  const perTermLimit = Math.max(1, Math.min(options.perTermLimit ?? 12, 30));

  const queryPlans = new Map<string, QueryPlan>();
  for (const mapping of mappings) {
    if (!mapping.concept || mapping.matchType === "unmapped") continue;
    for (const configuredTerm of mapping.searchTerms) for (const queryTerm of queryVariants(configuredTerm)) {
      const key = `${mapping.concept.id}|${queryTerm}`;
      const plan = queryPlans.get(key) ?? { conceptId: mapping.concept.id, term: queryTerm, mappings: [] };
      plan.mappings.push(mapping);
      queryPlans.set(key, plan);
    }
  }

  for (const plan of queryPlans.values()) {
    const matches = searchKnowledge(plan.term, perTermLimit).filter(isRelevantCorpusItem);
    for (const item of matches) {
      const allowedMappings = plan.mappings.filter((mapping) => mapping.concept
        && associationAllowed(mapping.tagId, item, plan.term, options.domain)
        && !(mapping.tagId === "theme.integrity" && (requestedTagIds.includes("pattern.steady_growth") || requestedTagIds.includes("symbol.tree") || requestedTagIds.includes("theme.relationship_harmony"))));
      if (!allowedMappings.length) continue;
      const candidate = candidates.get(item.id) ?? {
        item,
        sourceType: "traditional",
        boundary: null,
        score: 0,
        matchedTerms: new Set<string>(),
        tagIds: new Set<string>(),
        conceptIds: new Set<string>(),
        scoredConceptIds: new Set<string>(),
      };
      if (!candidate.scoredConceptIds.has(plan.conceptId)) {
        candidate.score += item.score + categoryWeight(item.category) + catalogWeight(item.catalog)
          + (allowedMappings.some((mapping) => mapping.matchType === "direct") ? 3 : 1);
        candidate.scoredConceptIds.add(plan.conceptId);
      }
      for (const mapping of allowedMappings) {
          tagsWithEvidence.add(mapping.tagId);
          candidate.matchedTerms.add(plan.term);
          candidate.tagIds.add(mapping.tagId);
          candidate.conceptIds.add(mapping.concept!.id);
      }
      candidates.set(item.id, candidate);
    }
  }

  for (const record of guanyinDecisionSafetyRecords) {
    if (record.alwaysApply && !options.domain) continue;
    if (options.domain && !record.domains.includes(options.domain)) continue;
    if (record.intents && (!options.intents || !record.intents.some((intent) => options.intents!.includes(intent)))) continue;
    const matchingTagIds = record.tagIds.filter((tagId) => requestedTagIds.includes(tagId));
    if (!matchingTagIds.length && !record.alwaysApply) continue;
    const mappedConceptIds = mappings
      .filter((mapping) => matchingTagIds.includes(mapping.tagId) && mapping.concept)
      .map((mapping) => mapping.concept!.id);
    const conceptIds = [...new Set([record.conceptId, ...mappedConceptIds])];
    for (const tagId of matchingTagIds) tagsWithEvidence.add(tagId);
    const sourceId = `guanyin-safety-${record.id}`;
    candidates.set(sourceId, {
      item: {
        id: sourceId,
        title: record.title,
        source: "guanyin-system-safety",
        catalog: "现实决策安全知识",
        category: ["modern_commentary"],
        excerpt: record.content,
        content: record.content,
        url: "",
        score: 40,
      },
      sourceType: "system_safety",
      boundary: record.boundary,
      score: 40,
      matchedTerms: new Set(record.keywords),
      tagIds: new Set(matchingTagIds),
      conceptIds: new Set(conceptIds),
      scoredConceptIds: new Set(conceptIds),
    });
  }

  for (const candidate of candidates.values()) candidate.score -= safetyPenalty(candidate.tagIds, candidate.item, candidate.matchedTerms);
  if (requestedTagIds.some((tagId) => tagId === "risk.hidden_harm" || tagId === "symbol.moon_cloud" || tagId === "pattern.obscured_then_clear")) {
    for (const [sourceId, candidate] of candidates) if (/納甲六爻|纳甲六爻/.test(candidate.item.catalog)) candidates.delete(sourceId);
  }
  if (requestedTagIds.includes("risk.hidden_harm")) {
    if (!tagsWithEvidence.has("risk.hidden_harm")) candidates.clear();
    else for (const [sourceId, candidate] of candidates) if (!candidate.tagIds.has("risk.hidden_harm")) candidates.delete(sourceId);
  }

  const limit = Math.max(1, Math.min(options.limit ?? 8, 20));
  const rankedCandidates = [...candidates.values()].sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id));
  const selectedCandidates: Candidate[] = [];
  const selectedIds = new Set<string>();
  const conceptCounts = new Map<string, number>();
  const canSelect = (candidate: Candidate) => [...candidate.conceptIds].some((conceptId) => (conceptCounts.get(conceptId) ?? 0) < 1);
  const select = (candidate: Candidate) => {
    selectedCandidates.push(candidate);
    selectedIds.add(candidate.item.id);
    for (const conceptId of candidate.conceptIds) conceptCounts.set(conceptId, (conceptCounts.get(conceptId) ?? 0) + 1);
  };
  for (const tagId of mappings.filter((mapping) => mapping.matchType !== "unmapped").map((mapping) => mapping.tagId)) {
    const candidate = rankedCandidates.find((item) => item.tagIds.has(tagId) && !selectedIds.has(item.item.id) && canSelect(item));
    if (!candidate || selectedCandidates.length >= limit) continue;
    select(candidate);
  }
  for (const candidate of rankedCandidates) {
    if (selectedCandidates.length >= limit) break;
    if (selectedIds.has(candidate.item.id) || !canSelect(candidate)) continue;
    select(candidate);
  }
  selectedCandidates.sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id));
  const evidence = Object.freeze(selectedCandidates
    .map((candidate): GuanyinKnowledgeEvidenceItem => Object.freeze({
      sourceId: candidate.item.id,
      title: candidate.item.title,
      catalog: candidate.item.catalog,
      categories: Object.freeze([...candidate.item.category]),
      url: candidate.item.url,
      sourceType: candidate.sourceType,
      boundary: candidate.boundary,
      excerpt: contextExcerpt(candidate.item.content, [...candidate.matchedTerms]),
      score: candidate.score,
      matchedTerms: Object.freeze([...candidate.matchedTerms]),
      tagIds: Object.freeze([...candidate.tagIds]),
      conceptIds: Object.freeze([...candidate.conceptIds]),
    })));
  const mappedTagIds = mappings.filter((mapping) => mapping.matchType !== "unmapped").map((mapping) => mapping.tagId);
  const noEvidenceTagIds = Object.freeze(mappedTagIds.filter((tagId) => !tagsWithEvidence.has(tagId)));
  const warnings: string[] = [];
  if (unsupportedTagIds.length) warnings.push(`以下标签尚未建立可审核的知识概念映射：${unsupportedTagIds.join("、")}。`);
  if (noEvidenceTagIds.length) warnings.push(`以下标签在当前受控语料中没有可靠关键词命中：${noEvidenceTagIds.join("、")}。`);
  if (noEvidenceTagIds.includes("theme.opportunity")) warnings.push("当前知识库没有同时支持条件核实、低成本试探和保留退路的机会证据；相关行动只能来自系统安全规则。");
  if (noEvidenceTagIds.includes("risk.false_promise")) warnings.push("当前知识库没有同时包含承诺内容、消息来源和查证条件的直接证据；不得仅凭‘虚实’推断欺骗或失信。");
  if (!evidence.length) warnings.push("当前知识库没有可用于补充解释的证据；不得由 LLM 补造来源。");
  const status: GuanyinKnowledgeRetrievalStatus = evidence.length === 0
    ? "unavailable"
    : unsupportedTagIds.length || noEvidenceTagIds.length ? "partial" : "supported";

  return Object.freeze({
    status,
    mappingVersion: guanyinKnowledgeMappingVersion,
    requestedTagIds,
    mappings,
    evidence,
    unsupportedTagIds,
    noEvidenceTagIds,
    warnings: Object.freeze(warnings),
  });
}

export function retrieveKnowledgeForGuanyinReasoning(reasoning: GuanyinStructuredReasoning, options?: RetrieveGuanyinKnowledgeOptions) {
  return retrieveGuanyinKnowledgeEvidence(reasoning.evidence.map((item) => item.tag.id), { ...options, domain: options?.domain ?? reasoning.domain, intents: options?.intents ?? reasoning.questionAnalysis.intents });
}
