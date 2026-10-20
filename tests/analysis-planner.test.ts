import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { LiuyaoCoreFacts, QuestionContext } from "../lib/contracts/divination";
import { emptyQuestionContext } from "../lib/divination/core";
import { validateUseRoles } from "../lib/divination/fixed-use-rules";
import { extractAnalysisFacts } from "../lib/divination/analysis-facts";
import { minimumAnalysisPlan, validateAnalysisPlan } from "../lib/divination/analysis-plan";
import { questionSources, validateQuestionAnalysis } from "../lib/divination/question-analysis";
import { analyzeSingleQuestion, planAnalysisTasks, P1_PROMPT } from "../lib/server/analysis-planner-llm";
import { compileRetrievalRequests } from "../lib/divination/query-compiler";

const core=JSON.parse(readFileSync(new URL("../docs/examples/liuyao-245-core.json",import.meta.url),"utf8")) as LiuyaoCoreFacts;
const hash="chart-fixture-a";
export function semanticContext(question:string):QuestionContext{return {...emptyQuestionContext(question),parser_status:"parsed",goal:{value:question,provenance:"user_explicit",verification_status:"extracted"},goal_groups:[question]};}
export function questionOutput(question:string,domain="career",event_type="new_job",question_type="outcome"){
  return {status:"valid",issue_count:1,issues:[],normalized_question:question,domain,event_type,raw_event_description:question,question_type,
    subject_actor_id:null,actors:[],relationships:[],current_state:null,current_state_evidence:null,target_state:null,target_state_evidence:null,time_constraint:null,explicit_context:[]};
}
const question=validateQuestionAnalysis(questionOutput("能找到工作吗"),semanticContext("能找到工作吗"));
const roles=validateUseRoles(JSON.stringify({primary:{role:"officials",rule_id:"career",meaning:"职位",reason:"问新职位"},auxiliary:[{role:"self",rule_id:"career",meaning:"本人",reason:"观察自己"}],missing_information:[],uncertainties:[]}),core,hash);
const facts=extractAnalysisFacts(core,roles,hash);
const plan=minimumAnalysisPlan(facts,question,"question-hash","TEST_FALLBACK");

