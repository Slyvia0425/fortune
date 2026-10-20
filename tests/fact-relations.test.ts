import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LiuyaoCoreFacts } from "../lib/contracts/divination";
import { deriveCoreRelations } from "../lib/divination/fact-relations";
import { resolveReviewedUseRoles } from "../lib/divination/deterministic-use-roles";
import { failedQuestionAnalysis } from "../lib/divination/question-analysis";
import { emptyQuestionContext } from "../lib/divination/core";

const load = (path = "../docs/examples/liuyao-245-core.json") =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as LiuyaoCoreFacts;

describe("PR6.5 directed facts", () => {
  it("replays job 2,4,5 with earth → metal and leaves the frozen chart intact", () => {
    const core = load(), before = JSON.stringify(core);
    const facts = deriveCoreRelations(core, "stored-chart-hash");
    expect(facts.find(r => r.source_ref === "main:3" && r.target_ref === "main:5"))
      .toMatchObject({source_element: "土", target_element: "金", element_relation: "generates"});
    expect(facts.find(r => r.source_ref === "main:5" && r.target_ref === "main:3"))
      .toMatchObject({element_relation: "generated_by"});
    expect(facts.length).toBe(30 + 2 * core.main_lines.filter(l => l.moving).length + 2 * core.hidden_lines.length);
    expect(JSON.stringify(core)).toBe(before);
    expect(deriveCoreRelations(core, "stored-chart-hash")).toEqual(facts);
    expect(deriveCoreRelations(core, "another-hash")[0].relation_id).not.toBe(facts[0].relation_id);
  });
  it("validates hidden-to-flying reverse relations and rejects tampering", () => {
    const core = load("../tests/fixtures/liuyao-core-gou.json");
    const facts = deriveCoreRelations(core, "hash");
    expect(facts.find(r => r.source_ref === "main:2" && r.target_ref === "hidden:2")?.element_relation).toBe("generates");
    expect(facts.find(r => r.source_ref === "hidden:2" && r.target_ref === "main:2")?.element_relation).toBe("generated_by");
    core.hidden_lines[0].flying_line_ref = "main:3";
    expect(() => deriveCoreRelations(core, "hash")).toThrow("RELATION_CORE_INVALID");
  });
  it.each(["ref", "element", "yin_yang_value"] as const)("rejects inconsistent %s", key => {
    const core = load();
    Object.assign(core.transformed_lines[0], {[key]: key === "yin_yang_value" ? 9 : "invalid"});
    expect(() => deriveCoreRelations(core, "hash")).toThrow("RELATION_CORE_INVALID");
  });
  it("does not infer self from missing subject or resolve multiple career candidates", () => {
    const core = load();
    const q = {...failedQuestionAnalysis(emptyQuestionContext("我能找到工作吗"), "test"),
      status: "valid" as const, domain: "career" as const, event_type: "new_job"};
    expect(resolveReviewedUseRoles(core, "hash", q).status).toBe("unsupported");
    const actor = {id: "A", label: "我", role: "querent" as const, evidence: {source_id: "question", start: 0, end: 1, text: "我"}};
    const confirmed = {...q, actors: [actor], subject_actor_id: "A"};
    expect(resolveReviewedUseRoles(core, "hash", confirmed).status).toBe("resolved");
    const multiple = load("../tests/fixtures/liuyao-core-multiple-officials.json");
    const result = resolveReviewedUseRoles(multiple, "hash", confirmed);
    expect(result.status).toBe("ambiguous");
    expect(result.analysis?.primary?.main_line_refs.length).toBeGreaterThan(1);
    expect(result.analysis?.status).toBe("insufficient");
  });
});
