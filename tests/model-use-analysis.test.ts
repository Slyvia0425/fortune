import { describe,it,expect,vi } from "vitest";
import raw from "./fixtures/liuyao-core-gou.json";
import type { HybridEvidencePack,LiuyaoCoreFacts } from "../lib/contracts/divination";
import { factCatalog, ModelAnalysisValidationError, parseModelUseAnalysis, reasoningEvidence } from "../lib/divination/model-use-analysis";
const core=raw as LiuyaoCoreFacts;
const pack={chart_hash:"hash",method_profile_id:"method",reasoning_mode:"llm_source_reasoning",
  interpretation_contract:{model_reasoning_allowed:true,model_selection_allowed:true,strong_conclusion_allowed:false},
  reasoning_evidence:[{entity_revision_id:"r1",kind:"rule",not_for_interpretation:false,conflict_group_ids:[],source_quotes:[{quote:"原文"}]}]} as unknown as HybridEvidencePack;
const payload=()=>({chart_hash:"hash",method_profile_id:"method",question_understanding:{subject:"父亲",relation:"父子",goal:"平安",missing_information:[]},
  candidates:[{candidate_id:"c1",role:"parents",origin:"main",line_refs:["main:1"],evidence_ids:["r1"],reason:"按原文列为候选",
    conditions:[{condition:"动爻",status:"met",fact_refs:["main:1.moving"],evidence_ids:["r1"]}],missing_conditions:[],exceptions:[]}],
  selection:{candidate_id:"c1" as string|null,line_ref:"main:1" as string|null,evidence_ids:["r1"],reason:"按已列条件建议"},uncertainties:[],readings:[{text:"模型建议，仅作为原文解释",evidence_ids:["r1"]}]});