describe("Q1 单一问事与跨领域契约",()=>{
  it.each([
    ["未来三个月能找到工作吗","career","new_job","outcome"],
    ["已做完终面，能拿到这家公司offer吗","career","interview_result","outcome"],
    ["今年能在现单位升职吗","career","promotion","outcome"],
    ["今年能与前男友复合吗","relationship","reconciliation","outcome"],
    ["今年能与现在伴侣结婚吗","relationship","marriage","outcome"],
    ["我邀请他加入公司，他愿意吗","career","hiring_other","intention"],
    ["借出去的钱能按约定收回吗","finance","debt_repayment","outcome"],
    ["他现在喜欢我吗","relationship","partner_feelings","current_state"],
    ["何时复合","relationship","reconciliation","timing"],
  ])("%s 保持事件与功能，不补造状态",async(raw,domain,event,type)=>{
    const output=questionOutput(raw,domain,event,type);
    const grounded=event==="hiring_other"?{...output,subject_actor_id:"TARGET",actors:[{id:"TARGET",label:"他",role:"target",evidence:{source_id:"question",start:3,end:4,text:"他"}}]}:output;
    const complete=vi.fn().mockResolvedValue(JSON.stringify(grounded));
    const result=await analyzeSingleQuestion(semanticContext(raw),complete);
    expect(result).toMatchObject({status:"valid",issue_count:1,normalized_question:raw,domain,event_type:event,question_type:type,current_state:null});
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("未知分类保留 other 与原问题，不错误强选求职",()=>{
    const raw="宠物比赛是否入选";
    const result=validateQuestionAnalysis(questionOutput(raw,"unregistered","unregistered"),semanticContext(raw));
    expect(result.domain).toBe("other");expect(result.event_type).toBe("other");expect(result.raw_event_description).toBe(raw);
  });
  it("复合和婚期不是一事，模型自报valid也被程序降为冲突",()=>{
    const raw="能复合吗，何时结婚";
    expect(validateQuestionAnalysis({...questionOutput(raw),issue_count:2},semanticContext(raw)).status).toBe("semantic_conflict");
  });
  it("多问的最小输出足以阻止确认，不要求模型填造其他字段",()=>{
    const raw="能复合吗，何时结婚";
    expect(validateQuestionAnalysis({status:"semantic_conflict",issue_count:2,normalized_question:raw},semanticContext(raw)).status).toBe("semantic_conflict");
  });
  it("已有offer或已复合属于背景，不误判成另一个问题",()=>{
    const raw="我已经收到offer，现在能否结婚";
    expect(validateQuestionAnalysis(questionOutput(raw,"relationship","marriage"),semanticContext(raw)).status).toBe("valid");
  });
  it("解析错误只重试一次，仍错返回技术故障",async()=>{
    const complete=vi.fn().mockResolvedValue("not-json");
    const result=await analyzeSingleQuestion(semanticContext("能找到工作吗"),complete);
    expect(result.status).toBe("extraction_failed");expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][2]).toBe("MODEL_JSON_INVALID");
  });
  it("不会用semantic_conflict掩盖格式错误，且拒绝改问和伪造状态",()=>{
    const ctx=semanticContext("我和他能结婚吗");
    expect(()=>validateQuestionAnalysis({...questionOutput(ctx.raw_question),normalized_question:"能复合吗"},ctx)).toThrow("QUESTION_CHANGED");
    expect(()=>validateQuestionAnalysis({...questionOutput(ctx.raw_question),current_state:"正在恋爱",current_state_evidence:{source_id:"question",start:0,end:4,text:"正在恋爱"}},ctx)).toThrow("QUESTION_SOURCE_INVALID");
  });
  it("今年不能变成12个月；引用和人物ID真实且稳定",()=>{
    const ctx=semanticContext("我今年能升职吗");
    const output={...questionOutput(ctx.raw_question,"career","promotion"),actors:[{id:"A1",label:"我",role:"querent",evidence:{source_id:"question",start:0,end:1,text:"我"}}],subject_actor_id:"A1",time_constraint:{kind:"calendar",expression:"今年",evidence:{source_id:"question",start:1,end:3,text:"今年"}}};
    const a=validateQuestionAnalysis(output,ctx),b=validateQuestionAnalysis({...output,actors:[{...output.actors[0],id:"different"}],subject_actor_id:"different"},ctx);
    expect(a.actors[0].id).toBe(b.actors[0].id);expect(a.subject_actor_id).toBe(a.actors[0].id);expect(a.time_constraint?.expression).toBe("今年");
    expect(()=>validateQuestionAnalysis({...output,time_constraint:{...output.time_constraint,kind:"duration"}},ctx)).toThrow("QUESTION_CALENDAR_INVALID");
  });
  it("emoji 引用可以逐字切片，模型推断背景不进入来源目录",()=>{
    const ctx=semanticContext("😀我能找到工作吗");ctx.known_facts=[{value:"我失业",provenance:"model_inference",verification_status:"extracted"}];
    expect(questionSources(ctx)).toEqual([{source_id:"question",text:ctx.raw_question}]);
    const result=validateQuestionAnalysis({...questionOutput(ctx.raw_question),actors:[{id:"A",label:"😀",role:"querent",evidence:{source_id:"question",start:0,end:2,text:"😀"}}]},ctx);
    expect(result.actors[0].evidence.text).toBe("😀");
  });
  it("只规范化唯一真实原文的偏移，不替模型选择重复片段",()=>{
    const ctx=semanticContext("😀能找到工作吗");
    const result=validateQuestionAnalysis({...questionOutput(ctx.raw_question),actors:[{id:"A",label:"😀",role:"querent",evidence:{source_id:"question",start:0,end:1,text:"😀"}}]},ctx);
    expect(result.actors[0].evidence.end).toBe(2);
    const duplicate=semanticContext("他问他能不能入职");
    expect(()=>validateQuestionAnalysis({...questionOutput(duplicate.raw_question),actors:[{id:"A",label:"他",role:"target",evidence:{source_id:"question",start:1,end:2,text:"他"}}]},duplicate)).toThrow("QUESTION_SOURCE_INVALID");
  });
  it("缺失actor偏移仅由唯一原文生成；未经确认的关系丢弃并标记",()=>{
    const raw="今年能与现在伴侣结婚吗",ctx=semanticContext(raw);
    const result=validateQuestionAnalysis({...questionOutput(raw,"relationship","marriage"),actors:[{id:"A",label:"现在伴侣",role:"target"}],relationships:[{relation:"partner",actor_ids:["A"]}]},ctx);
    expect(result.actors[0].evidence).toEqual({source_id:"question",start:4,end:8,text:"现在伴侣"});expect(result.relationships).toEqual([]);
    expect(result.issues).toContain("UNCONFIRMED_RELATION_DISCARDED");
    expect(()=>validateQuestionAnalysis({...questionOutput(raw),actors:[{id:"A",label:"妻子",role:"target"}]},ctx)).toThrow("QUESTION_SOURCE_INVALID");
  });
  it("状态文案使用已定位原文，不能接受模型追加的已发生结论",()=>{
    const ctx=semanticContext("能找到工作吗");
    const result=validateQuestionAnalysis({...questionOutput(ctx.raw_question),target_state:"已经找到工作",target_state_evidence:{source_id:"question",start:1,end:5,text:"找到工作"}},ctx);
    expect(result.target_state).toBe("找到工作");expect(result.current_state).toBeNull();
  });
});

