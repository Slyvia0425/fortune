import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HybridEvidencePack, LiuyaoCoreFacts } from "../lib/contracts/divination";
import { parseHybridReadings } from "../lib/divination/hybrid-interpretation";

const services = vi.hoisted(() => ({ call: vi.fn(), classical: vi.fn(), hybrid: vi.fn(), plan:vi.fn() }));
vi.mock("../lib/server/liuyao-hybrid", () => ({ DIVINATION_SESSION_COOKIE: "anonymous", callHybrid: services.call, HybridServiceError: class extends Error {} }));
vi.mock("../lib/server/module4-auth", () => ({ AUTH_COOKIE: "auth" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "test-session" }) }) }));
vi.mock("../lib/server/interpretation-cache", () => ({ cachedInterpretation: (_owner: string, _body: unknown, _retry: boolean, generate: () => Promise<Response>) => generate() }));
vi.mock("../lib/server/divination-llm", () => ({ divinationLlmConfigured: () => true,
  interpretDivinationEvidence: services.classical, determineUseRoles: services.hybrid,planRetrievalQueries:services.plan }));
import { POST as cast } from "../app/api/divination/cast/route";
import { POST as interpret } from "../app/api/divination/interpret/route";

const chartId = "00000000-0000-0000-0000-000000000001";
const confirmationId = "00000000-0000-0000-0000-000000000002";
const hex = { number: 1, name: "乾", upper_trigram: "乾", lower_trigram: "乾", lines: [9,7,7,7,7,7] };
const changed = { number: 44, name: "姤", upper_trigram: "乾", lower_trigram: "巽", lines: [8,7,7,7,7,7] };
const core={main_lines:[],hidden_lines:[],transformed_lines:[]} as unknown as LiuyaoCoreFacts;
const frozen = { chart_id: chartId, chart_hash: "frozen-hash", confirmation_id:confirmationId,question_hash:"question-hash", core_facts:core, primary: hex, transformed: changed, mutual: hex, moving_lines: [1] };
const serverContext={raw_question:"服务端原问题",known_facts:[{value:"用户明确背景"}]};
const frozenRecord=(question:string,hybrid_evidence?:HybridEvidencePack)=>({cast:frozen,question,hybrid_evidence,confirmation_status:"confirmed",question_context:serverContext,confirmed_question:{confirmation_id:confirmationId,question_hash:"question-hash",normalized_question:question}});
const roles={rules_version:"fixed-use-branches-v1",chart_hash:"frozen-hash",status:"generated",primary:{role:"officials",meaning:"职位",rule_id:"career",reason:"问职位",main_line_refs:[],hidden_line_refs:[],location_status:"absent"},auxiliary:[],missing_information:[],uncertainties:[]};
const pack = { chart_id: chartId, chart_hash: "frozen-hash", method_profile_id: "zengshan-single-cast-v1",
  status: "evidence_insufficient", supporting_evidence: [], gaps: ["NO_ELIGIBLE_EVIDENCE"],
  interpretation_contract: { strong_conclusion_allowed: false } } as unknown as HybridEvidencePack;
const request = (body: unknown) => new Request("http://localhost/api/divination/interpret", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.stubEnv("LIUYAO_RETRIEVAL_PIPELINE","v1");
  vi.resetAllMocks();
  services.classical.mockResolvedValue({ interpretation: { overall_interpretation: "文本转述" }, model: "test" });
  services.hybrid.mockResolvedValue(roles);
  services.plan.mockResolvedValue({status:"generated",queries:[{lane:"theory",query:"官鬼 酉化申 进退神"}],warnings:[]});
});

