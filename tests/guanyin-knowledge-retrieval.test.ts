import { describe, expect, it } from "vitest";

import { retrieveGuanyinKnowledgeEvidence, retrieveKnowledgeForGuanyinReasoning } from "../lib/guanyin/knowledge-retrieval";
import { buildGuanyinStructuredReasoning } from "../lib/guanyin/reasoning";

describe("观音签图谱证据检索器", () => {
  it("用受控词及繁体变体检索待时证据并保留来源", () => {
    const result = retrieveGuanyinKnowledgeEvidence(["action.wait"]);
    expect(result.status).toBe("supported");
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.some((item) => item.matchedTerms.includes("待時"))).toBe(true);
    expect(result.evidence.every((item) => item.url.length > 0 && item.sourceId.length > 0)).toBe(true);
    expect(result.evidence.every((item) => item.tagIds.includes("action.wait"))).toBe(true);
  });

  it("排除八字命理语境并返回命中词附近的正文", () => {
    const result = retrieveGuanyinKnowledgeEvidence(["action.hold", "risk.rushing"]);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.every((item) => !item.catalog.includes("八字命理"))).toBe(true);
    expect(result.evidence.every((item) => item.matchedTerms.some((term) => item.excerpt.includes(term)))).toBe(true);
  });

  it("把未审核的敏感标签明确标为无证据而不补造", () => {
    const result = retrieveGuanyinKnowledgeEvidence(["theme.medical_support"]);
    expect(result.status).toBe("unavailable");
    expect(result.evidence).toEqual([]);
    expect(result.unsupportedTagIds).toEqual(["theme.medical_support"]);
    expect(result.warnings.join(" ")).toContain("不得由 LLM 补造来源");
  });

  it("聚合去重多个标签命中的同一资料", () => {
    const result = retrieveGuanyinKnowledgeEvidence(["action.wait", "time.wait_for_timing", "action.wait"], { limit: 20 });
    expect(new Set(result.evidence.map((item) => item.sourceId)).size).toBe(result.evidence.length);
    expect(result.requestedTagIds).toEqual(["action.wait", "time.wait_for_timing"]);
  });

  it("排序时优先保证不同标签都有代表证据", () => {
    const result = retrieveGuanyinKnowledgeEvidence(["action.wait", "action.hold", "risk.rushing"], { limit: 3 });
    const coveredTags = new Set(result.evidence.flatMap((item) => item.tagIds));
    expect([...coveredTags]).toEqual(expect.arrayContaining(["action.wait", "action.hold", "risk.rushing"]));
  });

  it("可以直接从结构化推理结果检索补充证据", () => {
    const reasoning = buildGuanyinStructuredReasoning({ signId: 93, domain: "career", question: "暂时受压时应该立即反击吗？" });
    const result = retrieveKnowledgeForGuanyinReasoning(reasoning);
    expect(result.requestedTagIds).toEqual(expect.arrayContaining(["action.hold", "action.wait", "pattern.difficulty_then_relief"]));
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.every((item) => item.conceptIds.length > 0)).toBe(true);
  });

  it("潜在伤害只返回明确标注的现实保护规则", () => {
    const reasoning = buildGuanyinStructuredReasoning({ signId: 98, domain: "career", question: "处境受困时应该马上行动吗？" });
    const result = retrieveKnowledgeForGuanyinReasoning(reasoning);
    expect(result.requestedTagIds).toContain("risk.hidden_harm");
    expect(result.status).toBe("partial");
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({ sourceId: "guanyin-safety-hidden-harm-protection", sourceType: "system_safety" });
  });

  it("机会与失信使用独立的现实安全知识而不冒充传统典籍", () => {
    const opportunity = retrieveKnowledgeForGuanyinReasoning(buildGuanyinStructuredReasoning({ signId: 95, domain: "career", question: "有机会消息时是否应改变现状？" }));
    expect(opportunity.evidence).toContainEqual(expect.objectContaining({ sourceId: "guanyin-safety-opportunity-verification", sourceType: "system_safety", boundary: expect.any(String) }));
    const falsePromise = retrieveKnowledgeForGuanyinReasoning(buildGuanyinStructuredReasoning({ signId: 17, domain: "career", question: "面对未经证实的职场消息怎么办？" }));
    expect(falsePromise.evidence).toContainEqual(expect.objectContaining({ sourceId: "guanyin-safety-claim-source-verification", sourceType: "system_safety" }));
  });

  it("为目标校准、不确定性、新开始和关系同意提供分开的安全知识", () => {
    const scenarios = [
      { signId: 97, domain: "career" as const, question: "目标是否仍合理？", sourceId: "guanyin-safety-goal-calibration" },
      { signId: 28, domain: "career" as const, question: "信息不明时怎么办？", sourceId: "guanyin-safety-uncertainty-observation" },
      { signId: 1, domain: "wealth" as const, question: "新机会如何推进？", sourceId: "guanyin-safety-new-beginning-reversible-plan" },
      { signId: 96, domain: "marriage" as const, question: "双方准备确定关系时应关注什么？", sourceId: "guanyin-safety-relationship-consent" },
    ];
    for (const scenario of scenarios) {
      const result = retrieveKnowledgeForGuanyinReasoning(buildGuanyinStructuredReasoning(scenario));
      expect(result.evidence, scenario.sourceId).toContainEqual(expect.objectContaining({ sourceId: scenario.sourceId, sourceType: "system_safety" }));
    }
  });

  it("职业转换安全证据只在职业转换意图下进入结果", () => {
    const careerChange = retrieveKnowledgeForGuanyinReasoning(buildGuanyinStructuredReasoning({ signId: 16, domain: "career", question: "是否应该立刻辞职寻找新机会？" }));
    expect(careerChange.evidence).toContainEqual(expect.objectContaining({ sourceId: "guanyin-safety-career-change-reversible-verification", sourceType: "system_safety" }));
    const generalCareer = retrieveKnowledgeForGuanyinReasoning(buildGuanyinStructuredReasoning({ signId: 16, domain: "career", question: "目前的发展趋势如何？" }));
    expect(generalCareer.evidence.map((item) => item.sourceId)).not.toContain("guanyin-safety-career-change-reversible-verification");
  });

  it("即使签文标签没有直接命中，也为当前问题领域补充通用现实规则", () => {
    const scenarios = [
      { signId: 67, domain: "travel" as const, question: "是否适合近期出行？", sourceId: "guanyin-safety-travel-reality-check" },
      { signId: 67, domain: "career" as const, question: "工作安排应该怎么决定？", sourceId: "guanyin-safety-career-decision-baseline" },
      { signId: 67, domain: "family" as const, question: "家庭分歧应该怎么处理？", sourceId: "guanyin-safety-family-decision-baseline" },
      { signId: 67, domain: "marriage" as const, question: "关系是否应该推进？", sourceId: "guanyin-safety-relationship-decision-baseline" },
      { signId: 67, domain: "wealth" as const, question: "这项支出是否应该进行？", sourceId: "guanyin-safety-wealth-decision-baseline" },
      { signId: 67, domain: "health" as const, question: "身体不适应该怎么处理？", sourceId: "guanyin-safety-health-decision-baseline" },
    ];
    for (const scenario of scenarios) {
      const result = retrieveKnowledgeForGuanyinReasoning(buildGuanyinStructuredReasoning(scenario));
      expect(result.evidence, scenario.sourceId).toContainEqual(expect.objectContaining({ sourceId: scenario.sourceId, sourceType: "system_safety" }));
    }
  });

  it("三个徒劳标签共享概念时只保留一个代表候选", () => {
    const result = retrieveKnowledgeForGuanyinReasoning(buildGuanyinStructuredReasoning({ signId: 3, domain: "career", question: "反复投入却没有成果时还应继续吗？" }));
    expect(result.evidence.filter((item) => item.conceptIds.includes("risk.wasted_effort"))).toHaveLength(1);
    expect(result.evidence).toContainEqual(expect.objectContaining({ sourceId: "guanyin-safety-wasted-effort-stop-rule", sourceType: "system_safety" }));
  });

  it("人工评审剔除的误导证据不会再次进入对应案例前三名", () => {
    const scenarios = [
      { id: "kg-sign-095-career", signId: 95, domain: "career" as const, question: "有机会消息时是否应改变现状？" },
      { id: "kg-sign-017-career", signId: 17, domain: "career" as const, question: "面对未经证实的职场消息怎么办？" },
      { id: "kg-sign-097-career", signId: 97, domain: "career" as const, question: "反复追求虚幻目标仍无结果时怎么办？" },
      { id: "kg-sign-093-career", signId: 93, domain: "career" as const, question: "暂时受压时应该立即反击吗？" },
      { id: "kg-sign-098-career", signId: 98, domain: "career" as const, question: "处境受困时应该马上行动吗？" },
      { id: "kg-sign-028-career", signId: 28, domain: "career" as const, question: "信息还不明朗时应该如何决定？" },
      { id: "kg-sign-008-career", signId: 8, domain: "career" as const, question: "长期积累是否意味着现在就能成功？" },
      { id: "kg-sign-001-wealth", signId: 1, domain: "wealth" as const, question: "有新机会时应该如何守正推进？" },
      { id: "kg-sign-003-career", signId: 3, domain: "career" as const, question: "反复投入却没有成果时还应继续吗？" },
      { id: "kg-sign-096-marriage", signId: 96, domain: "marriage" as const, question: "双方准备确定关系时应关注什么？" },
    ];
    const rejectedByCase: Record<string, readonly string[]> = {
      "kg-sign-095-career": ["wikisource-341", "wikisource-342", "wikisource-348"],
      "kg-sign-017-career": ["ctext-33", "wikisource-298", "ctext-1"],
      "kg-sign-097-career": ["wikisource-275", "wikisource-269", "wikisource-262", "wikisource-286"],
      "kg-sign-093-career": ["ctext-30"],
      "kg-sign-098-career": ["ctext-32", "wikisource-350", "wikisource-276"],
      "kg-sign-028-career": ["ctext-31", "ctext-30", "wikisource-276", "wikisource-290"],
      "kg-sign-008-career": ["wikisource-262", "wikisource-280"],
      "kg-sign-001-wealth": ["wikisource-347", "wikisource-309"],
      "kg-sign-003-career": ["ctext-32", "wikisource-266", "wikisource-274"],
      "kg-sign-096-marriage": ["wikisource-349", "wikisource-342", "wikisource-309"],
    };
    for (const scenario of scenarios) {
      const rejectedIds = rejectedByCase[scenario.id];
      if (!rejectedIds) continue;
      const sourceIds = retrieveKnowledgeForGuanyinReasoning(buildGuanyinStructuredReasoning(scenario), { limit: 3 }).evidence.map((item) => item.sourceId);
      for (const sourceId of rejectedIds) {
        expect(sourceIds, `${scenario.id} 不应再次返回 ${sourceId}`).not.toContain(sourceId);
      }
    }
  });
});
