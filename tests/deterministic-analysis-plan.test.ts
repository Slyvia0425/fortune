import { describe, expect, it, vi, afterEach } from "vitest";
import history from "./fixtures/p1-v31-history.json";
import multiple from "./fixtures/liuyao-core-multiple-officials.json";
import type { FrozenQuestionRecord, LiuyaoCoreFacts, UseRoleAnalysis } from "../lib/contracts/divination";
import type { SingleQuestionAnalysis } from "../lib/divination/question-analysis";
import { deterministicAnalysisPlan } from "../lib/divination/deterministic-analysis-plan";
import { extractAnalysisFacts } from "../lib/divination/analysis-facts";
import { validateUseRoles } from "../lib/divination/fixed-use-rules";
import { validateAnalysisPlan } from "../lib/divination/analysis-plan";
import { missingCoverage } from "../lib/divination/planner-contract";
import { compileRetrievalRequests } from "../lib/divination/query-compiler";
import { plannerCheckpointKey, plannerMode } from "../lib/server/analysis-planner";
import { makeP1Scenario, p1Scenarios } from "./fixtures/p1-multidomain";

const core=history.core as LiuyaoCoreFacts,roles=history.input.validated_use_roles as UseRoleAnalysis;
const question=history.input.question_analysis as SingleQuestionAnalysis,hash=history.chart_hash;
function build(c=core,r=roles,q=question){const facts=extractAnalysisFacts(c,r,hash);return {facts,plan:deterministicAnalysisPlan(q,r,facts,"qh",c)};}
function movingFixture(positions:number[]){
  const c=structuredClone(core);
  for(const line of c.main_lines){
    const moving=positions.includes(line.position),yang=line.yin_yang==="yang";
    Object.assign(line,{moving,yin_yang_value:moving?(yang?9:6):(yang?7:8),age:moving?"old":"young"});
    delete (line as unknown as Record<string,unknown>).transformation;
    const target=c.transformed_lines.find(t=>t.position===line.position)!;
    const targetYang=moving?!yang:yang;
    Object.assign(target,{moving:false,yin_yang_value:targetYang?7:8,yin_yang:targetYang?"yang":"yin",age:"young"});
  }
  return c;
}
afterEach(()=>vi.unstubAllEnvs());
describe("deterministic P1",()=>{
  it("is stable, immutable, generated (not fallback), and does not mutate Core/roles",()=>{
    const before=JSON.stringify([core,roles,question]),a=build(),b=build();
    expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan));expect(a.plan.plan_hash).toBe(b.plan.plan_hash);
    for(let i=0;i<10;i++)expect(JSON.stringify(build().plan)).toBe(JSON.stringify(a.plan));
    expect(a.plan).toMatchObject({status:"generated",generation_mode:"deterministic",prompt_version:"not-applicable",warnings:[]});
    expect(Object.isFrozen(a.plan.tasks)).toBe(true);expect(JSON.stringify([core,roles,question])).toBe(before);
    expect(a.plan.tasks.length).toBeLessThanOrEqual(7);expect(missingCoverage(a.plan.tasks,a.facts,question)).toEqual([]);
    expect(a.plan.tasks.some(t=>t.kind==="hidden_condition")).toBe(false); // unrelated hidden offspring is not a mandatory task
  });
  it("covers exact job facts and preserves self -> primary direction without predicting retreat",()=>{
    const {plan,facts}=build(),text=plan.tasks.map(t=>t.retrieval_question).join("\n");
    expect(text).toContain("酉金发动变申金");expect(text).toContain("月破成立");expect(text).toContain("未来三个月");
    const relation=plan.tasks.find(t=>t.kind==="line_relationship")!;
    expect(relation.fact_refs.map(id=>facts.facts.find(f=>f.fact_id===id))).toContainEqual(expect.objectContaining({subject_ref:"main:3",object_ref:"main:5",value:expect.objectContaining({element_relation:"generates"})}));
    expect(text).not.toMatch(/已经化退|必然|极度虚弱/);expect(plan.tasks.some(t=>t.kind==="timing")).toBe(true);
    expect(compileRetrievalRequests(plan,facts,question).queries.length).toBeGreaterThan(0);
    expect(()=>validateAnalysisPlan({tasks:plan.tasks.filter(t=>t.kind!=="timing")},facts,question,"qh")).toThrow("PLAN_REQUIRED_COVERAGE_MISSING");
  });
  it("covers known seasonal labels even without true empty/break/clash; unknown stays unknown",()=>{
    const c=structuredClone(core);
    for(const line of c.main_lines)Object.assign(line.strength,{month_break:false,day_clash:false,xun_empty:false});
    const a=build(c);expect(a.plan.tasks.some(t=>t.kind==="month_day_effect")).toBe(true);
    for(const line of c.main_lines)Object.assign(line.strength,{month_break:null,day_clash:null,xun_empty:null,month_seasonal_label:null});
    const b=build(c);expect(b.plan.tasks.some(t=>t.kind==="month_day_effect")).toBe(false);
    expect(b.facts.facts.filter(f=>f.type==="month_seasonal_label"&&f.subject_ref.startsWith("main:")).every(f=>f.value===null)).toBe(true);
  });
  it.each([{positions:[]},{positions:[1,5]}])("handles moving positions $positions without inventing a chosen role",({positions})=>{
    const {plan}=build(movingFixture(positions));
    expect(plan.tasks.some(t=>t.kind==="moving_transformation")).toBe(positions.includes(5));
  });
  it("keeps all program candidates for multiple primary occurrences",()=>{
    const c=multiple as LiuyaoCoreFacts;
    const r=validateUseRoles(JSON.stringify({primary:{role:"officials",rule_id:"career",meaning:"职位",reason:"当前求职"},auxiliary:[{role:"self",rule_id:"career",meaning:"本人",reason:"当前求测人"}],missing_information:[],uncertainties:[]}),c,hash);
    const {plan,facts}=build(c,r);
    expect(r.primary!.main_line_refs.length).toBeGreaterThan(1);
    expect(plan.tasks.find(t=>t.kind==="role_condition")!.fact_refs).toEqual(expect.arrayContaining(facts.facts.filter(f=>f.type==="role_binding"&&(f.value as {priority:string}).priority==="primary").map(f=>f.fact_id)));
  });
  it.each(p1Scenarios)("compatible fixed-role structural scenario $id",scenario=>{
    const s=makeP1Scenario(scenario),plan=deterministicAnalysisPlan(s.question,s.roles,s.facts,"synthetic-qh",s.core);
    expect(missingCoverage(plan.tasks,s.facts,s.question)).toEqual([]);
    expect(plan.tasks.every(t=>t.fact_refs.every(ref=>s.facts.facts.some(f=>f.fact_id===ref)))).toBe(true);
    if(s.roles.primary!.hidden_line_refs.length)expect(plan.tasks.some(t=>t.kind==="hidden_condition")).toBe(true);
  });
  it("rejects forged roles/catalog and unresolved questions",()=>{
    const {facts}=build();
    expect(()=>deterministicAnalysisPlan(question,{...roles,primary:{...roles.primary!,main_line_refs:["main:1"]}},facts,"qh",core)).toThrow();
    expect(()=>deterministicAnalysisPlan(question,roles,{...facts,chart_hash:"foreign"},"qh",core)).toThrow();
    expect(()=>build(core,roles,{...question,status:"unsupported"})).toThrow("PLAN_QUESTION_UNRESOLVED");
  });
  it("defaults to deterministic, isolates keys by mode, rejects typo modes",()=>{
    vi.stubEnv("LIUYAO_PLANNER_MODE",undefined);expect(plannerMode()).toBe("deterministic");
    const saved={cast:{chart_id:"same",chart_hash:hash},confirmed_question:{confirmation_id:"same",question_hash:"same"}} as FrozenQuestionRecord;
    const a=plannerCheckpointKey(saved);vi.stubEnv("LIUYAO_PLANNER_MODE","llm");expect(plannerCheckpointKey(saved)).not.toBe(a);
    vi.stubEnv("LIUYAO_PLANNER_MODE","typo");expect(()=>plannerMode()).toThrow("PLANNER_MODE_INVALID");
  });
});