describe("F1 冻结事实与方向",()=>{
  it("事实ID稳定，换chart hash必须换ID，未推断旺衰或进退吉凶",()=>{
    expect(extractAnalysisFacts(core,roles,hash)).toEqual(facts);
    const changed=extractAnalysisFacts(core,{...roles,chart_hash:"chart-b"},"chart-b");
    expect(changed.facts.map(f=>f.fact_id)).not.toEqual(facts.facts.map(f=>f.fact_id));
    const refs=new Set([...core.main_lines,...core.hidden_lines,...core.transformed_lines].map(l=>l.ref));
    expect(facts.facts.every(f=>refs.has(f.subject_ref)&&(!f.object_ref||refs.has(f.object_ref)))).toBe(true);
    expect(facts.facts.some(f=>String(f.type).includes("strength")||String(f.type).includes("retreat"))).toBe(false);
    expect(facts.facts.find(f=>f.type==="transformation")?.value).toMatchObject({from_branch:"酉",to_branch:"申"});
  });
  it("土世生金官，不能反向写成官生世",()=>{
    expect(facts.facts.find(f=>f.type==="line_relationship"&&f.subject_ref==="main:3"&&f.object_ref==="main:5")?.value).toMatchObject({element_relation:"generates"});
    expect(facts.facts.find(f=>f.type==="line_relationship"&&f.subject_ref==="main:5"&&f.object_ref==="main:3")?.value).toMatchObject({element_relation:"generated_by"});
  });
  it("拒绝伪造角色refs、改hash和缺失主角色",()=>{
    const fake={...roles,primary:{...roles.primary!,main_line_refs:["main:99"]}};
    expect(()=>extractAnalysisFacts(core,fake,hash)).toThrow("ANALYSIS_ROLE_REFS_INVALID");
    expect(()=>extractAnalysisFacts(core,roles,"changed")).toThrow("ANALYSIS_ROLES_UNRESOLVED");
    expect(()=>extractAnalysisFacts(core,{...roles,status:"insufficient"},hash)).toThrow("ANALYSIS_ROLES_UNRESOLVED");
  });
  it("缺失条件保留null，不补为false；冻结输入不被修改",()=>{
    const before=JSON.stringify(core),partial=structuredClone(core);
    partial.main_lines[2].strength=undefined as unknown as typeof partial.main_lines[2]["strength"];
    const result=extractAnalysisFacts(partial,roles,hash);
    expect(result.facts.find(f=>f.subject_ref==="main:3"&&f.type==="month_break")?.value).toBeNull();
    expect(JSON.stringify(core)).toBe(before);expect(Object.isFrozen(facts.facts)).toBe(true);
  });
});