const parse=(v:unknown,p=pack)=>parseModelUseAnalysis(JSON.stringify(v),p,core,"我问父亲是否平安");
function issue(v:unknown) {
 try {parse(v);throw new Error("应被拒绝");} catch(e) {
   expect(e).toBeInstanceOf(ModelAnalysisValidationError);
   return (e as ModelAnalysisValidationError).issues[0];
 }
}
describe("来源与精确诊断",()=>{
 it("非规则ID返回字段路径",()=>{const v=payload();v.candidates[0].evidence_ids=["case1"];expect(issue(v)).toMatchObject({code:"RULE_CITATION_REQUIRED",path:"$.candidates[0].evidence_ids[0]"});});
 it("空候选爻位有明确诊断",()=>{const v=payload();v.candidates[0].line_refs=[];expect(issue(v).code).toBe("EMPTY_CANDIDATE_LINES");});
 it("仅实际动爻的变爻可以列为变出",()=>{
   const v=payload();const c=v.candidates[0];c.origin="moving_transformation";c.role="offspring";c.line_refs=["transformed:1"];
   c.conditions[0].fact_refs=["transformed:1.kin"];
   expect(parse({...v,selection:{...v.selection,line_ref:"transformed:1"}}).analysis?.candidates[0].origin).toBe("moving_transformation");
 });
 it("变卦静爻不能冒充变出妻财",()=>{
   const v=payload();const c=v.candidates[0];c.origin="moving_transformation";c.role="wealth";c.line_refs=["transformed:2"];
   expect(issue(v).code).toBe("LINE_ORIGIN_ROLE_MISMATCH");
 });
 it("伏神可列候选，未知条件不能选定",()=>{
   const v=payload();const c=v.candidates[0];c.origin="hidden";c.role="wealth";c.line_refs=["hidden:2"];
   c.conditions[0].fact_refs=["hidden:2.usable"];c.conditions[0].status="unknown";v.selection.line_ref="hidden:2";
   expect(issue(v).code).toBe("UNRESOLVED_SELECTION");
   v.selection.candidate_id=null;v.selection.line_ref=null;
   expect(parse(v).analysis?.candidates[0].known_facts).toContainEqual({fact_ref:"hidden:2.usable",value:null});
 });
 it.each(["met","not_met"])("未知值不能断为%s",status=>{
   const v=payload();v.candidates[0].conditions[0].fact_refs=["hidden:2.usable"];v.candidates[0].conditions[0].status=status;
   expect(issue(v).code).toBe("CONDITION_WITHOUT_KNOWN_FACT");
 });
});
describe("原文候选判断",()=>{
 it("问题目录只接纳白名单标量，原问题不可被覆盖",()=>{
   const facts=factCatalog(core,"原问题",{goal:"平安",subject_relation:"父亲",subtopic:null,topic:{value:"出行"},original:"伪造",invented:"假字段"});
   expect(facts["question.original"]).toBe("原问题");expect(facts["question.goal"]).toBe("平安");expect(facts["question.subtopic"]).toBeNull();
   expect(facts).not.toHaveProperty("question.invented");expect(Object.hasOwn(facts,"question.topic")).toBe(false);
 });
 it("条件直接引用问题事实，由程序复制值",()=>{
   const p={...pack,facts:{question:{subject_relation:"父亲"}}};const v=payload();
   v.candidates[0].conditions[0].fact_refs=["question.subject_relation"];
   v.selection.candidate_id=null;v.selection.line_ref=null;
   expect(parse(v,p).analysis?.candidates[0].known_facts).toEqual([{fact_ref:"question.subject_relation",value:"父亲"}]);
 });
 it.each(["core_facts.subject_relation","question_context.subject_relation","question.goal"])("拒绝未登记的问题路径 %s",ref=>{
   const v=payload();v.candidates[0].conditions[0].fact_refs=[ref];expect(()=>parse(v)).toThrow();
 });
 it("目录内字段无需重复声明，null仍保持未知",()=>{
   const v=payload();v.candidates[0].conditions[0].fact_refs=["question.goal"];v.candidates[0].conditions[0].status="unknown";
   v.selection.candidate_id=null;v.selection.line_ref=null;
   expect(parse(v,{...pack,facts:{question:{goal:null}}}).analysis?.candidates[0].known_facts).toEqual([{fact_ref:"question.goal",value:null}]);
 });
 it.each(["root","understanding","candidate","condition","selection","reading"])("拒绝%s的额外输出字段",level=>{
   const v=payload();const target={root:v,understanding:v.question_understanding,candidate:v.candidates[0],condition:v.candidates[0].conditions[0],selection:v.selection,reading:v.readings[0]}[level]!;
   Object.assign(target,{unexpected:"禁止额外字段"});expect(()=>parse(v)).toThrow();
 });
 it("不要求executable或引擎选用，明确标记模型判断",()=>expect(parse(payload()).validation).toBe("references_and_core_facts"));
 it("允许保留并列/未决，不强制选用",()=>{const v=payload();v.selection.candidate_id=null;v.selection.line_ref=null;v.candidates[0].conditions[0].status="unknown";expect(parse(v).analysis?.selection.line_ref).toBeNull();});
 it.each(["main:7","hidden:1","transformed:99"])("拒绝虚构爻位 %s",ref=>{const v=payload();v.candidates[0].line_refs=[ref];expect(()=>parse(v)).toThrow();});
 it("拒绝六亲不符",()=>{const v=payload();v.candidates[0].role="wealth";expect(()=>parse(v)).toThrow();});
 it("拒绝模型自行输出known_facts修改事实",()=>{const v=payload();Object.assign(v.candidates[0],{known_facts:[{fact_ref:"main:1.moving",value:false}]});expect(()=>parse(v)).toThrow();});
 it("拒绝无效引用",()=>{const v=payload();v.selection.evidence_ids=["fake"];expect(()=>parse(v)).toThrow();});
 it("未知条件不得强行选用",()=>{const v=payload();v.candidates[0].conditions[0].status="unknown";expect(()=>parse(v)).toThrow();});
 it("分歧证据不得偷偷选定",()=>{const p=structuredClone(pack);p.reasoning_evidence![0].conflict_group_ids=["conflict"];expect(()=>parse(payload(),p)).toThrow();});
 it("补问前不得选定",()=>{const p=structuredClone(pack);p.interpretation_contract.model_selection_allowed=false;expect(()=>parse(payload(),p)).toThrow();});
 it("拒绝历史不完整盘和错误hash",()=>{const v=payload();v.chart_hash="fake";expect(()=>parse(v)).toThrow();expect(()=>parseModelUseAnalysis(JSON.stringify(payload()),pack,{...core,main_lines_complete:false},"问事")).toThrow();});
 it("不读取review候选绕过用途权限",()=>{const p=structuredClone(pack);p.reasoning_evidence![0].not_for_interpretation=true;expect(()=>parse(payload(),p)).toThrow();});
});