describe("网页冻结盘接线", () => {
  it("客户端伪造背景不会覆盖冻结问事",async()=>{
    services.call.mockResolvedValue(frozenRecord("服务端原问题",pack));
    await interpret(request({chart_id:chartId,question_context:{raw_question:"换问事",known_facts:["编造背景"]}}));
    expect(services.hybrid).toHaveBeenCalledWith(core,"服务端原问题","frozen-hash",serverContext);
    expect(services.call).toHaveBeenCalledWith("source-evidence",expect.objectContaining({question_context:serverContext}));
  });
  it("未确认旧盘只读，不冒充确认记录或重跑解释",async()=>{
    services.call.mockResolvedValue({cast:frozen,question:"旧问事",confirmation_status:"legacy_unconfirmed"});
    const body=await (await interpret(request({chart_id:chartId}))).json();
    expect(body.result.confirmation_status).toBe("legacy_unconfirmed");expect(body.result.modern_interpretation).toBeNull();
    expect(services.hybrid).not.toHaveBeenCalled();expect(services.classical).not.toHaveBeenCalled();
  });
  it("确认与盘面绑定不一致时停止",async()=>{
    services.call.mockResolvedValue({...frozenRecord("原问题",pack),confirmed_question:{confirmation_id:"another",question_hash:"question-hash",normalized_question:"原问题"}});
    expect((await interpret(request({chart_id:chartId}))).status).toBe(409);
    expect(services.hybrid).not.toHaveBeenCalled();
  });
  it("起卦只送服务端确认引用，不信任客户端问题数字", async () => {
    services.call.mockResolvedValue(frozen);
    const response = await cast(request({ confirmation_id:confirmationId, request_id: chartId }));
    expect(response.status).toBe(200);
    expect(services.call).toHaveBeenCalledTimes(1);
    expect(services.call).toHaveBeenCalledWith("cast", {confirmation_id:confirmationId,request_id:chartId});
  });
  it("解释使用服务端原问题和卦盘，并传入真实混合证据包", async () => {
    services.call.mockResolvedValue(frozenRecord("服务端原问题",pack));
    const response = await interpret(request({ chart_id: chartId, chart_hash: "frozen-hash" }));
    expect(response.status).toBe(200);
    expect(services.call).toHaveBeenCalledWith("frozen", { chart_id: chartId });
    expect(services.call).toHaveBeenCalledWith("source-evidence",expect.objectContaining({chart_id:chartId,chart_hash:"frozen-hash",queries:expect.any(Array)}));
    expect(services.classical.mock.calls[0][0].question).toBe("服务端原问题");
    expect(services.classical.mock.calls[0][1]).toMatchObject({ core, evidence: pack,roleAnalysis:roles });
    expect(services.hybrid.mock.invocationCallOrder[0]).toBeLessThan(services.classical.mock.invocationCallOrder[0]);
    expect(services.hybrid).toHaveBeenCalledWith(core, "服务端原问题", "frozen-hash",serverContext);
    expect(services.call.mock.invocationCallOrder[0]).toBeLessThan(services.hybrid.mock.invocationCallOrder[0]);
    expect(services.hybrid.mock.invocationCallOrder[0]).toBeLessThan(services.call.mock.invocationCallOrder[1]);
    expect(services.hybrid.mock.invocationCallOrder[0]).toBeLessThan(services.plan.mock.invocationCallOrder[0]);
    expect(services.plan.mock.invocationCallOrder[0]).toBeLessThan(services.call.mock.invocationCallOrder[1]);
    expect(services.call).toHaveBeenCalledWith("source-evidence",expect.objectContaining({queries:["官鬼 酉化申 进退神\n问事：服务端原问题"],query_lanes:["theory"]}));
    expect((await response.json()).result.hybrid_evidence.chart_hash).toBe("frozen-hash");
  });
  it("拒绝浏览器盘面／问题替换，以及不匹配哈希", async () => {
    expect((await interpret(request({ chart_id: chartId, cast_result: frozen, question: "篡改" }))).status).toBe(422);
    expect(services.call).not.toHaveBeenCalled();
    services.call.mockResolvedValue(frozenRecord("原问题",pack));
    expect((await interpret(request({ chart_id: chartId, chart_hash: "altered" }))).status).toBe(409);
    expect(services.classical).not.toHaveBeenCalled();
  });
  it("规划失败使用原始query继续并保留告警",async()=>{
    services.call.mockResolvedValue(frozenRecord("求职",pack));
    services.plan.mockResolvedValue({status:"fallback",queries:[{lane:"all",query:"求职 官鬼"}],warnings:["规划失败，使用原始query"]});
    const body=await (await interpret(request({chart_id:chartId}))).json();
    expect(body.result.retrieval_plan.status).toBe("fallback");
    expect(body.warnings).toContain("规划失败，使用原始query");
    expect(services.classical).toHaveBeenCalled();
  });
  it("模型故障仍保留来源和缺口，不将失败当成依据充分", async () => {
    services.call.mockResolvedValue(frozenRecord("原问题",pack));
    services.classical.mockRejectedValue(new Error("offline"));
    const response = await interpret(request({ chart_id: chartId }));
    const result = (await response.json()).result;
    expect(result.modern_interpretation).toBeNull();
    expect(result.evidence_pack.evidence.length).toBeGreaterThan(0);
    expect(result.use_role_analysis.status).toBe("generated");
  });
  it("取用未决时保留冻结盘而不检索或综合解释",async()=>{
    services.call.mockResolvedValue(frozenRecord("能否结婚"));
    services.hybrid.mockResolvedValue({...roles,status:"insufficient",primary:null,missing_information:["问事视角未明确"]});
    const response=await interpret(request({chart_id:chartId}));
    const result=(await response.json()).result;
    expect(result.use_role_analysis.status).toBe("insufficient");
    expect(result.frozen_core).toEqual(core);
    expect(services.call).toHaveBeenCalledTimes(1);
    expect(services.classical).not.toHaveBeenCalled();
  });
});