describe("P1 初始任务与最小回退",()=>{
  it("使用事件中心规划方法，保留程序取用、理论条件例外及JSON契约",async()=>{
    const complete=vi.fn().mockResolvedValue(JSON.stringify({tasks:plan.tasks}));
    const result=await planAnalysisTasks(question,roles,facts,"question-hash",complete);
    expect(complete.mock.calls[0][0]).toBe(P1_PROMPT);
    for(const phrase of ["不是机械枚举盘面字段","不得重新取用神","旺相休囚死","原神、忌神、仇神","不要对每张卦都检索所有主题","真正的知识依赖","allowed_topics 和 kind_topics","required_coverage","仅返回严格 JSON"])expect(P1_PROMPT).toContain(phrase);
    expect(P1_PROMPT).not.toContain("也可使用其他简短主题标签");
    expect(result.prompt_version).toBe("p1-production-v31.2");
  });
  it.each([{topics:["custom_job_entry"]},{topics:["constructor"]},{topics:[]}])("V3.1 恢复未知或空主题校验：$topics",async({topics})=>{
    const tasks=plan.tasks.map(t=>({...t,topic_ids:topics}));
    const complete=vi.fn().mockResolvedValue(JSON.stringify({tasks}));
    const result=await planAnalysisTasks(question,roles,facts,"question-hash",complete);
    expect(result.status).toBe("fallback");expect(complete).toHaveBeenCalledTimes(2);
    const compiled=compileRetrievalRequests(result,facts,question);
    expect(compiled.queries.length).toBeGreaterThan(0);
    expect(compiled.queries.every(q=>q.query.length>0&&!q.query.includes("custom_job_entry")&&!q.query.includes("constructor"))).toBe(true);
    expect(compiled.warnings).not.toContain("PLAN_TOPICS_OUTSIDE_DICTIONARY_USING_KNOWN_OR_TASK_TERMS");
  });
  it("V3.1 恢复kind及角色主题匹配，不改变程序用神",()=>{
    const tasks=plan.tasks.map(t=>({...t,topic_ids:t.kind==="role_condition"?["wealth"]:["timing"]}));
    expect(()=>validateAnalysisPlan({tasks},facts,question,"qh")).toThrow("PLAN_ROLE_TOPIC_MISMATCH");
    expect(roles.primary?.role).toBe("officials");
  });
  it("主题仍需符合数组结构，不接受对象或非字符串",()=>{
    for(const topic_ids of [null,{},[123]])expect(()=>validateAnalysisPlan({tasks:plan.tasks.map(t=>({...t,topic_ids}))},facts,question,"qh")).toThrow("PLAN_SCHEMA_INVALID");
  });
  it("覆盖主用、动变和空破，任务不超7项且不可变",()=>{
    expect(plan.tasks.length).toBeLessThanOrEqual(7);
    expect(plan.tasks.some(t=>t.kind==="role_condition"&&t.priority==="critical")).toBe(true);
    expect(plan.tasks.some(t=>t.kind==="moving_transformation")).toBe(true);
    expect(plan.tasks.some(t=>t.kind==="month_day_effect")).toBe(true);
    expect(Object.isFrozen(plan.tasks[0].fact_refs)).toBe(true);
  });
  it("模型无效两次后回退，仍仅引用合法冻结事实",async()=>{
    const complete=vi.fn().mockResolvedValue(JSON.stringify({tasks:[{fact_refs:["fake"]}]}));
    const fallback=await planAnalysisTasks(question,roles,facts,"question-hash",complete);
    expect(complete).toHaveBeenCalledTimes(2);expect(fallback.status).toBe("fallback");
    expect(fallback.tasks.every(t=>t.fact_refs.every(id=>facts.facts.some(f=>f.fact_id===id)))).toBe(true);
  });
  it("合法模型计划只调用一次",async()=>{
    const complete=vi.fn().mockResolvedValue(JSON.stringify({tasks:plan.tasks}));
    expect((await planAnalysisTasks(question,roles,facts,"question-hash",complete)).status).toBe("generated");expect(complete).toHaveBeenCalledTimes(1);
  });
  it("拒绝虚构fact、环、漏掉动变和没有问时的timing",()=>{
    const tasks=structuredClone(plan.tasks);
    expect(()=>validateAnalysisPlan({tasks:[{...tasks[0],fact_refs:["fake"]},...tasks.slice(1)]},facts,question,"qh")).toThrow("PLAN_FACT_REF_INVALID");
    const cyclic=structuredClone(tasks);cyclic[0].depends_on=[cyclic[1].task_id];cyclic[1].depends_on=[cyclic[0].task_id];
    expect(()=>validateAnalysisPlan({tasks:cyclic},facts,question,"qh")).toThrow("PLAN_DEPENDENCY_CYCLE");
    expect(()=>validateAnalysisPlan({tasks:tasks.filter(t=>t.kind!=="moving_transformation")},facts,question,"qh")).toThrow("PLAN_REQUIRED_COVERAGE_MISSING");
    expect(()=>validateAnalysisPlan({tasks:[...tasks,{task_id:"TIMING",kind:"timing",fact_refs:[],topic_ids:["timing"],retrieval_question:"何时发生？",why_needed:"想看时间",depends_on:[],priority:"optional"}]},facts,question,"qh")).toThrow("PLAN_TIMING_UNSUPPORTED");
  });
  it("期限是一事内部时间任务，不创建第二goal",()=>{
    const ctx=semanticContext("未来三个月能找到工作吗"),timed=validateQuestionAnalysis({...questionOutput(ctx.raw_question),time_constraint:{kind:"duration",expression:"未来三个月",evidence:{source_id:"question",start:0,end:5,text:"未来三个月"}}},ctx);
    const result=minimumAnalysisPlan(facts,timed,"qh","TEST");
    expect(result.tasks.some(t=>t.kind==="timing")).toBe(true);expect(result).not.toHaveProperty("goals");
  });
});
