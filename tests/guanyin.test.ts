import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getGuanyinStick, guanyinSticks } from "../lib/guanyin/library";
import { drawGuanyinStickNumber, type RandomValuesProvider } from "../lib/guanyin/random";
import { buildGuanyinStructuredReasoning } from "../lib/guanyin/reasoning";
import {
  findGuanyinSignsByTag,
  getGuanyinSemanticProfile,
  guanyinReviewedSemanticProfiles,
  guanyinSecondPassReview,
  guanyinSemanticProfiles,
  guanyinTagVocabulary,
  retrieveGuanyinSemanticEvidence,
} from "../lib/guanyin/semantic";
import { questionDomains } from "../lib/guanyin/types";
import { validateGuanyinTranslationCatalog } from "../lib/guanyin/translation";

const reason = (signId: number, domain: (typeof questionDomains)[number], question = "一般情况如何？") => buildGuanyinStructuredReasoning({ signId, domain, question });

describe("观音签库", () => {
  it("包含完整且无重复的 100 签", () => {
    expect(guanyinSticks).toHaveLength(100);
    expect(new Set(guanyinSticks.map((stick) => stick.id)).size).toBe(100);
    expect(guanyinSticks.map((stick) => stick.id).sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
  });
  it("每支签有四句签诗和六个领域", () => {
    for (const stick of guanyinSticks) {
      expect(stick.poem).toHaveLength(4);
      expect(Object.keys(stick.traditional.topics).sort()).toEqual([...questionDomains].sort());
    }
  });
  it("可正确查询第 1 和第 100 签", () => {
    expect(getGuanyinStick(1).id).toBe(1);
    expect(getGuanyinStick(100).id).toBe(100);
  });
  it("拒绝无效签号", () => {
    expect(() => getGuanyinStick(0)).toThrow(RangeError);
    expect(() => getGuanyinStick(101)).toThrow(RangeError);
    expect(() => getGuanyinStick(1.5)).toThrow(TypeError);
    expect(() => getGuanyinStick("1")).toThrow(TypeError);
  });
});

describe("观音签英文独立翻译契约", () => {
  it("拒绝缺少完整 100 签的英文目录", () => {
    expect(() => validateGuanyinTranslationCatalog({ version: "test", sourceVersion: "test", locale: "en", translations: [] })).toThrow("必须完整包含 100 支签");
  });
});

describe("观音签语义标签试标", () => {
  it("使用唯一且受控的标签词表", () => {
    expect(guanyinTagVocabulary.length).toBeGreaterThanOrEqual(20);
    expect(new Set(guanyinTagVocabulary.map((tag) => tag.id)).size).toBe(guanyinTagVocabulary.length);
  });
  it("包含完整 100 支具有原文证据的签", () => {
    expect(guanyinSemanticProfiles).toHaveLength(100);
    expect(new Set(guanyinSemanticProfiles.map((profile) => profile.signId)).size).toBe(100);
    expect(guanyinSemanticProfiles.every((profile) => profile.tags.every((tag) => tag.evidenceText && tag.sourceId))).toBe(true);
  });
  it("支持按签号和标签建立索引", () => {
    expect(getGuanyinSemanticProfile(28)?.tags.some((tag) => tag.tagId === "symbol.moon_cloud")).toBe(true);
    expect(findGuanyinSignsByTag("action.wait")).toEqual(expect.arrayContaining([2, 28, 76, 100]));
    expect(findGuanyinSignsByTag("unknown.tag")).toEqual([]);
  });
  it("应用第二轮复核结论，同时保留第一轮原始标注", () => {
    expect(guanyinReviewedSemanticProfiles).toHaveLength(100);
    expect(guanyinSecondPassReview.exceptions).toHaveLength(14);

    const rawSign8 = guanyinSemanticProfiles.find((profile) => profile.signId === 8);
    expect(rawSign8?.tags.some((tag) => tag.tagId === "theme.opportunity")).toBe(true);
    expect(getGuanyinSemanticProfile(8)?.tags.some((tag) => tag.tagId === "theme.opportunity")).toBe(false);
    expect(getGuanyinSemanticProfile(8)?.tags.some((tag) => tag.tagId === "pattern.delayed_success" && tag.confidence === 0.9)).toBe(true);

    expect(getGuanyinSemanticProfile(55)?.tags.some((tag) => tag.tagId === "pattern.steady_growth")).toBe(false);
    expect(getGuanyinSemanticProfile(100)?.tags.find((tag) => tag.tagId === "theme.integrity")?.confidence).toBe(0.65);
  });
  it("全部 100 支通过第二轮复核后进入正式索引", () => {
    expect(guanyinSemanticProfiles.every((profile) => profile.tags.every((tag) => tag.reviewStatus === "reviewed"))).toBe(true);
    expect(getGuanyinSemanticProfile(4)?.tags.some((tag) => tag.tagId === "theme.new_beginning")).toBe(true);
    expect(getGuanyinSemanticProfile(6)?.tags.some((tag) => tag.tagId === "theme.help_from_others")).toBe(false);
    expect(getGuanyinSemanticProfile(10)?.tags.some((tag) => tag.tagId === "action.hold")).toBe(false);
    expect(getGuanyinSemanticProfile(16)?.tags.some((tag) => tag.tagId === "theme.opportunity")).toBe(false);
    expect(getGuanyinSemanticProfile(21)?.tags.some((tag) => tag.tagId === "action.advance")).toBe(false);
    expect(getGuanyinSemanticProfile(23)?.tags.some((tag) => tag.tagId === "action.seek_help")).toBe(false);
    expect(getGuanyinSemanticProfile(24)?.tags.find((tag) => tag.tagId === "theme.deception")?.confidence).toBe(0.65);
    expect(getGuanyinSemanticProfile(25)?.tags.some((tag) => tag.tagId === "action.seek_help")).toBe(false);
    expect([26,27,29,30,31,32,33,34,35,36,37,38,39,40,42,43,44,45,46,47].every((signId) => getGuanyinSemanticProfile(signId))).toBe(true);
    expect([48,49,50,51,52,53,54,56,57,58,59,60,61,62,63,64,65,66,67,68].every((signId) => getGuanyinSemanticProfile(signId))).toBe(true);
    expect([69,70,71,72,73,74,75,77,78,79,80,81,82,83,84,85,86,87,88,89].every((signId) => getGuanyinSemanticProfile(signId))).toBe(true);
    expect([90,91,92,93,94,95,96,97,98,99].every((signId) => getGuanyinSemanticProfile(signId))).toBe(true);
  });
  it("topic 推导的行动或时间标签限定适用领域", () => {
    const topicAssignments = guanyinSemanticProfiles.flatMap((profile) => profile.tags.filter((tag) => tag.evidenceType === "topic"));
    expect(topicAssignments.length).toBeGreaterThan(0);
    expect(topicAssignments.every((tag) => tag.domains && tag.domains.length > 0)).toBe(true);
  });
  it("按签号和问题领域返回已复核标签及其证据", () => {
    const wealth = retrieveGuanyinSemanticEvidence(4, "wealth", ["timing"]);
    expect(wealth.coverage).toBe("reviewed");
    expect(wealth.tags.some((item) => item.tag.id === "time.autumn_winter" && item.evidenceText === "自身秋冬旺；求财秋冬旺")).toBe(true);
    expect(wealth.tags.some((item) => item.tag.id === "action.hold")).toBe(false);

    const travel = retrieveGuanyinSemanticEvidence(4, "travel", ["relocation"]);
    expect(travel.tags.some((item) => item.tag.id === "action.hold" && item.domains?.includes("travel"))).toBe(true);
    expect(travel.tags.some((item) => item.tag.id === "time.autumn_winter")).toBe(false);
    expect(travel.tags.some((item) => item.tag.id === "theme.new_beginning")).toBe(true);
  });
  it("检索时不泄漏被复核剔除的标签", () => {
    expect(retrieveGuanyinSemanticEvidence(21, "career").tags.some((item) => item.tag.id === "action.advance")).toBe(false);
  });
  it("所有有效签都已进入复核覆盖", () => {
    expect(Array.from({ length: 100 }, (_, index) => retrieveGuanyinSemanticEvidence(index + 1, "career").coverage).every((coverage) => coverage === "reviewed")).toBe(true);
  });
  it("拒绝无效签号和问题领域", () => {
    expect(() => retrieveGuanyinSemanticEvidence(0, "career")).toThrow(RangeError);
    expect(() => retrieveGuanyinSemanticEvidence(1, "education")).toThrow("问题领域 education 无效");
  });
});

describe("安全抽签", () => {
  it("结果始终位于 1 至 100", () => {
    const values = [0, 99, 100, 4_294_967_199];
    for (const value of values) {
      const provider: RandomValuesProvider = { getRandomValues(array) { (array as Uint32Array)[0] = value; return array; } };
      expect(drawGuanyinStickNumber(provider)).toBeGreaterThanOrEqual(1);
      expect(drawGuanyinStickNumber(provider)).toBeLessThanOrEqual(100);
    }
  });
  it("以拒绝采样跳过有偏的尾部值", () => {
    const values = [4_294_967_295, 99];
    const provider: RandomValuesProvider = { getRandomValues(array) { (array as Uint32Array)[0] = values.shift() ?? 0; return array; } };
    expect(drawGuanyinStickNumber(provider)).toBe(100);
  });
});

describe("观音签结构化推理", () => {
  it("按问题意图区分搬迁与启程，避免同领域证据串用", () => {
    const relocation = reason(4, "travel", "现在适合搬家吗？");
    const departure = reason(4, "travel", "准备好的行程现在可以启程吗？");
    expect(relocation.evidence.some((item) => item.tag.id === "action.hold")).toBe(true);
    expect(departure.evidence.some((item) => item.tag.id === "action.hold")).toBe(false);
  });
  it("对停止检查或治疗的问题优先给出明确医疗安全回答", () => {
    const result = reason(21, "health", "身体好转后是否可以立即停止检查或治疗？");
    expect(result.questionAnalysis.primaryIntent).toBe("treatment_change");
    expect(result.evidence.some((item) => item.tag.id === "theme.opportunity")).toBe(false);
    expect(result.evidence.some((item) => item.tag.id === "theme.medical_support")).toBe(true);
    expect(result.primarySafetyAnswer?.text).toContain("不要仅根据签文自行停止");
  });
  it("家庭问题不会误用交易、出行或搬迁的推进证据", () => {
    const result = reason(55, "family", "家庭已有稳定基础时，可以推进新的安排吗？");
    expect(result.evidence.some((item) => item.tag.id === "action.advance")).toBe(false);
    expect(result.evidence.some((item) => item.tag.id === "risk.household_instability")).toBe(true);
    expect(result.coreJudgment?.text).toContain("现实不安");
  });
  it("家庭波折问题直接回答是否改变安排，并保留紧急现实例外", () => {
    const result = reason(12, "family", "家庭事务出现波折时，现在应该马上改变安排吗？");
    expect(result.questionAnalysis.primaryIntent).toBe("family_change");
    expect(result.coreJudgment?.tagIds).toEqual(["pattern.difficulty_then_relief"]);
    expect(result.coreJudgment?.text).toContain("不宜因为暂时波折就立即作出重大、不可逆的改变");
    expect(result.coreJudgment?.text).toContain("必要的小幅调整");
    expect(result.practicalGuidance.some((item) => item.text.includes("人身安全") && item.text.includes("照护中断"))).toBe(true);
  });
  it("关系和合用于校正承诺问题，但不替代双方真实意愿", () => {
    const difficult = reason(5, "marriage", "遇到阻碍时应该立即确定关系吗？");
    const favorable = reason(21, "marriage", "条件有利时是否应该立即确定关系？");
    expect(difficult.coreJudgment?.text).toContain("不宜强行推进");
    expect(favorable.coreJudgment?.text).toContain("双方真实意愿");
    expect(favorable.practicalGuidance.some((item) => item.text.includes("双方明确、持续的同意"))).toBe(true);
  });
  it("把等待和急进风险组合为可追溯的核心判断", () => {
    const result = reason(19, "career");
    expect(result.coverage).toBe("reviewed");
    expect(result.coreJudgment?.text).toContain("暂缓行动");
    expect(result.coreJudgment?.tagIds).toEqual(["action.wait", "risk.rushing"]);
    expect(result.actions.map((item) => item.tagIds[0])).toEqual(expect.arrayContaining(["action.wait", "action.hold"]));
    expect(result.risks.map((item) => item.tagIds[0])).toContain("risk.rushing");
    expect(result.timing.map((item) => item.tagIds[0])).toContain("time.wait_for_timing");
  });
  it("不会把只有机会标签的签解释为应立即推进", () => {
    const result = reason(21, "career");
    expect(result.coreJudgment?.text).toContain("没有行动标签支持立即推进");
    expect(result.actions).toEqual([]);
    expect(result.practicalGuidance.some((item) => item.text.includes("分阶段、可回退"))).toBe(true);
  });
  it("结构化推理沿用领域过滤结果", () => {
    const wealth = reason(4, "wealth", "什么时候适合行动？");
    const travel = reason(4, "travel", "现在适合搬家吗？");
    expect(wealth.actions).toEqual([]);
    expect(wealth.timing.map((item) => item.tagIds[0])).toContain("time.autumn_winter");
    expect(travel.actions.map((item) => item.tagIds[0])).toContain("action.hold");
    expect(travel.timing).toEqual([]);
  });
  it("每条推理陈述都可回溯到本次检索证据", () => {
    for (const profile of guanyinReviewedSemanticProfiles) {
      for (const domain of questionDomains) {
        const result = reason(profile.signId, domain);
        const evidenceTagIds = new Set(result.evidence.map((item) => item.tag.id));
        const evidenceSourceIds = new Set(result.evidence.map((item) => item.sourceId));
        const statements = [
          ...(result.coreJudgment ? [result.coreJudgment] : []),
          ...result.themes,
          ...result.trends,
          ...result.actions,
          ...result.risks,
          ...result.timing,
          ...result.symbols,
        ];
        expect(statements.every((item) => item.tagIds.every((tagId) => evidenceTagIds.has(tagId)))).toBe(true);
        expect(statements.every((item) => item.sourceIds.every((sourceId) => evidenceSourceIds.has(sourceId)))).toBe(true);
      }
    }
  });
  it("完整覆盖后每支签均能返回已复核证据", () => {
    for (let signId = 1; signId <= 100; signId += 1) expect(reason(signId, "career").coverage).toBe("reviewed");
  });
  it("根据人工反馈组合徒劳风险与待时，但不解释为彻底放弃", () => {
    const result = reason(10, "career");
    expect(result.coreJudgment?.tagIds).toEqual(["risk.wasted_effort", "time.wait_for_timing"]);
    expect(result.coreJudgment?.text).toContain("停止无效消耗");
    expect(result.coreJudgment?.text).toContain("不等于彻底放弃");
  });
  it("徒劳风险与守成同时出现时停止错误方法但保留目标", () => {
    const result = reason(60, "career", "当前方法让问题扩大时还应继续吗？");
    expect(result.coreJudgment?.tagIds).toEqual(["risk.wasted_effort", "action.hold"]);
    expect(result.coreJudgment?.text).toContain("不宜原样继续或继续加码");
    expect(result.coreJudgment?.text).toContain("保留已有成果");
    expect(result.coreJudgment?.text).toContain("不等于放弃目标");
  });
  it("将核实行动纳入核心判断", () => {
    const result = reason(17, "career");
    expect(result.coreJudgment?.tagIds).toEqual(["action.verify"]);
    expect(result.coreJudgment?.text).toContain("先核对来源");
  });
  it("把现实安全建议与签文证据分层", () => {
    const travel = reason(4, "travel", "现在适合搬家吗？");
    expect(travel.coreJudgment?.tagIds).toEqual(["action.hold"]);
    expect(travel.practicalGuidance.some((item) => item.basis === "system_safety" && item.text.includes("非必要搬迁"))).toBe(true);

    const career = reason(19, "career");
    expect(career.practicalGuidance.some((item) => item.text.includes("投递和面试"))).toBe(true);

    const marriage = reason(24, "marriage");
    expect(marriage.coreJudgment?.tagIds).toEqual(["action.hold", "action.wait", "action.verify"]);
    expect(marriage.practicalGuidance.some((item) => item.category === "relationship_safety" && item.text.includes("优先保护自己"))).toBe(true);
  });
  it("单独等待时允许准备和观察，而不是要求完全不行动", () => {
    const result = reason(6, "career");
    expect(result.coreJudgment?.text).toContain("先做好准备并观察条件");
    expect(result.coreJudgment?.text).toContain("再顺势行动");
  });
  it("受压待时区分现实保护与冲动反击", () => {
    const result = reason(93, "career", "暂时受压时应该立即反击吗？");
    expect(result.coreJudgment?.tagIds).toEqual(["pattern.difficulty_then_relief", "action.hold", "action.wait"]);
    expect(result.coreJudgment?.text).toContain("不等于忍受现实伤害");
    expect(result.practicalGuidance.some((item) => item.text.includes("保存证据") && item.text.includes("避免冲动报复"))).toBe(true);
  });
  it("机会与守成并存时采用保留基础和可逆验证双轨策略", () => {
    const result = reason(95, "career", "有机会消息时是否应改变现状？");
    expect(result.coreJudgment?.tagIds).toEqual(["theme.opportunity", "action.hold"]);
    expect(result.coreJudgment?.text).toContain("低成本、可逆");
  });
  it("把虚幻目标与外部欺骗分开，并为重复无效投入设置退出条件", () => {
    const result = reason(97, "career", "反复追求虚幻目标仍无结果时怎么办？");
    expect(result.evidence.some((item) => item.tag.id === "theme.deception")).toBe(false);
    expect(result.coreJudgment?.tagIds).toEqual(["risk.goal_distortion", "risk.wasted_effort"]);
    expect(result.coreJudgment?.text).toContain("短周期、可衡量");
    expect(result.coreJudgment?.text).toContain("考虑退出");
  });
  it("受困且存在潜在伤害时先主动保护和求助，而非被动等待", () => {
    const result = reason(98, "career", "处境受困时应该马上行动吗？");
    expect(result.coreJudgment?.tagIds).toEqual(["risk.hidden_harm", "action.hold", "action.wait"]);
    expect(result.coreJudgment?.text).toContain("主动寻求可信或正式支持");
    expect(result.coreJudgment?.text).toContain("不是被动忍受伤害");
  });
});

it("项目源码未调用 Math.random", () => {
  const readSources = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? readSources(path) : /\.(ts|tsx)$/.test(entry.name) ? [readFileSync(path, "utf8")] : [];
  });
  const sourceFiles = ["app", "lib"].flatMap((directory) => readSources(resolve(process.cwd(), directory)));
  const forbidden = ["Math", "random"].join(".");
  expect(sourceFiles).not.toContain(forbidden);
});
