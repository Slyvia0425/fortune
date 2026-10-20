import type { ReasoningContext, StructuredReasoningV1 } from "../../lib/divination/structured-reasoning";
import { findingObservation, requiredUnresolved, reasoningTasks } from "../../lib/divination/structured-reasoning";
import { emptyEvidenceSnapshot, mergeEvidence, quoteHash } from "../../lib/divination/evidence-accumulator";
import type { HybridEvidencePack } from "../../lib/contracts/divination";
import type { InitialPlannerSnapshot } from "../../lib/server/analysis-planner";
import type { RetrievalRequest } from "../../lib/divination/query-compiler";

export function reasoningFixture():ReasoningContext{
  const question="能找到工作吗",identity={knowledge_release_id:"release1",embedding_profile:"profile1"};
  const task={task_id:"T1",kind:"month_day_effect",topic_ids:["month_break"],fact_refs:["F1"],retrieval_question:"月破条件？",depends_on:[],priority:"high",why_needed:"冻结事实"};
  const planner={status:"ready",pipeline_version:"analysis-planner-v4.1-pr3",chart_id:"chart1",chart_hash:"hash1",question_hash:"question1",confirmation_id:"confirmation1",versions:{pipeline:"test"},
    question_analysis:{status:"valid",normalized_question:question},use_roles:{status:"generated",chart_hash:"hash1"},fact_catalog:{chart_hash:"hash1",facts:[{fact_id:"F1",subject_ref:"main:3",type:"month_break",value:true,source:"frozen_core"}]},
    initial_plan:{chart_hash:"hash1",question_hash:"question1",plan_hash:"plan1",tasks:[task]}} as unknown as InitialPlannerSnapshot;
  let snapshot=emptyEvidenceSnapshot("hash1","question1",identity);
  for(const round of [1,2] as const){
    const quote=round===1?"月破一般定义，仍需核对条件。":"月破亦有例外，须核验其他条件。",entity=`unit${round}`;
    const request={request_id:`r${round}`,parent_task_id:"T1",target_type:"theory",topic_ids:["month_break"],semantic_intent:"查条件",keyword_terms:["月破"],fact_refs:["F1"],priority:"high"} as RetrievalRequest;
    const pack={chart_id:"chart1",chart_hash:"hash1",knowledge_release_id:"release1",retrieval_identity:identity,core_version:"test",method_profile_id:"test",retrieval_run_id:`run${round}`,status:"evidence_insufficient",
      reasoning_evidence:[{entity_revision_id:entity,entity_id:entity,kind:"passage",summary:quote,not_for_interpretation:false,condition_evaluation:"unknown",content_type:"theory",conflict_group_ids:[],source_quotes:[{source_revision_id:"source1",start:round===1?0:100,end:(round===1?0:100)+[...quote].length,quote,quote_hash:quoteHash(quote),offset_unit:"unicode_codepoint"}]}],
      retrieval_trace:[{request_id:request.request_id,parent_task_id:"T1",round,keyword_hits:1,vector_hits:0,selected_evidence_ids:[entity]}],gaps:[],pending_conditions:[],supporting_evidence:[],counter_evidence:[],selected_use:[],candidate_roles:[],clarification:[],
      interpretation_contract:{strong_conclusion_allowed:false,recast_allowed:false,copy_case_outcome:false}} as HybridEvidencePack;
    snapshot=mergeEvidence(snapshot,{round,requests:[request],pack});
  }
  snapshot={...snapshot,status:"complete"};
  return {question,identity,planner,agent:{version:"bounded-agent-pr5-v1",snapshot,supplemental_tasks:[],stop_reason:"ROUND_LIMIT",terminal:true,fingerprint:"test"}};
}
export function reasoningDraft(c:ReasoningContext):StructuredReasoningV1{
  return {version:"structured-reasoning-v1",chart_hash:c.planner.chart_hash,question_hash:c.planner.question_hash,
    findings:reasoningTasks(c).map((t,i)=>({finding_id:`finding${i+1}`,task_id:t.task_id,observation:findingObservation(c,t.fact_refs),fact_refs:[...t.fact_refs],evidence_ids:c.agent.snapshot.evidence.filter(e=>e.task_ids.includes(t.parent_task_id)).map(e=>e.evidence_id),
      interpretation:"所见盘面条件需要结合原文限定理解，不能仅凭这一点判断所问结果。",status:"conditional",assumptions_or_conditions:["原文适用条件仍待核验。"],limitations:["不据此预测现实结果或应期。"]})),
    competing_views:[],unresolved_questions:requiredUnresolved(c),overall_assessment:{status:"conditional",conclusion:"目前仅能给出有条件的传统解释，不能据此确定结果。",reasons:["已有定义与例外资料，但适用前提仍需核验。"],limitation_notes:["这是传统理论内的解释，不是未来事实的证明。"]}};
}