it("引用与冻结上下文校验拒绝模型捏造引用及盘面", () => {
  const ready = { ...pack, status: "evidence_ready", interpretation_contract: { strong_conclusion_allowed: true },
    supporting_evidence: [{ entity_revision_id: "rule:1", not_for_interpretation: false, condition_evaluation: "true", conflict_group_ids: [] }] } as unknown as HybridEvidencePack;
  const payload = { chart_hash: "frozen-hash", method_profile_id: pack.method_profile_id, readings: [{ text: "条件式解释", evidence_ids: ["rule:1"] }] };
  expect(parseHybridReadings(JSON.stringify(payload), ready)).toHaveLength(1);
  expect(() => parseHybridReadings(JSON.stringify({ ...payload, chart_hash: "other" }), ready)).toThrow();
  expect(() => parseHybridReadings(JSON.stringify({ ...payload, readings: [{ text: "伪造", evidence_ids: ["fake"] }] }), ready)).toThrow();
  expect(() => parseHybridReadings(JSON.stringify(payload), pack)).toThrow();
});

it("真实规则解释入口在缺证时不调用模型", async () => {
  const actual = await vi.importActual<typeof import("../lib/server/divination-llm")>("../lib/server/divination-llm");
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  try {
    const result = await actual.interpretHybridEvidence(pack, undefined, "原问题");
    expect(result.status).toBe("insufficient");
    expect(result.readings).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});


it("向前端保留语义复核的阶段、原因与日志编号", async () => {
  const { RecordedInterpretationFailure } = await import("../lib/server/interpretation-diagnostics");
  services.call.mockResolvedValue(frozenRecord("求职",pack));
  services.classical.mockRejectedValue(new RecordedInterpretationFailure({run_id:"test-diagnostic",stage:"semantic_review",code:"SEMANTIC_REVIEW_REJECTED",reasons:["原文不支持文书延迟"],log_saved:true}));
  const response=await interpret(request({chart_id:chartId}));
  const body=await response.json();
  expect(body.result.interpretation_diagnostic.code).toBe("SEMANTIC_REVIEW_REJECTED");
  expect(body.result.diagnostic_run_id).toBe("test-diagnostic");
  expect(body.warnings.join(" ")).toContain("证据语义复核未通过");
  expect(body.warnings.join(" ")).toContain("原文不支持文书延迟");
  expect(body.warnings.join(" ")).not.toContain("格式或引用完整性校验");
});

it("模型故障时提供单独标记的基础文本解释，保留高级分析失败状态", async()=>{
  services.call.mockResolvedValue(frozenRecord("原问题",pack));
  services.classical.mockRejectedValue(new Error("offline"));
  const body=await (await interpret(request({chart_id:chartId}))).json();
  expect(body.result.modern_interpretation).toBeNull();
  expect(body.result.basic_interpretation.overall_interpretation).toContain("基础文本解释");
  expect(body.result.basic_interpretation.readings.map((x:{evidence_id:string})=>x.evidence_id)).toEqual(body.result.evidence_pack.evidence.map((x:{evidence_id:string})=>x.evidence_id));
  expect(body.result.basic_interpretation.overall_interpretation).toContain(body.result.evidence_pack.evidence[0].original);
});

it("检索服务故障仍输出原盘文本，不伪造检索或模型结果",async()=>{
  services.call.mockImplementation(async(endpoint:string)=>{
    if(endpoint==="frozen")return frozenRecord("原问题",pack);
    throw new Error("retrieval offline");
  });
  const response=await interpret(request({chart_id:chartId}));
  const body=await response.json();
  expect(response.status).toBe(200);
  expect(body.result.analysis_status).toBe("reasoning_failed");
  expect(body.result.basic_interpretation.overall_interpretation).toContain("原问题");
  expect(body.result.modern_interpretation).toBeNull();
  expect(services.classical).not.toHaveBeenCalled();
});
