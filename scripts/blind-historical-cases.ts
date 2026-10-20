// Offline retrieval + real PR6 test. This file contains NO reference answers or images.
import {loadEnvFile} from "node:process";
import {spawnSync} from "node:child_process";
import {mkdir,writeFile,readFile,readdir} from "node:fs/promises";
import {resolve,join} from "node:path";
import assert from "node:assert/strict";
import type {LiuyaoCoreFacts,FrozenQuestionRecord,HybridEvidencePack} from "../lib/contracts/divination";
import type {SingleQuestionAnalysis} from "../lib/divination/question-analysis";
import type {ReasoningContext} from "../lib/divination/structured-reasoning";
loadEnvFile(".env.local");
process.env.LIUYAO_REASONING_MODE="full";
const {analysisHash}=await import("../lib/divination/analysis-utils");
const {validateUseRoles}=await import("../lib/divination/fixed-use-rules");
const {extractAnalysisFacts}=await import("../lib/divination/analysis-facts");
const {validateAnalysisPlan}=await import("../lib/divination/analysis-plan");
const {validateQuestionAnalysis}=await import("../lib/divination/question-analysis");
const {compileRetrievalRequests,initialRetrievalRequests}=await import("../lib/divination/query-compiler");
const {emptyEvidenceSnapshot,mergeEvidence}=await import("../lib/divination/evidence-accumulator");
const {buildReasoningInput}=await import("../lib/divination/reasoning-input");
const {runReasoningStage}=await import("../lib/server/reasoning-stage");
const {plannerVersions}=await import("../lib/server/analysis-planner");
const {validateReasoningContext}=await import("../lib/divination/structured-reasoning");
const {traceRoute,traceNode}=await import("../lib/server/case-trace");
const {hasExplicitMultipleIssues}=await import("../lib/divination/chat-gate");
const root=resolve(`.runtime/evals/historical-blind-${Date.now()}`);
await mkdir(root,{recursive:true,mode:0o700});
const save=(dir:string,name:string,value:unknown)=>writeFile(join(dir,name),typeof value==="string"?value:JSON.stringify(value,null,2),{mode:0o600,flag:"wx"});
const python=(file:string,payload:unknown,cwd=process.cwd())=>{
  const r=spawnSync(resolve("fortune_module4/.venv/bin/python"),[resolve(file)],{cwd,input:JSON.stringify(payload),encoding:"utf8",maxBuffer:20_000_000,env:{...process.env,PYTHONPATH:resolve("fortune_module4")}});
  if(r.status!==0)throw new Error(r.stderr||"PYTHON_FIXTURE_FAILED");return JSON.parse(r.stdout);
};
const cases=[
  {id:42,gender:"男性",question:"聘用这个人好吗？对方是否愿意？哪天宣布比较好？",month:"乙未",day:"己酉",bits:"111011",changed_bits:"111001",primary:"风天小畜",transformed:"山天大畜",domain:"career",event_type:"hiring_other",rule:"response",role:"response",meaning:"拟聘用的对方",question_type:"decision",time:"哪天"},
  {id:43,gender:"男性",question:"8月X日开庭的官司能赢吗？",month:"乙未",day:"庚戌",bits:"011110",changed_bits:"010001",primary:"泽风大过",transformed:"山水蒙",domain:"legal",event_type:"litigation",rule:"litigation",role:"officials",meaning:"官府诉讼",question_type:"outcome",time:"8月X日"},
] as const;
console.log(JSON.stringify({event:"blind_start",root}));
for(const sample of cases.filter(c=>!process.argv[2]||String(c.id)===process.argv[2])){
  const dir=join(root,`case-${sample.id}`);await mkdir(dir,{mode:0o700});const started=Date.now();
  await save(dir,"00-input.json",sample);
  try{
    const core=python("scripts/historical-blind-core.py",sample) as LiuyaoCoreFacts;
    const chart_hash=analysisHash({core,primary:sample.primary,transformed:sample.transformed}),question_hash=analysisHash(sample.question),chart_id=`offline-blind-${sample.id}-${chart_hash.slice(0,12)}`;
    await save(dir,"01-core.json",core);
    const q={version:"single-question-analysis-v4",taxonomy_version:"single-question-taxonomy-v1",prompt_version:"q1-precheck-v1",status:"valid",issue_count:1,issues:[],normalized_question:sample.question,domain:sample.domain,event_type:sample.event_type,raw_event_description:sample.question,question_type:sample.question_type,
      subject_actor_id:null,actors:[],relationships:[],current_state:null,current_state_evidence:null,target_state:null,target_state_evidence:null,explicit_context:[],
      time_constraint:{kind:"point",expression:sample.time,evidence:{source_id:"question",start:sample.question.indexOf(sample.time),end:sample.question.indexOf(sample.time)+sample.time.length,text:sample.time}}} as SingleQuestionAnalysis;
    // Fixture contract only: this does NOT represent passing Q1 multi-question validation.
    const rawContext={raw_question:sample.question,goal_groups:[],ambiguities:[],known_facts:[],target_entities:[],relationships:[]} as unknown as NonNullable<FrozenQuestionRecord["question_context"]>;
    let frontStatus:string;try{frontStatus=validateQuestionAnalysis(q,rawContext).status;}catch(error){frontStatus=error instanceof Error?error.message:String(error);}
    await save(dir,"02-support-boundary.json",{test_kind:"offline_retrieval_explainer_directed_blind_test",production_q1_status:frontStatus,multiple_issue_precheck:hasExplicitMultipleIssues(sample.question),q1_fixture_not_production_acceptance:true,
      roles_source:"existing fixed registry branch selected as explicit offline fixture, not a new mapping or an R1 model acceptance test",historical_calendar:"month/day explicit; no year/hour/Gregorian date assumed",gender:sample.gender});
    const entry={role:sample.role,rule_id:sample.rule,meaning:sample.meaning,reason:"离线测试按原问事对应已有固定分支；仅绑定角色，不输入参考断法。"};
    const aux=[{role:"self",rule_id:sample.rule,meaning:"问事方",reason:"原问事的本人，以程序世爻定位。"},...(sample.id===43?[{role:"response",rule_id:sample.rule,meaning:"彼方",reason:"已有诉讼分支的世应辅助角色。"}]:[])];
    const roles=validateUseRoles(JSON.stringify({primary:entry,auxiliary:aux,missing_information:[],uncertainties:[]}),core,chart_hash),facts=extractAnalysisFacts(core,roles,chart_hash);
    const bindings=facts.facts.filter(f=>f.type==="role_binding").map(f=>f.fact_id);
    const of=(types:string[])=>facts.facts.filter(f=>types.includes(f.type)).map(f=>f.fact_id);
    const tasks=[
      {task_id:"T1",kind:"role_condition",topic_ids:["use_role","self_response",...(sample.id===43?["officials"]:[])],fact_refs:bindings,retrieval_question:"当前占事的既定主辅角色需要核验哪些条件和局限？",why_needed:"角色状态理论",priority:"critical"},
      {task_id:"T2",kind:"month_day_effect",topic_ids:["day_month","month_break","xun_empty","day_clash"],fact_refs:of(["month_break","day_clash","xun_empty","month_seasonal_label"]),retrieval_question:"程序列出的日月状态和旬空如何作用，成立条件及例外是什么？",why_needed:"日月状态理论",priority:"critical"},
      {task_id:"T3",kind:"moving_transformation",topic_ids:["moving_line","transformation"],fact_refs:of(["transformation"]),retrieval_question:"实际动变的作用及回头生克有哪些条件与例外？",why_needed:"实际动爻理论",priority:"high"},
      {task_id:"T4",kind:"line_relationship",topic_ids:["self_response","generation_restriction"],fact_refs:of(["line_relationship"]),retrieval_question:"程序已知的世应及动爻有向生克关系形成实际作用，需要哪些前提？",why_needed:"结构作用理论",priority:"high"},
      ...(core.hidden_lines.length?[{task_id:"T5",kind:"hidden_condition",topic_ids:["hidden_spirit"],fact_refs:of(["hidden_location"]),retrieval_question:"盘中现存伏神的飞伏关系和出伏可用需要哪些条件？",why_needed:"现存伏神的可用性理论，不预设核心",priority:"optional"}]:[]),
      {task_id:"T6",kind:"timing",topic_ids:["timing"],fact_refs:[],retrieval_question:"原问中的时间条件在年月时不全时能判断到什么程度，择日及应期规则有哪些前提？",why_needed:"保留原问时间与未知信息",priority:"high"},
    ].map(t=>({...t,depends_on:[]}));
    const plan=validateAnalysisPlan({tasks},facts,q,question_hash,"generated",[],core);
    const compiled=compileRetrievalRequests(plan,facts,q);
    const deferred=initialRetrievalRequests(plan).filter(r=>!compiled.queries.some(x=>x.parent_task_id===r.parent_task_id));
    const supplement=[...deferred,...initialRetrievalRequests(plan).filter(r=>["T2","T3"].includes(r.parent_task_id))].slice(0,3).map((r,i)=>({...r,request_id:`r2_${i+1}`}));
    const second=compileRetrievalRequests(plan,facts,q,supplement,2);
    await save(dir,"03-planner-fixture.json",{question_analysis:q,use_roles:roles,fact_catalog:facts,initial_plan:plan});
    await save(dir,"04-retrieval-input.json",{round1:compiled,round2:second});
    const retrieved=python("fortune_module4/scripts/retrieve_pr5_fixture.py",{chart_id,chart_hash,core,rounds:[compiled.queries,second.queries]},resolve("fortune_module4"));
    await save(dir,"05-retrieval-raw.json",retrieved);
    // Conservative contamination firewall: no case lane, exclude modern case
    // cues and exact sample-hexagram mentions BEFORE any model call.
    const pattern=/小[畜蓄]|大[畜蓄過过]|山水蒙|聘[用任]|二[审審]|原判|新[证證][据據]|8月14|八月十四|例\s*(42|43)/;
    const contamination:Array<unknown>=[];
    const packs:HybridEvidencePack[]=retrieved.packs.map((raw:HybridEvidencePack,round:number)=>{
      const pack=structuredClone(raw),excluded=new Set<string>();
      pack.reasoning_evidence=(pack.reasoning_evidence??[]).filter(e=>{const text=[e.summary,...e.source_quotes.map(q=>q.quote)].join("\n"),bad=e.kind==="case"||pattern.test(text);if(bad){excluded.add(e.entity_revision_id);contamination.push({round:round+1,id:e.entity_revision_id,kind:e.kind,reason:e.kind==="case"?"case_kind_excluded":"conservative_sample_or_background_cue",text});}return !bad;});
      pack.retrieval_trace=(pack.retrieval_trace??[]).map(t=>({...t,selected_evidence_ids:(t.selected_evidence_ids as string[]).filter(id=>!excluded.has(id))}));
      return pack;
    });
    await save(dir,"06-contamination-audit.json",{case_lane_requested:false,excluded:contamination,scope:"all selected evidence checked; no reference answers loaded; conservative exclusions do not prove pretraining blindness",pattern:pattern.source,clean_counts:packs.map(p=>p.reasoning_evidence?.length??0)});
    let snapshot=emptyEvidenceSnapshot(chart_hash,question_hash,retrieved.identity);
    for(const [i,pack] of packs.entries())snapshot=mergeEvidence(snapshot,{round:(i+1) as 1|2,requests:(i?second:compiled).requests.filter(r=>(i?second:compiled).queries.some(q=>q.request_id===r.request_id)),pack});
    const planner:ReasoningContext["planner"]={status:"ready",pipeline_version:"analysis-planner-deterministic-v1",chart_id,chart_hash,question_hash,confirmation_id:`offline-${sample.id}`,versions:plannerVersions(),question_analysis:q,use_roles:roles,fact_catalog:facts,initial_plan:plan};
    const frozen={question:sample.question,confirmation_status:"confirmed",cast:{chart_id,chart_hash,core_facts:core},confirmed_question:{confirmation_id:planner.confirmation_id,question_hash,normalized_question:sample.question,state:"confirmed",context:{known_facts:[{value:sample.gender,provenance:"user_explicit",verification_status:"confirmed"}],target_entities:[],relationships:[],exclusions:[],process_stage:null}}} as unknown as FrozenQuestionRecord;
    const context:ReasoningContext={question:sample.question,planner,identity:retrieved.identity,validation_mode:"integrity",frozen,agent:{version:"bounded-agent-pr5-v1",snapshot,supplemental_tasks:[],terminal:true,stop_reason:"ROUND_LIMIT",fingerprint:analysisHash(snapshot)}};
    validateReasoningContext(context);await save(dir,"07-context.json",context);
    const built=buildReasoningInput(context);await save(dir,"08-reasoning-input.json",built.input);
    const before=analysisHash(context);
    const response=await traceRoute(`offline-blind-${sample.id}`,new Request("http://local/offline-blind",{method:"POST",body:JSON.stringify({chart_id,question:sample.question})}),async()=>{
      const result=await traceNode("offline-real-reasoning",built.input,()=>runReasoningStage("offline-historical-blind",context,async()=>validateReasoningContext(context),{store:{load:async()=>null,save:async()=>{}}}));
      return Response.json(result);
    },join(root,"traces"));
    const result=await response.json();assert.equal(analysisHash(context),before);
    await save(dir,"09-result.json",result);
    if(result.modern)await save(dir,"10-complete-output.txt",result.modern.overall_interpretation+"\n\n"+result.modern.disclaimer);
    const trace_id=response.headers.get("X-Divination-Trace-Id"),traceDir=join(root,"traces",trace_id!);
    const records=await Promise.all((await readdir(traceDir)).filter(f=>f.endsWith(".json")).sort().map(async file=>({file,value:JSON.parse(await readFile(join(traceDir,file),"utf8"))})));
    await save(dir,"11-all-nodes.json",records);
    const calls=records.filter(r=>r.value.node==="model-call").map(r=>({elapsed_ms:r.value.elapsed_ms,status:r.value.status,model:r.value.output?.model,usage:r.value.output?.usage}));
    const summary={id:sample.id,status:result.status,validation_mode:"integrity",generation_mode:result.reasoning?.explainer?.generation_mode,elapsed_ms:Date.now()-started,calls,trace_id,unreviewed_task_ids:result.reasoning?.unreviewed_task_ids,diagnostic:result.diagnostic,source_exclusions:contamination.length,evidence_count:snapshot.evidence.length,official_db_writes:0,reference_answers_loaded:false,context_unchanged:true};
    await save(dir,"summary.json",summary);console.log(JSON.stringify({event:"case_complete",directory:dir,...summary}));
  }catch(error){await save(dir,"error.json",{message:error instanceof Error?error.message:String(error)});console.log(JSON.stringify({event:"case_failed",id:sample.id,error:String(error)}));process.exitCode=1;}
}
console.log(JSON.stringify({event:"blind_end",root}));
