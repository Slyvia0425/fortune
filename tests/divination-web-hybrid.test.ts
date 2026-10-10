import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HybridEvidencePack } from "../lib/contracts/divination";
import { parseHybridReadings } from "../lib/divination/hybrid-interpretation";

const services = vi.hoisted(() => ({ call: vi.fn(), classical: vi.fn(), hybrid: vi.fn() }));
vi.mock("../lib/server/liuyao-hybrid", () => ({ callHybrid: services.call, HybridServiceError: class extends Error {} }));
vi.mock("../lib/server/divination-llm", () => ({ divinationLlmConfigured: () => true,
  interpretDivinationEvidence: services.classical, interpretHybridEvidence: services.hybrid }));
import { POST as cast } from "../app/api/divination/cast/route";
import { POST as interpret } from "../app/api/divination/interpret/route";

const chartId = "00000000-0000-0000-0000-000000000001";
const hex = { number: 1, name: "乾", upper_trigram: "乾", lower_trigram: "乾", lines: [9,7,7,7,7,7] };
const changed = { number: 44, name: "姤", upper_trigram: "乾", lower_trigram: "巽", lines: [8,7,7,7,7,7] };
const frozen = { chart_id: chartId, chart_hash: "frozen-hash", primary: hex, transformed: changed, mutual: hex, moving_lines: [1] };
const pack = { chart_id: chartId, chart_hash: "frozen-hash", method_profile_id: "zengshan-single-cast-v1",
  status: "evidence_insufficient", supporting_evidence: [], gaps: ["NO_ELIGIBLE_EVIDENCE"],
  interpretation_contract: { strong_conclusion_allowed: false } } as unknown as HybridEvidencePack;
const request = (body: unknown) => new Request("http://localhost/api/divination/interpret", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  services.classical.mockResolvedValue({ interpretation: { overall_interpretation: "文本转述" }, model: "test" });
  services.hybrid.mockResolvedValue({ status: "insufficient", readings: [], message: "依据不足" });
});

describe("网页冻结盘接线", () => {
  it("三数字只送到服务端冻结入口，不另调 Python 再起一盘", async () => {
    services.call.mockResolvedValue(frozen);
    const response = await cast(request({ method: "three_numbers", question: "原问事", numbers: [3,5,8], request_id: chartId }));
    expect(response.status).toBe(200);
    expect(services.call).toHaveBeenCalledTimes(1);
    expect(services.call).toHaveBeenCalledWith("cast", expect.objectContaining({ numbers: [3,5,8], request_id: chartId }));
  });
  it("解释使用服务端原问题和卦盘，并传入真实混合证据包", async () => {
    services.call.mockResolvedValue({ cast: frozen, question: "服务端原问题", hybrid_evidence: pack });
    const response = await interpret(request({ chart_id: chartId, chart_hash: "frozen-hash" }));
    expect(response.status).toBe(200);
    expect(services.call).toHaveBeenCalledWith("evidence", { chart_id: chartId });
    expect(services.classical.mock.calls[0][0].question).toBe("服务端原问题");
    expect(services.hybrid).toHaveBeenCalledWith(pack, undefined, "服务端原问题");
    expect((await response.json()).result.hybrid_evidence.chart_hash).toBe("frozen-hash");
  });
  it("拒绝浏览器盘面／问题替换，以及不匹配哈希", async () => {
    expect((await interpret(request({ chart_id: chartId, cast_result: frozen, question: "篡改" }))).status).toBe(422);
    expect(services.call).not.toHaveBeenCalled();
    services.call.mockResolvedValue({ cast: frozen, question: "原问题", hybrid_evidence: pack });
    expect((await interpret(request({ chart_id: chartId, chart_hash: "altered" }))).status).toBe(409);
    expect(services.classical).not.toHaveBeenCalled();
  });
  it("模型故障仍保留来源和缺口，不将失败当成依据充分", async () => {
    services.call.mockResolvedValue({ cast: frozen, question: "原问题", hybrid_evidence: pack });
    services.classical.mockRejectedValue(new Error("offline"));
    services.hybrid.mockRejectedValue(new Error("invalid citation"));
    const response = await interpret(request({ chart_id: chartId }));
    const result = (await response.json()).result;
    expect(result.modern_interpretation).toBeNull();
    expect(result.evidence_pack.evidence.length).toBeGreaterThan(0);
    expect(result.hybrid_interpretation.status).toBe("unavailable");
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
