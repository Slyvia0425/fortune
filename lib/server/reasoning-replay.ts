import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FrozenQuestionRecord } from "../contracts/divination";
import { resolveReviewedUseRoles } from "../divination/deterministic-use-roles";
import { extractAnalysisFacts } from "../divination/analysis-facts";
import { validateAnalysisPlan } from "../divination/analysis-plan";
import { validateQuestionAnalysis } from "../divination/question-analysis";
import { analysisHash } from "../divination/analysis-utils";
import { validateReasoningContext, type ReasoningContext } from "../divination/structured-reasoning";

/** Offline replay only: no cast, confirmation, retrieval, planner or role-model calls.
 * Old artifacts predate PR6.5 fact IDs. Re-derive facts from the SAME saved core,
 * explicitly migrate task references, and never overwrite the original artifacts. */
export async function loadJob245Replay(directory:string):Promise<{context:ReasoningContext;migration:Record<string,unknown>}> {
  const read=async(name:string)=>JSON.parse(await readFile(join(directory,name),"utf8"));
  const [interpretation,confirmation,cast,dialogue]=await Promise.all([read("interpretation.json"),read("confirmation.json"),read("cast.json"),read("dialogue.json")]);
  const result=interpretation.result,original=result.initial_analysis as ReasoningContext["planner"];
  const confirmed=confirmation.result.confirmed_question as NonNullable<FrozenQuestionRecord["confirmed_question"]>;
  const frozen:FrozenQuestionRecord={cast:cast.result,question:confirmed.normalized_question,confirmed_question:confirmed,confirmation_status:"confirmed",question_context:dialogue.result.confirmation_preview.question_context};
  if(frozen.question!=="我未来三个月能不能找到工作"||JSON.stringify(confirmed.numbers)!=="[2,4,5]"||frozen.cast.chart_hash!==original.chart_hash||frozen.cast.chart_id!==original.chart_id
    ||confirmed.question_hash!==original.question_hash||!frozen.cast.core_facts||!frozen.question_context)throw new Error("REPLAY_FROZEN_IDENTITY_INVALID");
  let question=original.question_analysis;
  // Recover only the explicitly present 我 (UTF-16 offset 0..1), not an inferred actor.
  if(question.subject_actor_id===null&&question.actors.length===0&&frozen.question.startsWith("我"))question=validateQuestionAnalysis({...question,subject_actor_id:"replay_querent",actors:[{id:"replay_querent",label:"我",role:"querent",evidence:{source_id:"question",start:0,end:1,text:"我"}}]},frozen.question_context);
  const decision=resolveReviewedUseRoles(frozen.cast.core_facts,original.chart_hash,question);
  if(decision.status!=="resolved"||!decision.analysis)throw new Error("REPLAY_PROGRAM_USE_ROLE_UNRESOLVED");
  const facts=extractAnalysisFacts(frozen.cast.core_facts,decision.analysis,original.chart_hash);
  const idMap=Object.fromEntries(original.fact_catalog.facts.map(f=>{
    const match=facts.facts.filter(n=>n.type===f.type&&n.subject_ref===f.subject_ref&&n.object_ref===f.object_ref);
    if(match.length!==1)throw new Error("REPLAY_FACT_MIGRATION_AMBIGUOUS");return [f.fact_id,match[0].fact_id];
  }));
  const remap=(refs:string[])=>refs.map(id=>{if(!idMap[id])throw new Error("REPLAY_FACT_MIGRATION_MISSING");return idMap[id];});
  const tasks=original.initial_plan.tasks.map(t=>({...t,fact_refs:remap(t.fact_refs),...(t.kind==="line_relationship"?{retrieval_question:"程序标记的有向关系有哪些理论适用条件？",why_needed:"冻结程序目录已提供有向关系，不由Planner重新判断方向。"}:{})}));
  const plan=validateAnalysisPlan({tasks},facts,question,original.question_hash,original.initial_plan.status,original.initial_plan.warnings);
  const planner={...original,question_analysis:question,use_roles:decision.analysis,fact_catalog:facts,initial_plan:plan};
  const agent=structuredClone(result.analysis_agent) as ReasoningContext["agent"];
  agent.supplemental_tasks=agent.supplemental_tasks.map(t=>({...t,fact_refs:remap(t.fact_refs)}));
  const context:ReasoningContext={frozen,question:frozen.question,planner,agent,identity:agent.snapshot.retrieval_identity};
  validateReasoningContext(context);
  return {context,migration:{chart_id:original.chart_id,chart_hash:original.chart_hash,source_core_hash:analysisHash(frozen.cast.core_facts),source_snapshot_hash:analysisHash(agent.snapshot),
    source_derivation:original.fact_catalog.facts.find(f=>f.derivation_version)?.derivation_version,current_derivation:facts.facts.find(f=>f.derivation_version)?.derivation_version,
    task_count:tasks.length,reference_migration:idMap,explicit_querent_recovered:question!==original.question_analysis,relationship_task_text:"canonicalized from program facts; original files untouched"}};
}