describe("一次受控修正",()=>{
 async function run(answers:Array<string|Error>) {
   vi.stubEnv("LLM_API_KEY","test-key");vi.stubEnv("LLM_MODEL","test-model");vi.resetModules();
   const fetchMock=vi.fn();
   for(const answer of answers) {
     if(answer instanceof Error)fetchMock.mockRejectedValueOnce(answer);
     else fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({choices:[{message:{content:answer}}]})});
   }
   vi.stubGlobal("fetch",fetchMock);
   try {
     const {interpretHybridEvidence}=await import("../lib/server/divination-llm");
     const result=await interpretHybridEvidence(pack,core,"我问父亲是否平安");
     return {result,bodies:fetchMock.mock.calls.map(call=>JSON.parse(call[1].body))};
   } finally {vi.unstubAllEnvs();vi.unstubAllGlobals();vi.resetModules();}
 }
 it("首次失败与修正成功都被保存，输入证据保持不变",async()=>{
   const bad=payload();bad.candidates[0].evidence_ids=["case1"];
   const {result,bodies}=await run([JSON.stringify(bad),JSON.stringify(payload())]);
   expect(result.status).toBe("generated");expect(result.attempts?.map(a=>a.status)).toEqual(["rejected","accepted"]);
   expect(result.attempts?.[0].raw_output).toBe(JSON.stringify(bad));
   expect(bodies).toHaveLength(2);expect(bodies[1].messages.slice(0,2)).toEqual(bodies[0].messages);
   expect(JSON.parse(bodies[1].messages[3].content).validation_errors[0].code).toBe("RULE_CITATION_REQUIRED");
 });
 it("第二次仍错不进行第三次调用，也不发布分析",async()=>{
   const bad=payload();bad.candidates[0].conditions[0].status="unknown";
   const {result,bodies}=await run([JSON.stringify(bad),JSON.stringify(bad)]);
   expect(bodies).toHaveLength(2);expect(result.status).toBe("unavailable");expect(result.analysis).toBeUndefined();
   expect(result.validation_errors?.[0].code).toBe("UNRESOLVED_SELECTION");expect(result.attempts).toHaveLength(2);
 });
 it("修正不得创造新证据",async()=>{
   const bad=payload();bad.candidates[0].evidence_ids=["case1"];
   const corrected=payload();corrected.candidates[0].evidence_ids=["invented-rule"];
   const {result}=await run([JSON.stringify(bad),JSON.stringify(corrected)]);
   expect(result.status).toBe("unavailable");expect(result.validation_errors?.[0].code).toBe("RULE_CITATION_REQUIRED");
 });
 it("非法JSON返回错误后也只修正一次",async()=>{
   const {result}=await run(["not json",JSON.stringify(payload())]);
   expect(result.attempts?.[0].errors[0].code).toBe("INVALID_JSON");expect(result.status).toBe("generated");
 });
 it("网络失败不触发修正重试",async()=>{
   const {result,bodies}=await run([new Error("timeout")]);expect(bodies).toHaveLength(1);expect(result.attempts?.[0].status).toBe("request_error");
 });
 it("修正请求超时仍保留首次拒绝内容",async()=>{
   const {result}=await run(["bad json",new Error("timeout")]);expect(result.attempts?.map(a=>a.status)).toEqual(["rejected","request_error"]);
   expect(result.attempts?.[0].raw_output).toBe("bad json");expect(result.status).toBe("unavailable");
 });
});

