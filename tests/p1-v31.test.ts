import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import history from "./fixtures/p1-v31-history.json";
import { validateAnalysisPlan, minimumAnalysisPlan, inspectAnalysisPlan } from "../lib/divination/analysis-plan";
import { buildPlannerInput } from "../lib/divination/planner-input";
import { coverageContract, missingCoverage } from "../lib/divination/planner-contract";
import type { LiuyaoCoreFacts, UseRoleAnalysis } from "../lib/contracts/divination";
import type { FactCatalog } from "../lib/divination/analysis-facts";
import type { SingleQuestionAnalysis } from "../lib/divination/question-analysis";
import { normalizePlannerOutput, plannerPremiseIssues } from "../lib/divination/planner-validation";
import { planAnalysisTasks } from "../lib/server/analysis-planner-llm";
import { withWorkflowDeadline } from "../lib/server/workflow-budget";
import { recoverPlannerPlan } from "../lib/divination/planner-recovery";
import { p1Scenarios, makeP1Scenario, scenarioProvenance } from "./fixtures/p1-multidomain";
import { compileRetrievalRequests } from "../lib/divination/query-compiler";
import qualityCounterexamples from "./fixtures/p1-v31-quality-counterexamples.json";

const facts=history.input.fact_catalog as FactCatalog;
const question=history.input.question_analysis as SingleQuestionAnalysis;
describe("V3.1.1 fixed-version quality counterexamples",()=>{
  it.each(qualityCounterexamples)("rejects original accepted-but-unsafe run $source_run without editing it",sample=>{
    const issues=inspectAnalysisPlan(JSON.parse(sample.raw_output),facts,question).issues;
    expect(issues.map(i=>i.code)).toContain(sample.expected_issue);
    if(sample.source_run===3)expect(issues.map(i=>i.code)).toContain("PLAN_ROLE_RESELECTION_REQUEST");
  });
});
describe("V3.1 multi-event structural regression (not live frozen questions)",()=>{
  it.each(p1Scenarios)("$id uses the existing Core and fixed role branch",scenario=>{
    const context=makeP1Scenario(scenario),before=JSON.stringify(context.core);
    const input=buildPlannerInput(context.question,context.roles,context.facts,{core:context.core});
    const plan=minimumAnalysisPlan(context.facts,context.question,"synthetic-question-hash","regression",context.core);
    expect(input.analysis_core_view.status).toBe("core_verified");expect(missingCoverage(plan.tasks,context.facts,context.question)).toEqual([]);
    expect(compileRetrievalRequests(plan,context.facts,context.question).queries.length).toBeGreaterThan(0);
    expect(context.roles.primary?.role).toBe(scenario.role);expect(context.facts.chart_hash).toBe(history.chart_hash);
    expect(JSON.stringify(context.core)).toBe(before);expect(scenarioProvenance).toContain("synthetic_event_labels");
  });
});
describe("V3.1 Phase 5 conservative fallback",()=>{
  const core=history.core as LiuyaoCoreFacts;
  it("uses specific transformations, local strength tags, directions and timing context",()=>{
    const plan=minimumAnalysisPlan(facts,question,"qh","test",core),text=plan.tasks.map(t=>t.retrieval_question).join("\n");
    expect(text).toContain("酉金发动变申金");expect(text).toContain("辰土");expect(text).toContain("官鬼酉金");
    expect(text).toContain("局部标签为旺");expect(text).toContain("未来三个月");expect(text).toContain("calendar_context");
    expect(text).not.toContain("极度衰弱");expect(text).not.toContain("已经化退");
    expect(missingCoverage(plan.tasks,facts,question)).toEqual([]);
  });
  it("retains whole valid original tasks, fills mandatory coverage, revalidates globally",()=>{
    const candidate=JSON.parse(history.attempts[0].raw_output),result=recoverPlannerPlan([candidate],facts,question,"qh","historical_failure",core);
    expect(result.recovery_mode).toBe("partial");expect(result.recovered_task_count).toBeGreaterThan(0);
    expect(result.generated_task_count).toBeGreaterThan(0);expect(result.plan.status).toBe("fallback");
    for(const task of result.plan.tasks.filter(t=>!t.task_id.startsWith("fallback_")))expect(task).toEqual(candidate.tasks.find((original:{task_id:string})=>original.task_id===task.task_id));
    expect(result.plan.tasks.length).toBeLessThanOrEqual(7);expect(missingCoverage(result.plan.tasks,facts,question)).toEqual([]);
    expect(()=>validateAnalysisPlan({tasks:result.plan.tasks},facts,question,"qh")).not.toThrow();
    expect(result.plan.tasks.map(t=>t.why_needed).join("\n")).not.toContain("状态极差");
  });
  it("does not delete unsafe words or leave dangling/cyclic dependencies",()=>{
    const base=minimumAnalysisPlan(facts,question,"qh","test",core).tasks;
    const tasks=base.map(t=>({...t,why_needed:"世爻极度虚弱，已无能力获得职位。"}));
    expect(recoverPlannerPlan([{tasks}],facts,question,"qh","test",core).recovery_mode).toBe("full");
    const cycle=structuredClone(base);cycle[0].depends_on=[cycle[1].task_id];cycle[1].depends_on=[cycle[0].task_id];
    const result=recoverPlannerPlan([{tasks:cycle}],facts,question,"qh","test",core);
    expect(()=>validateAnalysisPlan({tasks:result.plan.tasks},facts,question,"qh")).not.toThrow();
    expect(result.plan.tasks.every(t=>t.depends_on.every(id=>result.plan.tasks.some(s=>s.task_id===id)))).toBe(true);
  });
  it("keeps fallback diagnostics private and observable",async()=>{
    const calls:unknown[]=[];
    const complete=vi.fn().mockResolvedValue(history.attempts[0].raw_output);
    const result=await planAnalysisTasks(question,history.input.validated_use_roles as UseRoleAnalysis,facts,"qh",complete,{core},{save:async run=>{calls.push(run);}});
    const final=calls.at(-1) as {fallback_reason:string;original_validation_issues:unknown[];recovered_task_count:number;generated_task_count:number};
    expect(final.fallback_reason).toBeTruthy();expect(final.original_validation_issues.length).toBeGreaterThan(0);
    expect(final.recovered_task_count).toBeGreaterThan(0);expect(final.generated_task_count).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("original_validation_issues");expect(result).not.toHaveProperty("fallback_reason");
  });
});
describe("V3.1 Phase 1 historical baseline",()=>{
  it.each(history.attempts)("preserves original reply and reproduces $original_error",attempt=>{
    expect(createHash("sha256").update(attempt.raw_output).digest("hex")).toBe(attempt.raw_sha256);
    expect(["PLAN_REQUIRED_COVERAGE_MISSING","PLAN_CONDITION_UNSUPPORTED"]).toContain(attempt.original_error);
  });
  it("identifies the exact facts behind both legacy branches",()=>{
    const first=JSON.parse(history.attempts[0].raw_output).tasks;
    const condition=facts.facts.filter(f=>f.subject_ref==="main:3"&&["month_break","day_clash"].includes(f.type)&&f.value===true);
    expect(condition).toHaveLength(2);
    expect(condition.every(f=>first.some((t:{kind:string;fact_refs:string[]})=>t.kind==="role_condition"&&t.fact_refs.includes(f.fact_id)))).toBe(true);
    expect(condition.every(f=>!first.some((t:{kind:string;fact_refs:string[]})=>t.kind==="month_day_effect"&&t.fact_refs.includes(f.fact_id)))).toBe(true);
    const second=JSON.parse(history.attempts[1].raw_output).tasks;
    expect(second[5].kind).toBe("month_day_effect");
    expect(facts.facts.find(f=>f.fact_id===second[5].fact_refs[0])).toMatchObject({subject_ref:"main:5",type:"month_seasonal_label",value:"相"});
  });
});
describe("V3.1 Phase 4 diagnostics and directed repair",()=>{
  const roles=history.input.validated_use_roles as UseRoleAnalysis,core=history.core as LiuyaoCoreFacts;
  const valid=()=>structuredClone(minimumAnalysisPlan(facts,question,"qh","test").tasks);
  it("returns coverage ID, required kind, missing fact refs and priority",()=>{
    const tasks=valid().map(t=>t.kind==="month_day_effect"?{...t,priority:"optional" as const}:t);
    const issues=inspectAnalysisPlan({tasks},facts,question).issues;
    expect(issues.find(i=>i.coverage_id==="C_MONTH_DAY")).toMatchObject({code:"PLAN_REQUIRED_COVERAGE_MISSING",expected:{kind:"month_day_effect",minimum_priority:"high"},suggested_action:"add_coverage"});
    expect(issues.find(i=>i.coverage_id==="C_MONTH_DAY")?.related_fact_refs).toHaveLength(4);
  });
  it.each([
    ["topic_ids",["made_up_topic"],"PLAN_TOPIC_INVALID"],
    ["topic_ids",["month_break"],"PLAN_KIND_TOPIC_MISMATCH"],
    ["fact_refs",["missing"],"PLAN_FACT_REF_INVALID"],
    ["priority","urgent","PLAN_PRIORITY_INVALID"],
    ["depends_on",["missing"],"PLAN_DEPENDENCY_INVALID"],
  ])("reports field-level %s failure %s",(field,value,code)=>{
    const tasks=valid();Object.assign(tasks[0],{[String(field)]:value});
    expect(inspectAnalysisPlan({tasks},facts,question).issues.some(i=>i.code===code&&i.path?.includes(String(field)))).toBe(true);
  });
  it("reports cycles, duplicate IDs, too many tasks, and role output overreach",()=>{
    const tasks=valid();tasks[0].depends_on=[tasks[1].task_id];tasks[1].depends_on=[tasks[0].task_id];
    expect(inspectAnalysisPlan({tasks},facts,question).issues.map(i=>i.code)).toContain("PLAN_DEPENDENCY_CYCLE");
    expect(inspectAnalysisPlan({tasks:[...valid(),valid()[0]]},facts,question).issues.map(i=>i.code)).toContain("PLAN_DUPLICATE_TASK_ID");
    expect(inspectAnalysisPlan({tasks:Array.from({length:8},()=>valid()[0])},facts,question).issues.map(i=>i.code)).toContain("PLAN_MAX_TASKS_EXCEEDED");
    expect(inspectAnalysisPlan({tasks:valid(),use_roles:{primary:"wealth"}},facts,question).issues.map(i=>i.code)).toContain("PLAN_SCHEMA_INVALID");
  });
  it("supports the seasonal-label fact but explains truly unsupported kind facts",()=>{
    const tasks=valid(),index=tasks.findIndex(t=>t.kind==="month_day_effect");
    tasks[index].fact_refs=[facts.facts.find(f=>f.type==="role_binding")!.fact_id];
    const issue=inspectAnalysisPlan({tasks},facts,question).issues.find(i=>i.code==="PLAN_CONDITION_UNSUPPORTED");
    expect(issue?.path).toBe(`tasks[${index}].fact_refs`);expect(issue?.expected).toContain("month_seasonal_label");
    const historical=inspectAnalysisPlan(JSON.parse(history.attempts[1].raw_output),facts,question);
    expect(historical.issues.some(i=>i.code==="PLAN_CONDITION_UNSUPPORTED"&&i.task_id==="T6")).toBe(false);
    expect(historical.issues.some(i=>i.code==="PLAN_UNSUPPORTED_ASSUMPTION"&&i.task_id==="T3"&&i.path?.endsWith("why_needed"))).toBe(true);
  });
  it.each([
    ["官鬼酉金发动变申金，是否符合退神规则，需要核验哪些条件？",true],
    ["官鬼已经化退，因此工作机会将消退。",false],
    ["世爻月破、日冲，同时具有月令五行旺的局部标签，需核验哪些条件？",true],
    ["世爻极度虚弱，已无能力获得职位。",false],
    ["传统理论如何界定‘彻底无用’的适用条件？",true],
    ["不能认定世爻极度虚弱，应研究局部标记的作用条件。",true],
    ["世爻是否极凶，需要查明定义及例外？",true],
    ["这是极凶的特殊状态，必须检索救应。",false],
    ["本卦官鬼生世爻，需要核验哪些条件？",false],
    ["本卦世爻生官鬼，需要核验哪些条件？",true],
    ["用神改取妻财，需要核验哪些条件？",false],
    ["官鬼月破成立，需核验其例外？",false],
    ["是否加剧世爻本身的虚弱？",false],
    ["其旺相程度是否足以抵抗动爻化退或其他不利因素？",false],
    ["若核验判定为化退，是否需要研究缓解化退的条件？",true],
    ["酉金变申金，同五行由旺相支变休囚支，需要核验哪些条件？",false],
    ["是否可将酉金变申金定义为由旺相支变休囚支，需要哪些依据？",true],
    ["需核验这两种负面状态叠加时的理论定义。",false],
    ["日冲是否为负面状态，需要哪些条件？",true],
    ["是否存在需要调整用神选取的例外情况？",false],
    ["不得调整用神选取，仅研究该角色的作用条件。",true],
  ])("annotated professional boundary: %s",(text,valid)=>{
    expect(plannerPremiseIssues(String(text),"retrieval_question","T",facts).length===0).toBe(valid);
  });
  it("normalizes only formatting, retaining IDs and original premises",()=>{
    const raw={tasks:[{task_id:" T1 ",topic_ids:["month_break","month_break"],why_needed:" 世爻极度虚弱 "}]};
    const result=normalizePlannerOutput(raw);
    expect(result.changes).toHaveLength(3);expect(raw.tasks[0].task_id).toBe(" T1 ");
    expect((result.value as typeof raw).tasks[0].why_needed).toBe("世爻极度虚弱");
    expect((result.value as typeof raw).tasks[0].topic_ids).toEqual(["month_break"]);
  });
  it("repairs with actual previous plan and field-level issues, keeping valid IDs",async()=>{
    const original={tasks:valid().map(t=>t.kind==="month_day_effect"?{...t,priority:"optional"}:t)};
    const completion=vi.fn().mockResolvedValueOnce(JSON.stringify(original)).mockResolvedValueOnce(JSON.stringify({tasks:valid()}));
    const save=vi.fn().mockResolvedValue(undefined);
    const result=await planAnalysisTasks(question,roles,facts,"qh",completion,{core},{save});
    expect(result.status).toBe("generated");expect(completion).toHaveBeenCalledTimes(2);
    expect(completion.mock.calls[1][1].repair.previous_plan).toEqual(original);
    expect(completion.mock.calls[1][1].repair.validation_issues.some((i:{coverage_id:string})=>i.coverage_id==="C_MONTH_DAY")).toBe(true);
    expect(result.tasks.map(t=>t.task_id)).toEqual(valid().map(t=>t.task_id));
  });
  it("does not retry a timeout, and reserves downstream time before model calls",async()=>{
    const completion=vi.fn().mockRejectedValue(Object.assign(new Error("timeout"),{name:"TimeoutError"})),save=vi.fn().mockResolvedValue(undefined);
    expect((await planAnalysisTasks(question,roles,facts,"qh",completion,{core},{save})).status).toBe("fallback");expect(completion).toHaveBeenCalledTimes(1);
    const skipped=vi.fn();await withWorkflowDeadline(()=>planAnalysisTasks(question,roles,facts,"qh",skipped,{core},{save}),Date.now()+1000);
    expect(skipped).not.toHaveBeenCalled();
  });
});
describe("V3.1 Phase 2 shared input contract",()=>{
  const roles=history.input.validated_use_roles as UseRoleAnalysis,core=history.core as LiuyaoCoreFacts;
  it("links mandatory coverage to kinds and deduplicates inverse self-primary links",()=>{
    const contracts=coverageContract(facts,question);
    expect(contracts.find(c=>c.coverage_id==="C_MONTH_DAY")).toMatchObject({required_kind:"month_day_effect",minimum_priority:"high",completion:"union_of_matching_tasks"});
    expect(contracts.find(c=>c.coverage_id==="C_RELATION")?.fact_refs).toHaveLength(1);
    expect(contracts.find(c=>c.coverage_id==="C_HIDDEN")).toBeUndefined();
    const plan=minimumAnalysisPlan(facts,question,"qh","test");
    expect(missingCoverage(plan.tasks,facts,question)).toEqual([]);
    const first=JSON.parse(history.attempts[0].raw_output).tasks;
    expect(missingCoverage(first,facts,question).map(c=>c.coverage_id)).toContain("C_MONTH_DAY");
  });
  it("builds a verified Core view and shared calendar without changing the chart",()=>{
    const before=JSON.stringify(core),input=buildPlannerInput(question,roles,facts,{core});
    expect(input.analysis_core_view.primary[0].branch.value).toBe("酉");
    expect(input.analysis_core_view.primary[0].states.month_seasonal_label.value).toBe("相");
    expect(input.analysis_core_view.self[0].states.month_seasonal_label.value).toBe("旺");
    expect(input.calendar_context.fields?.day_ganzhi).toBe("壬戌");
    expect(input.calendar_context.time_constraint?.expression).toBe("未来三个月");
    expect(input.analysis_core_view.key_relations[0]).toMatchObject({source_ref:"main:3",target_ref:"main:5",value:{element_relation:"generates"}});
    expect(input.analysis_core_view.optional_line_context.find(l=>l.line_ref==="hidden:4")).toMatchObject({kin:{value:"offspring"},branch:{value:"午"},element:{value:"火"}});
    expect(JSON.stringify(core)).toBe(before);expect(input.fact_catalog.chart_hash).toBe(history.chart_hash);
  });
  it("rejects explicit hidden-spirit kin and branch contradictions against Core",()=>{
    for(const text of ["伏神妻财在未上，其出伏条件是什么？","hidden:4 六亲为妻财，需要核验哪些条件？"]){
      expect(plannerPremiseIssues(text,"retrieval_question","T",facts,core).map(i=>i.code)).toContain("PLAN_FACT_CLAIM_INVALID");
    }
    expect(plannerPremiseIssues("伏神子孙在午火，其出伏条件是什么？","retrieval_question","T",facts,core)).toEqual([]);
    expect(plannerPremiseIssues("传统理论中如何区分此种情况是构成‘日破’彻底无用，还是在特定条件下仍存生机？","retrieval_question","T",facts,core)).toEqual([]);
  });
  it("marks absent Core explicitly and rejects a mismatched catalog",()=>{
    expect(buildPlannerInput(question,roles,facts).calendar_context.status).toBe("missing");
    const bad=structuredClone(facts);bad.facts[0].value=null;
    expect(()=>buildPlannerInput(question,roles,bad,{core})).toThrow();
  });
  it("allows a real month seasonal label for month_day_effect without claiming overall strength",()=>{
    const plan=minimumAnalysisPlan(facts,question,"qh","test");
    const task=JSON.parse(history.attempts[1].raw_output).tasks[5];
    const neutral={...task,retrieval_question:"官鬼月令标签为相，其定义、适用条件与例外是什么？",why_needed:"程序已记录月令局部标签，需要核验其理论含义。"};
    expect(validateAnalysisPlan({tasks:[...plan.tasks,neutral]},facts,question,"qh").tasks).toHaveLength(plan.tasks.length+1);
  });
});
