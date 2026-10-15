import { describe, expect, it } from "vitest";

import {
  getGuanyinKnowledgeMapping,
  guanyinKnowledgeConcepts,
  guanyinKnowledgeTagMappings,
  mapGuanyinTagsToKnowledgeConcepts,
} from "../lib/guanyin/knowledge-mapping";
import { guanyinTagVocabulary } from "../lib/guanyin/semantic";

describe("观音签标签到知识概念映射", () => {
  it("为全部受控标签登记映射状态", () => {
    expect(guanyinKnowledgeTagMappings).toHaveLength(guanyinTagVocabulary.length);
    expect(new Set(guanyinKnowledgeTagMappings.map((item) => item.tagId)).size).toBe(guanyinTagVocabulary.length);
  });

  it("为首批核心决策标签提供受控古籍检索词", () => {
    expect(getGuanyinKnowledgeMapping("action.wait")).toMatchObject({
      matchType: "direct",
      concept: { id: "decision.timing", label: "待时与时机" },
    });
    expect(getGuanyinKnowledgeMapping("action.wait")?.searchTerms).toEqual(expect.arrayContaining(["待时", "静候"]));
    expect(getGuanyinKnowledgeMapping("risk.rushing")?.searchTerms).toEqual(expect.arrayContaining(["妄动", "躁进"]));
  });

  it("明确区分外部欺骗与目标期待失真", () => {
    expect(getGuanyinKnowledgeMapping("theme.deception")?.concept?.id).toBe("epistemic.verification");
    expect(getGuanyinKnowledgeMapping("risk.goal_distortion")?.concept?.id).toBe("risk.expectation_distortion");
    expect(getGuanyinKnowledgeMapping("risk.goal_distortion")?.boundary).toContain("不暗示外部诈骗");
  });

  it("机会与成长使用行动型和过程型检索词", () => {
    expect(getGuanyinKnowledgeMapping("theme.opportunity")?.searchTerms).toContain("审慎验证");
    expect(getGuanyinKnowledgeMapping("theme.opportunity")?.searchTerms).not.toContain("机缘");
    expect(getGuanyinKnowledgeMapping("pattern.steady_growth")?.searchTerms).toEqual(expect.arrayContaining(["渐进", "磨炼", "成材"]));
  });

  it("未完成审核的敏感概念明确保持未映射", () => {
    expect(getGuanyinKnowledgeMapping("theme.medical_support")).toMatchObject({ matchType: "unmapped", concept: null, searchTerms: [] });
    expect(getGuanyinKnowledgeMapping("theme.relationship_harmony")).toMatchObject({ matchType: "direct", concept: { id: "relationship.consent" } });
  });

  it("按输入标签去重并忽略未知标签", () => {
    const result = mapGuanyinTagsToKnowledgeConcepts(["action.wait", "action.wait", "unknown.tag", "risk.rushing"]);
    expect(result.map((item) => item.tagId)).toEqual(["action.wait", "risk.rushing"]);
    expect(guanyinKnowledgeConcepts.length).toBeGreaterThanOrEqual(12);
  });
});
