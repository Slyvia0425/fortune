import { describe, expect, it } from "vitest";
import { buildGuanyinEvidenceIntegration } from "../lib/guanyin/evidence-integration";
import { bindGuanyinExplanationEvidence, buildGuanyinLlmGenerationRequest, hasMeaningfulGuanyinExplanationGain, validateGuanyinLlmExplanation } from "../lib/guanyin/llm-explanation";
import { getGuanyinStick } from "../lib/guanyin/library";
import { retrieveKnowledgeForGuanyinReasoning } from "../lib/guanyin/knowledge-retrieval";
import { buildGuanyinStructuredReasoning } from "../lib/guanyin/reasoning";

function fixture() {
  const stick = getGuanyinStick(95);
  const reasoning = buildGuanyinStructuredReasoning({ signId: 95, domain: "career", question: "有人口头承诺新职位，我该怎样核实？" });
  const integration = buildGuanyinEvidenceIntegration({ stick, reasoning, knowledge: retrieveKnowledgeForGuanyinReasoning(reasoning, { limit: 3 }) });
  const request = buildGuanyinLlmGenerationRequest({ question: "有人口头承诺新职位，我该怎样核实？", domain: "career", integration });
  const safetyId = integration.evidence.find((item) => item.type === "system_safety")?.sourceId ?? request.payload.safetyEvidence[0].sourceId;
  const output = {
    direct_answer: { text: "不要只凭口头承诺改变现状，应先核实关键条件。", evidence_ids: [safetyId] },
    oracle_context: integration.coreJudgment ? { text: integration.coreJudgment.text, evidence_ids: integration.coreJudgment.sourceIds } : null,
    conditions: [{ text: "只有岗位、薪资和责任主体得到确认后，才适合继续评估。", evidence_ids: [safetyId] }],
    actions: [{ text: "书面确认承诺内容、责任主体、兑现条件和核验时间点。", evidence_ids: [safetyId] }],
    risks: [], safety_guidance: [],
  };
  return { integration, request, safetyId, output };
}

