import type { GuanyinQuestionAnalysis, GuanyinQuestionIntent, QuestionDomain } from "./types";

const intentRules: ReadonlyArray<{ intent: Exclude<GuanyinQuestionIntent, "general">; pattern: RegExp }> = [
  { intent: "treatment_change", pattern: /停药|停止(?:检查|治疗|用药)|取消(?:检查|复诊|治疗)|不再(?:检查|治疗|用药)|中断(?:治疗|用药)|\b(?:stop|quit|discontinue|cancel)\b.{0,24}\b(?:medication|medicine|treatment|therapy|test|checkup|follow-up)\b/i },
  { intent: "obligation_fulfillment", pattern: /履约|履行|交付|违约|承诺尚未|承诺.*(?:履行|完成|兑现)|\b(?:fulfil|fulfill|deliver|breach|keep)\b.{0,20}\b(?:obligation|promise|commitment|contract)\b/i },
  { intent: "credibility_check", pattern: /难以核实|无法核实|是否可信|可信吗|获利消息|消息.*(?:真实|可靠)|\b(?:credible|trustworthy|reliable|verify|verified|true)\b/i },
  { intent: "risk_assessment", pattern: /风险尚未证实|危险尚未证实|担忧.*风险|威胁.*(?:证实|实际)|是否.*危险|\b(?:risk|danger|threat|harm|unsafe)\b/i },
  { intent: "career_change", pattern: /辞职|离职|跳槽|换工作|转职|转行|\bresign(?:ation)?\b|\b(?:quit|change|switch|leave)\b.{0,16}\b(?:job|career|role|company)\b/i },
  { intent: "relocation", pattern: /搬家|搬迁|迁居|乔迁|换(?:房|住所)|\b(?:move|relocate|relocation)\b/i },
  { intent: "travel_start", pattern: /出行|出发|启程|旅行|旅游|行程|\b(?:travel|trip|journey|depart|departure|itinerary)\b/i },
  { intent: "transaction", pattern: /交易|投资|转账|签约|合同|买卖|求财|资金|投入|\b(?:invest|investment|transaction|transfer|contract|funds?|money)\b/i },
  { intent: "relationship_commitment", pattern: /确定关系|关系.{0,6}(?:确定|确认)|复合|结婚|婚姻|订婚|承诺|表白|双方心意|\b(?:marry|marriage|engage|engagement|commitment|relationship|reconcile)\b/i },
  { intent: "family_change", pattern: /家庭(?:安排|改变|调整|关系)|家人|家宅|照护|\b(?:family|household|caregiving)\b/i },
  { intent: "timing", pattern: /何时|什么时候|时机|哪个阶段|哪一阶段|何日|何月|\b(?:when|timing|which (?:time|stage|month|day))\b/i },
  { intent: "advance_or_wait", pattern: /是否|能否|应该|适合|可以|要不要|立即|马上|推进|行动|开始|启动|\b(?:should|could|can|wait|proceed|start|begin|now|immediately)\b/i },
];

const primaryPriority: readonly GuanyinQuestionIntent[] = [
  "treatment_change", "obligation_fulfillment", "credibility_check", "risk_assessment", "timing", "career_change", "relocation", "travel_start", "relationship_commitment",
  "family_change", "transaction", "advance_or_wait", "general",
];
const intentPriority = new Map(primaryPriority.map((intent, index) => [intent, index]));

export function analyzeGuanyinQuestion(question: string, domain: QuestionDomain): GuanyinQuestionAnalysis {
  const normalized = question.trim();
  const matches = intentRules.flatMap((rule) => {
    if (rule.intent === "relationship_commitment" && domain !== "marriage") return [];
    const match = normalized.match(rule.pattern);
    return match ? [{ intent: rule.intent, term: match[0] }] : [];
  });
  if (domain === "family" && matches.some((match) => match.intent === "advance_or_wait") && !matches.some((match) => match.intent === "family_change")) {
    matches.push({ intent: "family_change", term: "家庭领域的安排决策" });
  }
  const intents: GuanyinQuestionIntent[] = [...new Set(matches.map((match) => match.intent))].sort((left, right) => (intentPriority.get(left) ?? 99) - (intentPriority.get(right) ?? 99));
  const primaryIntent = intents[0] ?? "general";
  const safetyFlags: GuanyinQuestionAnalysis["safetyFlags"][number][] = [];
  if (primaryIntent === "treatment_change") safetyFlags.push("medical_decision");
  if (domain === "wealth" && /投资|交易|转账|签约|合同|资金|投入|\b(?:invest|investment|transaction|transfer|contract|funds?|money)\b/i.test(normalized)) safetyFlags.push("financial_decision");
  if (domain === "marriage" && /确定关系|关系.{0,6}(?:确定|确认)|复合|结婚|订婚|承诺|\b(?:marry|marriage|engage|engagement|commitment|relationship|reconcile)\b/i.test(normalized)) safetyFlags.push("relationship_decision");
  return Object.freeze({
    primaryIntent,
    intents: Object.freeze(intents.length ? intents : (["general"] as GuanyinQuestionIntent[])),
    matchedTerms: Object.freeze(matches.map((match) => match.term)),
    safetyFlags: Object.freeze(safetyFlags),
  });
}
