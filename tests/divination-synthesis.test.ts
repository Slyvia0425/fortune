import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import type { DivinationEvidencePack, HybridEvidencePack, HybridInterpretation, LiuyaoCoreFacts } from "../lib/contracts/divination";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

it.each([true, false])("综合请求包含规则案例与 core，候选通过=%s", async (accepted) => {
  vi.stubEnv("LLM_API_KEY", "test-key"); vi.stubEnv("LLM_MODEL", "test-model");
  vi.resetModules();
  const { interpretDivinationEvidence } = await import("../lib/server/divination-llm");
  const pack = { evidence: [{ evidence_id: "zhouyi:1" }], question: "求职" } as DivinationEvidencePack;
  const unit = (kind: string, id: string) => ({ kind, entity_revision_id: id, usage: "analogy_only", condition_evaluation: "unknown", source_quotes: [{ quote: "原文" }] });
  const evidence = { reasoning_mode: "llm_source_reasoning", interpretation_contract: { model_reasoning_allowed: true }, reasoning_evidence: [unit("rule", "rule:1"), unit("case", "case:1"), { ...unit("case", "blocked"), not_for_interpretation: true }] } as unknown as HybridEvidencePack;
  const analysis = { selection: { line_ref: null }, uncertainties: ["条件不足"] };
  const candidateAnalysis = { status: accepted ? "generated" : "unavailable", validation: accepted ? "references_and_core_facts" : "not_generated", analysis, attempts: [{ raw_output: "REJECTED_SECRET" }] } as unknown as HybridInterpretation;
  const core = { main_lines: [{ ref: "main:5", kin: "officials" }] } as unknown as LiuyaoCoreFacts;
  const output = { rule_applicability: [{evidence_id:"R1",status:"applicable",original_scope:"功名",question_match:"求职类比",reason:"事项相似"}],case_comparisons:[{evidence_id:"C1",status:"applicable",similarities:"同问职位",differences:"盘面不同",lesson:"不能套用"}], overall_interpretation: "综合解释", readings: [{ evidence_id: "T1", modern_chinese: "转述" }], contextual_reflections: [{ text: "规则和案例对照", evidence_ids: ["R1", "C1"] }], uncertainties: [] };
  const reply = (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const answer = body.messages[0].content.includes("你是证据复核员") ? { approved: true, issues: [] } : output;
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] })));
  };
  const fetchMock = vi.fn().mockImplementation(reply);
  vi.stubGlobal("fetch", fetchMock);
  const result = await interpretDivinationEvidence(pack, { core, evidence, candidateAnalysis });
  const request = JSON.parse(fetchMock.mock.calls[0][1].body);
  const input = JSON.parse(request.messages[1].content);
  expect(input.rule_evidence.map((e: {entity_revision_id:string}) => e.entity_revision_id)).toEqual(["R1"]);
  expect(input.case_evidence.map((e: {entity_revision_id:string}) => e.entity_revision_id)).toEqual(["C1"]);
  expect(input.core_facts).toEqual(core);
  expect(input.candidate_analysis).toEqual(accepted ? analysis : null);
  expect(request.messages[1].content).not.toContain("REJECTED_SECRET");
  expect(result.interpretation.contextual_reflections[0].evidence_ids).toEqual(["rule:1", "case:1"]);
  output.contextual_reflections[0].evidence_ids = ["C1", "fake"];
  fetchMock.mockImplementation(reply);
  await expect(interpretDivinationEvidence(pack, { core, evidence, candidateAnalysis })).rejects.toThrow("SYNTHESIS_CITATION_INVALID");
  expect(fetchMock).toHaveBeenCalledTimes(3); // one success, one failure, one repair; no semantic audit
  const repair = JSON.parse(fetchMock.mock.calls[2][1].body);
  expect(repair.messages.at(-1).content).toContain("唯一一次修正");
  const failure = await interpretDivinationEvidence(pack, {core,evidence,candidateAnalysis}).catch(error => error);
  expect(failure.diagnostic).toMatchObject({stage:"citations",code:"SYNTHESIS_CITATION_INVALID",log_saved:true});
  const log = JSON.parse(readFileSync(`.runtime/interpretation-diagnostics/${failure.diagnostic.run_id}.json`, "utf8"));
  expect(log.failures).toHaveLength(2);
  expect(log.calls).toHaveLength(2);
  expect(JSON.stringify(log)).not.toContain("test-key");
  output.contextual_reflections[0].evidence_ids = ["R1", "C1"];
  output.rule_applicability = [];
  output.case_comparisons = [];
  output.overall_interpretation = "存在争议的解释内容仍由模型负责，Guardian 不筛查含义。";
  fetchMock.mockClear();
  const acceptedResult = await interpretDivinationEvidence(pack, {core,evidence,candidateAnalysis});
  expect(acceptedResult.interpretation.overall_interpretation).toBe(output.overall_interpretation);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  output.contextual_reflections[0].evidence_ids = ["T1"];
  await expect(interpretDivinationEvidence(pack,{core,evidence,candidateAnalysis})).rejects.toThrow("RETRIEVED_EVIDENCE_NOT_CITED");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content).not.toContain("你是证据复核员");
});
