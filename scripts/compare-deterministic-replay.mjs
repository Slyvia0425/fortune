// Read-only with respect to frozen cases. Writes only a new comparison artifact.
import assert from "node:assert/strict";
import {readFile,readdir,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
const baseline=resolve(process.argv[2]),replay=resolve(process.argv[3]);
const read=async(dir,name)=>JSON.parse(await readFile(join(dir,name),"utf8"));
const before=(await read(baseline,"interpretation.json")).result;
const summary=await read(replay,"summary.json"),after=(await read(replay,"3-interpret.json")).result;
assert.equal(summary.frozen_unchanged,true);assert.equal(summary.planner_actual_model_calls,0);
assert.equal(after.initial_analysis.initial_plan.generation_mode,"deterministic");
const roleSignature=p=>JSON.stringify([p.use_roles.primary?.role,p.use_roles.primary?.main_line_refs,p.use_roles.primary?.hidden_line_refs,p.use_roles.auxiliary.map(r=>[r.role,r.main_line_refs,r.hidden_line_refs])]);
assert.equal(roleSignature(before.initial_analysis),roleSignature(after.initial_analysis));
const baseNodes=[],traceRoot=resolve(".runtime/case-traces");let baselineTrace;
for(const id of await readdir(traceRoot)){
  const dir=join(traceRoot,id);
  try{
    const manifest=await read(dir,"manifest.json");
    if(manifest.route!=="interpret"||manifest.input?.chart_id!==summary.chart_id)continue;
    const response=await read(dir,"response.json");
    if(response.output?.result?.initial_analysis?.initial_plan?.plan_hash!==before.initial_analysis.initial_plan.plan_hash)continue;
    const nodes=await Promise.all((await readdir(dir)).filter(f=>f.endsWith(".json")).map(f=>read(dir,f)));
    if(!nodes.some(n=>n.node==="analysis-planner"))continue;
    baselineTrace=id;baseNodes.push(...nodes);break;
  }catch{/* Ignore unrelated/incomplete traces. */}
}
assert.ok(baselineTrace,"Original P1 trace not found for this frozen baseline");
const newNodes=(await read(replay,"plan-nodes.json")).records.map(r=>r.value);
const stats=(r,nodes)=>({analysis_status:r.analysis_status,plan_status:r.initial_analysis.initial_plan.status,generation_mode:r.initial_analysis.initial_plan.generation_mode??"llm (archived)",
  p1_elapsed_ms:nodes.find(n=>["analysis-planner","deterministic-analysis-planner"].includes(n.node))?.elapsed_ms,
  p1_model_calls:nodes.filter(n=>n.node==="model-call"&&n.input?.messages?.some(m=>{try{const p=JSON.parse(m.content);return Boolean(p.question_analysis&&p.validated_use_roles&&p.fact_catalog);}catch{return false;}})).length,
  tasks:r.initial_analysis.initial_plan.tasks.map(t=>({task_id:t.task_id,kind:t.kind,fact_count:t.fact_refs.length})),
  first_round_queries:r.compiled_retrieval?.queries?.length,rounds:r.evidence_snapshot?.completed_rounds,evidence_count:r.evidence_snapshot?.evidence.length,evidence_status:r.evidence_snapshot?.status,
  stop_reason:r.analysis_agent?.stop_reason,assessment:r.structured_reasoning?.overall_assessment,unresolved_gaps:r.evidence_snapshot?.unresolved_gaps.map(g=>g.description)});
const report={chart_id:summary.chart_id,chart_hash:summary.chart_hash,question:summary.question,baseline_trace_id:baselineTrace,no_recast:true,frozen_unchanged:true,use_roles_unchanged:true,
  before:{...stats(before,baseNodes),interpret_ms:baseNodes.find(n=>n.node==="route-interpret")?.elapsed_ms},
  after:{...stats(after,newNodes),stages:summary.stages,total_plan_interpret_ms:summary.stages.filter(s=>["plan","interpret"].includes(s.stage)).reduce((sum,s)=>sum+s.elapsed_ms,0)},
  limits:["Single real replay, not success-rate or P95 evidence.","complete denotes technical workflow completion, not an unconditional forecast or expert semantic acceptance."]};
await writeFile(join(replay,"comparison.json"),JSON.stringify(report,null,2),{mode:0o600,flag:"wx"});console.log(JSON.stringify(report,null,2));