describe("观音签受控 LLM 解释层", () => {
  it("把现实回答与签文倾向分成不同来源层", () => {
    const { integration, request } = fixture();
    expect(request.version).toBe("guanyin-llm-explanation-1.1.0");
    expect(request.systemInstruction).toContain("direct_answer 是现实层直接回答");
    expect(request.systemInstruction).toContain("oracle_context 只说明本签文本倾向");
    expect(request.payload.oracleTendency.coreJudgment).toEqual(integration.coreJudgment);
    expect(request.payload.realityBoundaries.mandatoryActionTopics).toContain("确认责任主体与兑现条件");
    expect(request.outputContract).toHaveProperty("direct_answer");
  });

  it("提取用户的具体处境并拒绝没有回应问题要点的通用解释", () => {
    const stick = getGuanyinStick(16);
    const question = "最近公司发展不稳定，但外面的工作机会也不够明确，我现在适合换工作吗？";
    const reasoning = buildGuanyinStructuredReasoning({ signId: 16, domain: "career", question });
    const integration = buildGuanyinEvidenceIntegration({ stick, reasoning, knowledge: retrieveKnowledgeForGuanyinReasoning(reasoning, { limit: 3 }) });
    const request = buildGuanyinLlmGenerationRequest({ question, domain: "career", integration });
    expect(request.payload.realityBoundaries.questionDetails).toEqual(["最近公司发展不稳定", "外面的工作机会也不够明确"]);
    const { output } = fixture();
    const generic = validateGuanyinLlmExplanation(output, integration, { questionDetails: request.payload.realityBoundaries.questionDetails });
    expect(generic.errors.join(" ")).toContain("最近公司发展不稳定");
    expect(generic.errors.join(" ")).toContain("外面的工作机会也不够明确");
  });

  it("由英文界面开关启用英文理解与英文输出约束", () => {
    const stick = getGuanyinStick(16);
    const question = "My company is unstable, but outside opportunities are unclear. Should I resign now?";
    const reasoning = buildGuanyinStructuredReasoning({ signId: 16, domain: "career", question });
    const integration = buildGuanyinEvidenceIntegration({ stick, reasoning, knowledge: retrieveKnowledgeForGuanyinReasoning(reasoning, { limit: 3 }) });
    const request = buildGuanyinLlmGenerationRequest({ question, domain: "career", integration, locale: "en" });
    expect(request.payload.outputLocale).toBe("en");
    expect(reasoning.questionAnalysis.primaryIntent).toBe("career_change");
    expect(request.systemInstruction).toContain("当前界面语言为英文");
    expect(request.systemInstruction).toContain("不要输出翻译过程、中文解释或中英对照");
    expect(request.payload.realityBoundaries.directAnswerRequirement).toContain("immediate resignation");
    expect(request.payload.realityBoundaries.questionDetails).toContain("My company is unstable");
    expect(request.outputContract.direct_answer).toContain("English words");
  });

  it("把健康行动提醒作为软规则自动补充而不拒绝主体解释", () => {
    const stick = getGuanyinStick(13);
    const question = "My symptoms are improving. Can I stop follow-up visits?";
    const reasoning = buildGuanyinStructuredReasoning({ signId: 13, domain: "health", question });
    const integration = buildGuanyinEvidenceIntegration({ stick, reasoning, knowledge: retrieveKnowledgeForGuanyinReasoning(reasoning, { limit: 3 }) });
    const request = buildGuanyinLlmGenerationRequest({ question, domain: "health", integration, locale: "en" });
    const safetyId = integration.evidence.find((item) => item.type === "system_safety")?.sourceId ?? request.payload.safetyEvidence[0].sourceId;
    const output = {
      direct_answer: { text: "Improving symptoms alone are not enough to decide whether to stop follow-up visits. Confirm the change with a qualified clinician first.", evidence_ids: [safetyId] },
      oracle_context: integration.coreJudgment ? { text: "The lot suggests caution and patience, but it cannot determine your medical condition or replace clinical evidence.", evidence_ids: integration.coreJudgment.sourceIds } : null,
      conditions: [], actions: [], risks: [], safety_guidance: [],
    };
    expect(request.payload.realityBoundaries.mandatoryActionTopics).toEqual([]);
    const result = validateGuanyinLlmExplanation(bindGuanyinExplanationEvidence(output, integration), integration, {
      mandatoryActionTopics: request.payload.realityBoundaries.mandatoryActionTopics,
      softActionGuidance: request.payload.realityBoundaries.softActionGuidance,
      questionDetails: request.payload.realityBoundaries.questionDetails,
    });
    expect(result.errors).toEqual([]);
    expect(result.explanation?.safetyGuidance.map((item) => item.text).join(" ")).toContain("severe or worsen quickly");
  });

  it("不会把内部输出字段写进面向用户的回答要求", () => {
    const stick = getGuanyinStick(95);
    const reasoning = buildGuanyinStructuredReasoning({ signId: 95, domain: "career", question: "我现在应该立刻辞职吗？" });
    const integration = buildGuanyinEvidenceIntegration({ stick, reasoning, knowledge: retrieveKnowledgeForGuanyinReasoning(reasoning, { limit: 3 }) });
    const request = buildGuanyinLlmGenerationRequest({ question: "我现在应该立刻辞职吗？", domain: "career", integration });
    expect(request.payload.realityBoundaries.directAnswerRequirement).not.toMatch(/actions|conditions|direct_answer|必须放入/i);
  });

  it("为婚姻承诺使用关系沟通规则而非商业履约措辞", () => {
    const stick = getGuanyinStick(96);
    const reasoning = buildGuanyinStructuredReasoning({ signId: 96, domain: "marriage", question: "相处顺利，我应该马上相信承诺并结婚吗？" });
    const integration = buildGuanyinEvidenceIntegration({ stick, reasoning, knowledge: retrieveKnowledgeForGuanyinReasoning(reasoning, { limit: 3 }) });
    const request = buildGuanyinLlmGenerationRequest({ question: "相处顺利，我应该马上相信承诺并结婚吗？", domain: "marriage", integration });
    const topics = request.payload.realityBoundaries.mandatoryActionTopics.join("；");
    expect(topics).toContain("婚姻意愿");
    expect(topics).toContain("价值观、财务、居住与家庭安排");
    expect(topics).not.toMatch(/责任主体|兑现条件/);
  });

  it("接受分层引用合法的解释并注入不确定性", () => {
    const { integration, output } = fixture();
    const result = validateGuanyinLlmExplanation(output, integration);
    expect(result.valid).toBe(true);
    expect(result.explanation?.directAnswer.text).toContain("口头承诺");
    expect(result.explanation?.uncertainties).toEqual(integration.uncertainties);
  });

  it("拒绝现实回答引用签文，以及签文倾向引用安全规则", () => {
    const { integration, safetyId, output } = fixture();
    const mixedDirect = structuredClone(output); mixedDirect.direct_answer.evidence_ids = [...integration.coreJudgment!.sourceIds];
    expect(validateGuanyinLlmExplanation(mixedDirect, integration).errors.join(" ")).toContain("direct_answer 没有引用该分区对应的证据");
    const mixedOracle = structuredClone(output); mixedOracle.oracle_context!.evidence_ids = [safetyId];
    expect(validateGuanyinLlmExplanation(mixedOracle, integration).errors.join(" ")).toContain("oracle_context 没有引用该分区对应的证据");
  });

  it("拒绝行动建议引用签文或未知来源", () => {
    const { integration, output } = fixture();
    const wrongAction = structuredClone(output); wrongAction.actions[0].evidence_ids = [...integration.coreJudgment!.sourceIds];
    expect(validateGuanyinLlmExplanation(wrongAction, integration).errors.join(" ")).toContain("actions[0] 没有引用该分区对应的证据");
    const unknown = structuredClone(output); unknown.direct_answer.evidence_ids = ["invented-source"];
    expect(validateGuanyinLlmExplanation(unknown, integration).errors.join(" ")).toContain("未知来源");
  });

  it("在进入硬校验前由程序修复模型放错分区的证据编号", () => {
    const { integration, output } = fixture();
    const misplaced = structuredClone(output);
    misplaced.direct_answer.evidence_ids = [...integration.coreJudgment!.sourceIds];
    misplaced.oracle_context!.evidence_ids = ["invented-source"];
    misplaced.conditions[0].evidence_ids = [...integration.coreJudgment!.sourceIds];
    misplaced.actions[0].evidence_ids = [...integration.coreJudgment!.sourceIds];
    const repaired = bindGuanyinExplanationEvidence(misplaced, integration);
    const result = validateGuanyinLlmExplanation(repaired, integration);
    expect(result.valid).toBe(true);
    expect(result.explanation?.directAnswer.evidenceIds.every((id) => integration.evidence.some((item) => item.sourceId === id && item.type === "system_safety") || id.startsWith("guanyin-generation-safety:"))).toBe(true);
    expect(result.explanation?.oracleContext?.evidenceIds).toEqual(integration.coreJudgment?.sourceIds);
  });

  it("允许否定性安全说明但拒绝正向结果保证", () => {
    const { integration, output } = fixture();
    const safe = structuredClone(output); safe.direct_answer.text = "这不代表项目必然成功，也不作收益保证。";
    expect(validateGuanyinLlmExplanation(safe, integration).errors.join(" ")).not.toContain("确定性");
    const unsafe = structuredClone(output); unsafe.direct_answer.text = "这个项目必然成功。";
    expect(validateGuanyinLlmExplanation(unsafe, integration).errors.join(" ")).toContain("确定性");
  });

  it("允许用确定性词语说明误读风险", () => {
    const { integration, output } = fixture();
    const cautious = structuredClone(output);
    cautious.direct_answer.text = "把签文理解为结果必然改善可能带来误判风险。";
    expect(validateGuanyinLlmExplanation(cautious, integration).errors.join(" ")).not.toContain("确定性");
  });

  it("拒绝向用户暴露内部生成指令和字段名", () => {
    const { integration, output } = fixture();
    const leaked = structuredClone(output);
    leaked.direct_answer.text = "保留现职和可逆验证步骤必须放入 actions。";
    expect(validateGuanyinLlmExplanation(leaked, integration).errors.join(" ")).toContain("泄漏内部生成指令");
  });

  it("压缩与现实回答重复的条件和行动", () => {
    const { integration, output } = fixture();
    const repeated = structuredClone(output); repeated.conditions = [{ ...repeated.direct_answer }]; repeated.actions = [{ ...repeated.direct_answer }];
    const result = validateGuanyinLlmExplanation(repeated, integration);
    expect(result.explanation?.conditions).toEqual([]);
    expect(result.explanation?.actions).toEqual([]);
  });

  it("缺少问题所需的专项行动时拒绝输出", () => {
    const { integration, output } = fixture();
    const result = validateGuanyinLlmExplanation(output, integration, { mandatoryActionTopics: ["设置核验时间点并比较实际行为"] });
    expect(result.errors.join(" ")).toContain("缺少必需行动");
    const complete = structuredClone(output);
    complete.actions[0].text = "书面记录承诺，并设置核验时间点比较实际行为。";
    expect(validateGuanyinLlmExplanation(complete, integration, { mandatoryActionTopics: ["设置核验时间点并比较实际行为"] }).valid).toBe(true);
  });

  it("区分纯复述和具有现实行动增量的解释", () => {
    const { integration, safetyId } = fixture();
    const repeated = { version: "guanyin-llm-explanation-1.1.0" as const, directAnswer: { text: integration.coreJudgment!.text, evidenceIds: [safetyId] }, oracleContext: null, conditions: [], actions: [], risks: [], safetyGuidance: [], uncertainties: integration.uncertainties, disclaimer: "测试" };
    expect(hasMeaningfulGuanyinExplanationGain(repeated, integration)).toBe(false);
    const useful = { ...repeated, directAnswer: { text: "先保留现状并核实条件。", evidenceIds: [safetyId] }, actions: [{ text: "书面确认责任主体和兑现时间，再比较实际行为。", evidenceIds: [safetyId] }] };
    expect(hasMeaningfulGuanyinExplanationGain(useful, integration)).toBe(true);
  });
});