describe("案例辅助解释",()=>{
 const withCase=()=>{const p=structuredClone(pack);p.reasoning_evidence!.push({
   entity_revision_id:"case1",entity_id:"case1",kind:"case",usage:"analogy_only",summary:"古例",
   not_for_interpretation:false,condition_evaluation:"unknown",conflict_group_ids:[],
   source_quotes:[{source_revision_id:"source",quote:"古例原文",quote_hash:"hash",start:0,end:4}],
 });return p;};
 it("案例进入模型材料并可在解释段引用",()=>{const p=withCase(),v=payload();v.readings.push({text:"此古例仅供比较，条件仍有差异",evidence_ids:["case1"]});expect(reasoningEvidence(p)).toHaveLength(2);expect(parse(v,p).readings).toHaveLength(2);});
 it.each(["candidate","condition","selection"])("不允许用案例替代%s规则依据",target=>{const p=withCase(),v=payload();if(target==="candidate")v.candidates[0].evidence_ids=["case1"];if(target==="condition")v.candidates[0].conditions[0].evidence_ids=["case1"];if(target==="selection")v.selection.evidence_ids=["case1"];expect(()=>parse(v,p)).toThrow();});
 it("未授权或明确不可比案例不可引用",()=>{for(const mode of ["unauthorized","different"]){const p=withCase(),v=payload();if(mode==="unauthorized")delete p.reasoning_evidence![1].usage;else p.reasoning_evidence![1].condition_evaluation="false";v.readings[0].evidence_ids=["case1"];expect(()=>parse(v,p)).toThrow();}});
 it("只有案例不足以生成取用分析",()=>{const p=withCase();p.reasoning_evidence=p.reasoning_evidence!.filter(u=>u.kind==="case");expect(()=>parse(payload(),p)).toThrow();});
 it("真实模型调用入口将案例和限制传入请求",async()=>{
   vi.stubEnv("LLM_API_KEY","test-key");vi.stubEnv("LLM_MODEL","test-model");vi.resetModules();
   const v=payload();v.readings.push({text:"古例仅供参考",evidence_ids:["case1"]});
   const fetchMock=vi.fn().mockResolvedValue({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(v)}}]})});
   vi.stubGlobal("fetch",fetchMock);
   try {
     const {interpretHybridEvidence}=await import("../lib/server/divination-llm");
     const p=withCase();p.facts={question:{subject_relation:"父亲",goal:"平安"}};
     const result=await interpretHybridEvidence(p,core,"我问父亲是否平安");
     expect(result.status).toBe("generated");
     const body=JSON.parse(fetchMock.mock.calls[0][1].body);
     const input=JSON.parse(body.messages[1].content);
     expect(input.fact_catalog["question.subject_relation"]).toBe("父亲");
     expect(input.fact_catalog["question.goal"]).toBe("平安");
     expect(body.messages[0].content).toContain("不输出 known_facts");
     expect(input.case_evidence[0].usage).toBe("analogy_only");
     expect(body.messages[0].content).toContain("不得使用案例替代规则依据");
     expect(input.allowed_rule_ids).toEqual(["R1"]);expect(input.allowed_case_ids).toEqual(["C1"]);
     expect(input.rule_evidence.every((u:{kind:string})=>u.kind==="rule")).toBe(true);
     expect(result.attempts?.map(a=>a.status)).toEqual(["accepted"]);
   } finally {vi.unstubAllEnvs();vi.unstubAllGlobals();vi.resetModules();}
 });
});
