import { describe, expect, it } from "vitest";

import { buildGuanyinEvidenceIntegration } from "../lib/guanyin/evidence-integration";
import { getGuanyinStick } from "../lib/guanyin/library";
import { retrieveKnowledgeForGuanyinReasoning } from "../lib/guanyin/knowledge-retrieval";
import { buildGuanyinStructuredReasoning } from "../lib/guanyin/reasoning";
import type { QuestionDomain } from "../lib/guanyin/types";

function integrate(signId: number, domain: QuestionDomain, question: string) {
  const stick = getGuanyinStick(signId);
  const reasoning = buildGuanyinStructuredReasoning({ signId, domain, question });
  const knowledge = retrieveKnowledgeForGuanyinReasoning(reasoning, { limit: 3 });
  return buildGuanyinEvidenceIntegration({ stick, reasoning, knowledge });
}

describe("观音签证据整合层", () => {
  it("按固定优先级整合本签、现实安全规则与传统背景", () => {
    const pack = integrate(95, "career", "有机会消息时是否应改变现状？");
    expect(pack.status).toBe("ready");
    expect(pack.precedence).toEqual(["system_safety", "structured_reasoning", "drawn_oracle", "traditional_context"]);
    expect(pack.evidence).toContainEqual(expect.objectContaining({ sourceId: "guanyin-safety-opportunity-verification", type: "system_safety" }));
    expect(pack.evidence.some((item) => item.type === "drawn_oracle" && item.sourceId.startsWith("guanyin-100-v1:sign:095"))).toBe(true);
    expect(pack.evidence.some((item) => item.type === "traditional_context" && item.sourceId.startsWith("wikisource-"))).toBe(true);
  });

  it("所有结构化结论的来源都能在整合证据中追溯", () => {
    const pack = integrate(17, "career", "面对未经证实的职场消息怎么办？");
    const sourceIds = new Set(pack.evidence.map((item) => item.sourceId));
    const claims = [pack.coreJudgment, ...pack.actions, ...pack.trends, ...pack.risks].filter((item) => item !== null);
    for (const claim of claims) for (const sourceId of claim.sourceIds) expect(sourceIds, `${claim.text} 缺少 ${sourceId}`).toContain(sourceId);
    expect(pack.safetyGuidance.join(" ")).toContain("消息来源");
  });

  it("潜在伤害只允许核实和保护，不得断言现实加害", () => {
    const pack = integrate(98, "career", "处境受困时应该马上行动吗？");
    expect(pack.evidence).toContainEqual(expect.objectContaining({ sourceId: "guanyin-safety-hidden-harm-protection", type: "system_safety" }));
    expect(pack.forbiddenClaims.join(" ")).toContain("不得把象征性风险写成已经确认有人加害");
  });

  it("医疗问题保留专业判断边界并使用明确标注的系统规则", () => {
    const pack = integrate(21, "health", "身体好转后是否可以立即停止检查或治疗？");
    expect(pack.safetyGuidance.join(" ")).toContain("不要仅根据签文自行停止检查、用药或治疗");
    expect(pack.forbiddenClaims.join(" ")).toContain("不得用签文或知识证据替代医疗诊断");
    expect(pack.evidence).toContainEqual(expect.objectContaining({ sourceId: "guanyin-safety-health-decision-baseline", type: "system_safety" }));
    expect(pack.evidence.filter((item) => item.type === "system_safety").every((item) => item.boundary.includes("不作诊断") || item.boundary.includes("不能替代"))).toBe(true);
  });

  it("关系安全规则不允许推断对方已经同意", () => {
    const pack = integrate(96, "marriage", "双方准备确定关系时应关注什么？");
    expect(pack.evidence).toContainEqual(expect.objectContaining({ sourceId: "guanyin-safety-relationship-consent", type: "system_safety" }));
    expect(pack.forbiddenClaims.join(" ")).toContain("不得把和合倾向写成对方已经同意");
  });

  it("证据 ID 去重并为每条补充资料保留使用边界", () => {
    const pack = integrate(28, "career", "信息还不明朗时应该如何决定？");
    expect(new Set(pack.evidence.map((item) => item.sourceId)).size).toBe(pack.evidence.length);
    expect(pack.evidence.every((item) => item.boundary.length > 0)).toBe(true);
  });

  it("同签资料按当前问题相关性区分直接使用与背景", () => {
    const pack = integrate(96, "marriage", "双方准备确定关系时应关注什么？");
    expect(pack.evidence).toContainEqual(expect.objectContaining({ sourceId: "guanyin-100-v1:sign:096:poem", recommendedUse: "context_only" }));
    expect(pack.evidence).toContainEqual(expect.objectContaining({ sourceId: "guanyin-100-v1:sign:096:topics:marriage", recommendedUse: "direct" }));
  });

  it("补齐家庭、搬迁与职业转换的领域边界", () => {
    const family = integrate(55, "family", "家庭近期不太安稳，是否应该马上作出重大改变？");
    expect(family.forbiddenClaims.join(" ")).toContain("现实灾害");
    expect(family.evidence.map((item) => item.sourceId)).not.toContain("ctext-0");
    expect(family.evidence.map((item) => item.sourceId)).not.toContain("ctext-32");
    const relocation = integrate(34, "travel", "只是想改善居住环境，现在适合立即搬迁吗？");
    expect(relocation.forbiddenClaims.join(" ")).toContain("合同到期");
    const career = integrate(16, "career", "目前能力尚未被看见，是否应该立刻辞职寻找新机会？");
    expect(career.coreJudgment?.text).toContain("不足以支持立即辞职");
    expect(career.safetyGuidance.join(" ")).toContain("优先保留现职");
    expect(career.forbiddenClaims.join(" ")).toContain("不可逆职业决定");
    expect(career.evidence).toContainEqual(expect.objectContaining({ sourceId: "guanyin-safety-career-change-reversible-verification", type: "system_safety", recommendedUse: "direct" }));
  });

  it("过滤健康领域的六亲卦例并为关系不确定问题加入同意规则", () => {
    const health = integrate(78, "health", "听说可能有合适的治疗帮助，是否可以据此停止原来的复诊安排？");
    expect(health.evidence.map((item) => item.sourceId)).not.toContain("ctext-32");
    const relationship = integrate(71, "marriage", "对方态度仍不明确，我是否可以把这段关系视为已经确定？");
    expect(relationship.evidence).toContainEqual(expect.objectContaining({ sourceId: "guanyin-safety-relationship-consent", type: "system_safety" }));
    expect(relationship.safetyGuidance.join(" ")).toContain("明确、持续的同意");
  });
});
