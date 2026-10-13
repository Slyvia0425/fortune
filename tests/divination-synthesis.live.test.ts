// Explicit opt-in; replays a saved chart/evidence pack against the real configured model.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { DivinationInterpretationResult } from "../lib/contracts/divination";
import { interpretDivinationEvidence, interpretHybridEvidence } from "../lib/server/divination-llm";
const inputFile = process.env.LIUYAO_SYNTHESIS_INPUT;
const outputDir = process.env.LIUYAO_SYNTHESIS_OUTPUT;
it.skipIf(!inputFile || !outputDir)("真实综合解释：冻结盘、规则案例、候选分析", async () => {
  const saved = JSON.parse(readFileSync(inputFile!, "utf8")).body.result as DivinationInterpretationResult;
  const records: unknown[] = [];
  const originalFetch = globalThis.fetch;
  mkdirSync(outputDir!, { recursive: true });
  globalThis.fetch = async (input, init) => {
    const request = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const response = await originalFetch(input, init);
    const payload = await response.clone().json();
    records.push({ request, status: response.status, response: payload });
    writeFileSync(join(outputDir!, "model-calls.json"), JSON.stringify(records, null, 2));
    return response;
  };
  try {
    const candidate = await interpretHybridEvidence(saved.hybrid_evidence!, saved.frozen_core, saved.evidence_pack.question);
    writeFileSync(join(outputDir!, "candidate.json"), JSON.stringify(candidate, null, 2));
    const result = await interpretDivinationEvidence(saved.evidence_pack, { core: saved.frozen_core, evidence: saved.hybrid_evidence!, candidateAnalysis: candidate });
    writeFileSync(join(outputDir!, "result.json"), JSON.stringify({ chart_id: saved.hybrid_evidence!.chart_id, question: saved.evidence_pack.question, retrieval: "replayed_frozen_evidence", candidate_status: candidate.status, ...result }, null, 2));
    expect(result.interpretation.overall_interpretation).toBeTruthy();
  } catch (error) {
    writeFileSync(join(outputDir!, "failure.json"), JSON.stringify({ error: error instanceof Error ? error.message : String(error), diagnostic: (error as {diagnostic?:unknown}).diagnostic }, null, 2));
    throw error;
  } finally { globalThis.fetch = originalFetch; }
}, 480_000);
