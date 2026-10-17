import { analysisHash } from "./analysis-utils";
import { factObservations, reasoningTasks, requiredUnresolved, knownConflictGroups, validateReasoningContext, type ReasoningContext } from "./structured-reasoning";
import { buildPlannerInput } from "./planner-input";

export const REASONING_INPUT_VERSION="reasoning-input-mode-isolated-v5";
export function buildReasoningInput(c:ReasoningContext){
  validateReasoningContext(c);
  const full=c.validation_mode==="integrity";
  const tasks=reasoningTasks(c),refs=new Set(tasks.flatMap(t=>t.fact_refs));
  const facts=c.planner.fact_catalog.facts.filter(f=>full||refs.has(f.fact_id)||f.type==="role_binding"||f.type==="line_relationship");
  const factIds=Object.fromEntries(facts.map((f,i)=>[`F${i+1}`,f.fact_id]));
  const evidenceIds=Object.fromEntries(c.agent.snapshot.evidence.map((e,i)=>[`E${i+1}`,e.evidence_id]));
  const factAlias=Object.fromEntries(Object.entries(factIds).map(([a,id])=>[id,a]));
  const evidenceAlias=Object.fromEntries(Object.entries(evidenceIds).map(([a,id])=>[id,a]));
  const observations=factObservations(c);
  const core=c.frozen?.cast.core_facts;
  const shared=!full&&core?buildPlannerInput(c.planner.question_analysis,c.planner.use_roles,c.planner.fact_catalog,{core}):undefined;
  const confirmedContext=c.frozen?.confirmed_question?.context;
  const background=confirmedContext&&(confirmedContext.known_facts.length||confirmedContext.process_stage||confirmedContext.exclusions.length||confirmedContext.relationships.length||confirmedContext.target_entities.length)
    ?{known_facts:confirmedContext.known_facts,process_stage:confirmedContext.process_stage,exclusions:confirmedContext.exclusions,relationships:confirmedContext.relationships,target_entities:confirmedContext.target_entities}:undefined;
  const role=(r:NonNullable<typeof c.planner.use_roles.primary>)=>({role:r.role,main_line_refs:r.main_line_refs,hidden_line_refs:r.hidden_line_refs,location_status:r.location_status});
  const input={version:REASONING_INPUT_VERSION,
    validation_mode:full?"integrity":"strict",
    confirmed_question:{confirmation_id:c.planner.confirmation_id,question_hash:c.planner.question_hash,normalized_question:c.question,time_constraint:c.planner.question_analysis.time_constraint??null,...(background?{context:background}:{})},
    use_role_decision:{rules_version:c.planner.use_roles.rules_version,primary:c.planner.use_roles.primary?role(c.planner.use_roles.primary):null,auxiliary:(c.planner.use_roles.auxiliary??[]).map(role)},
    chart_hash:c.planner.chart_hash,
    ...(full?{frozen_core:core??null}:{}),
    ...(shared?{analysis_core_view:shared.analysis_core_view,calendar_context:shared.calendar_context}:{}),
    interpretation_boundary:{structural_facts:"程序已核定角色、局部状态、动变及方向，不要求古籍重复证明其存在。",rule_application:full?"规则适用性暂由模型判断；程序未知或尚未派生的综合状态不代表模型必须等待程序核定。只检查数据与引用，不对解释作规则语义验证。":"有效生克、综合旺衰、进退神、出伏、吉凶和应期仍需适用依据；未核定项保留缺口。"},
    fact_catalog:{chart_hash:c.planner.chart_hash,facts:facts.map(f=>({...f,fact_id:factAlias[f.fact_id],...(full?{}:{observation:observations[f.fact_id]})}))},
    allowed_tasks:tasks.map(t=>{
      const parent=c.planner.initial_plan.tasks.find(p=>p.task_id===t.parent_task_id)!;
      const evidence=c.agent.snapshot.evidence.filter(e=>e.task_ids.includes(t.parent_task_id));
      const required=new Set(evidence.filter(e=>["definition","condition","exception"].includes(e.candidate_role)).map(e=>e.evidence_id));
      for(const round of [1,2]){const first=evidence.find(e=>e.rounds.includes(round));if(first)required.add(first.evidence_id);}
      for(const gap of c.agent.snapshot.unresolved_gaps)if(gap.trigger.type==="source_gap"&&gap.trigger.task_id===t.parent_task_id)required.add(gap.trigger.evidence_id);
      for(const group of knownConflictGroups(c))for(const id of group)if(evidence.some(e=>e.evidence_id===id))required.add(id);
      return {...t,definitions_only:full?false:t.definitions_only,kind:parent.kind,topic_ids:parent.topic_ids,fact_refs:t.fact_refs.map(id=>factAlias[id]),required_evidence_ids:full?[]:[...required].map(id=>evidenceAlias[id])};
    }),
    evidence:c.agent.snapshot.evidence.map(e=>({evidence_id:evidenceAlias[e.evidence_id],text:e.text,task_ids:e.task_ids,rounds:e.rounds,kind:e.kind,candidate_role:e.candidate_role,
      provenance:{source_revision_id:e.source_revision_id,quote_hash:e.quote_hash,origins:e.origins,shared_source_group:e.shared_source_group,same_text_group:e.same_text_group}})),
    unresolved_gaps:requiredUnresolved(c),known_conflict_groups:knownConflictGroups(c).map(group=>group.map(id=>evidenceAlias[id])),
    gap_records:(full?[]:c.agent.snapshot.unresolved_gaps).map(g=>({gap_id:g.gap_id,parent_task_id:g.trigger.task_id,description:g.description,
      required_classification:c.planner.initial_plan.tasks.find(t=>t.task_id===g.trigger.task_id)?.kind==="timing"?"time":c.planner.initial_plan.tasks.find(t=>t.task_id===g.trigger.task_id)?.priority==="optional"?"secondary":"core"})),
    knowledge_release:c.agent.snapshot.knowledge_release,
  };
  return {input,factIds,evidenceIds,input_hash:analysisHash(input)};
}
export type BuiltReasoningInput=ReturnType<typeof buildReasoningInput>;
