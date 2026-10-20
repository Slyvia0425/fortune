import { RecordedInterpretationFailure, stageNames, type InterpretationDiagnostic } from "@/lib/server/interpretation-diagnostics";
import type { FrozenQuestionRecord, HybridEvidencePack, HybridInterpretation } from "@/lib/contracts/divination";
import { failure, record, success, text } from "@/lib/contracts/api";
import { basicExplanation } from "@/lib/divination/basic-explanation";
import { buildDivinationEvidencePack } from "@/lib/divination/evidence";
import { divinationLlmConfigured, interpretDivinationEvidence, determineUseRoles, planRetrievalQueries } from "@/lib/server/divination-llm";
import { callHybrid, HybridServiceError } from "@/lib/server/liuyao-hybrid";
import { cookies } from "next/headers";
import { cachedInterpretation } from "@/lib/server/interpretation-cache";
import { AUTH_COOKIE } from "@/lib/server/module4-auth";
import { DIVINATION_SESSION_COOKIE } from "@/lib/server/liuyao-hybrid";
import { loadInitialAnalysisPlan } from "@/lib/server/initial-plan-store";
import type { InitialPlannerSnapshot } from "@/lib/server/analysis-planner";
import { compileRetrievalRequests, type CompiledRetrievalPlan } from "@/lib/divination/query-compiler";
import { fallbackRetrievalPlan } from "@/lib/divination/retrieval-plan";
import { canonicalAnalysis, analysisHash } from "@/lib/divination/analysis-utils";
import { runEvidenceAgent, accumulatedEvidencePack, AGENT_CONTROLLER_VERSION, type AgentResult } from "@/lib/divination/agent-controller";
import { evidenceAgentStore } from "@/lib/server/evidence-agent-store";
import { analyzeEvidenceGaps, GAP_PROMPT_VERSION } from "@/lib/server/evidence-gap-llm";
import { GAP_QUERY_ALIASES } from "@/lib/divination/query-compiler";
import { boundedWorkflow, withWorkflowDeadline } from "@/lib/server/workflow-budget";
import { runReasoningStage, reasoningStageVersions } from "@/lib/server/reasoning-stage";
import { PR6_WORKFLOW_BUDGET_MS, PR6_TAIL_BUDGET_MS } from "@/lib/server/structured-reasoning-llm";

interface RoundContext { snapshot:InitialPlannerSnapshot; compiled:CompiledRetrievalPlan; identity:Record<string,unknown>; owner:string;fingerprint:string;deadlineAt:number;singleRound:boolean;retryIncomplete:boolean;structured:boolean }

import { traceNode, traceRoute } from "@/lib/server/case-trace";
export async function POST(request: Request) {return traceRoute("interpret",request,()=>handlePost(request));}
async function handlePost(request: Request) {
  const structured=!["v1","pr4","pr5"].includes(process.env.LIUYAO_RETRIEVAL_PIPELINE??"");
  const deadlineAt=Date.now()+(structured?PR6_WORKFLOW_BUDGET_MS:180_000);
  return withWorkflowDeadline(()=>interpretRequest(request,deadlineAt),deadlineAt);
}
async function interpretRequest(request:Request,deadlineAt:number){
  const input = await request.json().catch(() => null);
  const cookieStore = await cookies();
  const owner = cookieStore.get(AUTH_COOKIE)?.value ?? cookieStore.get(DIVINATION_SESSION_COOKIE)?.value;
  if (!owner) return failure("divination-interpret-v2", "SESSION_REQUIRED", "当前会话无法读取原卦盘，请确认使用原起卦会话。", undefined, 401);
  const { retry, ...body } = record(input) ?? {};
  const chartId = text(body?.chart_id, 36);
  if (!body || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chartId)
    || Object.keys(body).some(key => !["chart_id", "chart_hash", "question_context"].includes(key))) {
    return failure("divination-interpret-v2", "VALIDATION_ERROR", "解释必须引用服务端冻结卦盘，不接受客户端盘面或改写问题。", undefined, 422);
  }
  try {
    const saved = await callHybrid<FrozenQuestionRecord>("frozen", { chart_id: chartId });
    if (body.chart_hash && body.chart_hash !== saved.cast.chart_hash) {
      return failure("divination-interpret-v2", "CHART_MISMATCH", "卦盘版本不一致，请重新读取原起卦记录。", undefined, 409);
    }
    if (!saved.confirmed_question || saved.confirmation_status !== "confirmed") {
      return Response.json(success({evidence_pack:buildDivinationEvidencePack({question:saved.question,cast:saved.cast}),modern_interpretation:null,frozen_core:saved.cast.core_facts,confirmation_status:"legacy_unconfirmed"},
        {system:"divination-interpret-v4",warnings:["此卦为旧版未确认记录，可查看原结果；新的分析需重新确认问事。"]}));
    }
    const confirmed=saved.confirmed_question;
    if(saved.cast.confirmation_id!==confirmed.confirmation_id || saved.cast.question_hash!==confirmed.question_hash || saved.question!==confirmed.normalized_question){
      return failure("divination-interpret-v4","CONFIRMATION_MISMATCH","冻结问事与确认记录不一致。",undefined,409);
    }
    return withBasicExplanation(saved, async()=>{
    if(process.env.LIUYAO_RETRIEVAL_PIPELINE==="v1")return cachedInterpretation(owner,{pipeline_version:"confirmed-fixed-use-v4",chart_id:chartId,chart_hash:saved.cast.chart_hash,confirmation_id:confirmed.confirmation_id,question_hash:confirmed.question_hash},retry===true,()=>generate(saved));
    const snapshot=await loadInitialAnalysisPlan(saved);
    if(snapshot.status!=="ready")return Response.json(success({evidence_pack:buildDivinationEvidencePack({question:saved.question,cast:saved.cast}),modern_interpretation:null,frozen_core:saved.cast.core_facts,planner_status:snapshot},
      {system:"divination-interpret-pr4",warnings:["分析计划尚未就绪，未执行检索，原卦盘已保留。"]}));
    const compiled=await traceNode("query-compiler",{plan:snapshot.initial_plan,facts:snapshot.fact_catalog,question:snapshot.question_analysis},()=>compileRetrievalRequests(snapshot.initial_plan,snapshot.fact_catalog,snapshot.question_analysis));
    const identity=await callHybrid<Record<string,unknown>>("source-profile",{chart_id:chartId});
    const singleRound=process.env.LIUYAO_RETRIEVAL_PIPELINE==="pr4";
    const structured=!singleRound&&process.env.LIUYAO_RETRIEVAL_PIPELINE!=="pr5";
    const cacheIdentity={pipeline_version:singleRound?"analysis-planner-v4.1-pr4":structured?"analysis-planner-v4.1-pr6":"analysis-planner-v4.1-pr5",chart_id:chartId,chart_hash:saved.cast.chart_hash,
      confirmation_id:confirmed.confirmation_id,question_hash:confirmed.question_hash,versions:snapshot.versions,
      compilation_hash:compiled.compilation_hash,retrieval_identity:identity,writer_version:"legacy-evidence-writer-pr4-v1",
      ...(singleRound?{}:{agent:AGENT_CONTROLLER_VERSION,gap_prompt:GAP_PROMPT_VERSION,gap_aliases:analysisHash(GAP_QUERY_ALIASES)}),
      ...(structured?{reasoning:reasoningStageVersions(),tail_ms:90_000}:{})};
    return cachedInterpretation(owner,cacheIdentity,retry===true,()=>generate(saved,{snapshot,compiled,identity,owner,fingerprint:analysisHash(cacheIdentity),deadlineAt,singleRound,retryIncomplete:retry===true,structured}));
    });
  } catch(error){
    return failure("divination-interpret-v4","FROZEN_RECORD_ERROR",error instanceof HybridServiceError?error.message:"无法读取已确认卦盘。",undefined,error instanceof HybridServiceError?error.status:502);
  }
}

async function withBasicExplanation(saved:FrozenQuestionRecord, work:()=>Promise<Response>):Promise<Response>{
  let response:Response;
  try { response=await work(); }
  catch(error) {
    if(error instanceof HybridServiceError && error.status<500)throw error;
    response=failure("divination-interpret-v4","ANALYSIS_UNAVAILABLE","完整分析暂不可用，已保留原卦盘。",undefined,502);
  }
  if(!response.ok && response.status<500)return response;
  const payload=await response.json();
  if(payload.result?.modern_interpretation || payload.error?.code==="INTERPRETATION_IDENTITY_ERROR" || payload.result?.reasoning_diagnostic?.stage==="identity")return Response.json(payload,{status:response.status});
  const evidence=buildDivinationEvidencePack({question:saved.question,cast:saved.cast});
  const result=payload.result??{evidence_pack:evidence,modern_interpretation:null,frozen_core:saved.cast.core_facts,analysis_status:"reasoning_failed"};
  return Response.json(success({...result,basic_interpretation:basicExplanation(evidence)},{
    system:payload.system??"divination-interpret-v4",sources:evidence.sources,
    warnings:[...(payload.warnings??[]),...(payload.error?[payload.error.message]:[]),"完整分析尚未完成，当前显示基础文本解释，可沿用原卦盘重试。"],
  }));
}

async function generate(saved:FrozenQuestionRecord,round?:RoundContext){
  try{
    const chartId=saved.cast.chart_id!;
    const questionContext=saved.question_context??undefined;
    const evidencePack = buildDivinationEvidencePack({ question: saved.question, cast: saved.cast });
    const warnings: string[] = [];
    const useRoles=round?.snapshot.use_roles??await determineUseRoles(saved.cast.core_facts,saved.question,saved.cast.chart_hash!,questionContext);
    if(useRoles.status!=="generated"||!saved.cast.core_facts) return Response.json(success({evidence_pack:evidencePack,modern_interpretation:null,frozen_core:saved.cast.core_facts,use_role_analysis:useRoles},{system:"divination-interpret-v2",sources:evidencePack.sources,warnings:[...useRoles.missing_information,...useRoles.uncertainties]}));
    const retrievalPlan=round?fallbackRetrievalPlan(saved.question,saved.cast.core_facts,useRoles,"V1_COMPARISON_ONLY_NOT_EXECUTED"):await planRetrievalQueries(saved.cast.core_facts,saved.question,useRoles);
    warnings.push(...(round?round.compiled.warnings:retrievalPlan.warnings));
    let agent:AgentResult|undefined;
    const retrieve=async(compiled:CompiledRetrievalPlan)=>(await callHybrid<{hybrid_evidence:HybridEvidencePack}>("source-evidence-round",{chart_id:chartId,chart_hash:saved.cast.chart_hash,
      queries:compiled.queries.map(q=>q.query),query_lanes:compiled.queries.map(q=>q.lane),
      query_requests:compiled.queries.map(q=>({request_id:q.request_id,parent_task_id:q.parent_task_id,round:q.round})),retrieval_identity:round!.identity},true)).hybrid_evidence;
    let retrieved:{hybrid_evidence:HybridEvidencePack};
    if(round&&!round.singleRound){
      const store=evidenceAgentStore(round.owner,round.fingerprint);
      agent=await runEvidenceAgent({chart_id:chartId,question_hash:round.snapshot.question_hash,plan:round.snapshot.initial_plan,facts:round.snapshot.fact_catalog,
        question:round.snapshot.question_analysis,identity:round.identity,compiled:round.compiled,fingerprint:round.fingerprint,deadlineAt:round.deadlineAt,retryIncomplete:round.retryIncomplete,minReservedTailMs:round.structured?PR6_TAIL_BUDGET_MS:50_000},
        {now:Date.now,retrieve:compiled=>boundedWorkflow(20_000,()=>retrieve(compiled)),analyze:analyzeEvidenceGaps,...store,save:state=>traceNode("evidence-accumulator-checkpoint",state,()=>store.save(state),()=>({saved:true}))});
      const pack=accumulatedEvidencePack(agent.snapshot);
      if(!pack||agent.snapshot.status==="stale")return Response.json(success({evidence_pack:evidencePack,modern_interpretation:null,frozen_core:saved.cast.core_facts,
        initial_analysis:round.snapshot,compiled_retrieval:round.compiled,evidence_snapshot:agent.snapshot,analysis_agent:agent},
        {system:"divination-interpret-pr5",warnings:["检索尚未完成或知识版本已失效，已保留检查点，未生成无依据的解释。"]}));
      retrieved={hybrid_evidence:pack};
      if(!round.structured)warnings.push(`PR-5 有界检索停止：${agent.stop_reason}；停止不代表证据充分。结构化推理待 PR-6。`);
    }else retrieved=round?{hybrid_evidence:await retrieve(round.compiled)}:await callHybrid<{hybrid_evidence:HybridEvidencePack}>("source-evidence",{chart_id:chartId,chart_hash:saved.cast.chart_hash,
        queries:retrievalPlan.queries.map(q=>q.query),query_lanes:retrievalPlan.queries.map(q=>q.lane),question_context:questionContext});
    if(round&&(retrieved.hybrid_evidence.chart_hash!==saved.cast.chart_hash||retrieved.hybrid_evidence.chart_id!==chartId))throw new Error("RETRIEVAL_CHART_MISMATCH");
    if(round&&canonicalAnalysis(retrieved.hybrid_evidence.retrieval_identity)!==canonicalAnalysis(round.identity))throw new Error("RETRIEVAL_PROFILE_MISMATCH");
    if(round?.structured&&agent){
      const stage=await runReasoningStage(round.owner,{planner:round.snapshot,agent,question:saved.question,identity:round.identity,frozen:saved},async()=>{
        const current=await boundedWorkflow(10_000,()=>callHybrid<Record<string,unknown>>("source-profile",{chart_id:chartId}));
        if(canonicalAnalysis(current)!==canonicalAnalysis(round.identity))throw new Error("REASONING_IDENTITY_CHANGED");
      });
      if(stage.diagnostic)warnings.push(`结构化解读未全部完成（${stage.diagnostic.stage}/${stage.diagnostic.code}），已保留可恢复检查点，未绕过推理校验。`);
      return Response.json(success({evidence_pack:evidencePack,modern_interpretation:stage.modern,structured_reasoning:stage.reasoning,reasoning_text:stage.text,
        analysis_status:stage.status,reasoning_diagnostic:stage.diagnostic,reasoning_checkpoint_key:stage.checkpoint_key,diagnostic_run_id:stage.diagnostic_run_id,
        evidence_snapshot:agent.snapshot,analysis_agent:agent,initial_analysis:round.snapshot,compiled_retrieval:round.compiled,hybrid_evidence:retrieved.hybrid_evidence,
        use_role_analysis:useRoles,frozen_core:saved.cast.core_facts,model_used:process.env.LLM_MODEL},{system:"divination-interpret-pr6",sources:evidencePack.sources,warnings}));
    }
    if(round?.singleRound)warnings.push("PR-4 单轮检索基线：候选资料尚未判定适用性，暂沿用旧解释节点；结构化推理尚未接入。");
    const hybrid:HybridInterpretation={status:"insufficient",readings:[],validation:"not_generated",message:"已使用前置固定规则取用节点。"};
    let interpretationDiagnostic: InterpretationDiagnostic | undefined;
    let classical: Awaited<ReturnType<typeof interpretDivinationEvidence>> | null = null;
    if(agent&&!agent.snapshot.evidence.length)warnings.push("累计证据为空，未调用解释模型；原卦盘与缺口检查点已保留。");
    else if (!divinationLlmConfigured()) warnings.push("综合解释服务未配置。");
    else {
      try { const write=()=>interpretDivinationEvidence(evidencePack, {
        core: saved.cast.core_facts, evidence: retrieved.hybrid_evidence, candidateAnalysis: hybrid,roleAnalysis:useRoles,
      });classical=agent?await boundedWorkflow(40_000,write):await write(); }
      catch (error) {
        if (error instanceof RecordedInterpretationFailure) {
          interpretationDiagnostic = error.diagnostic;
          warnings.push(`${stageNames[error.diagnostic.stage]}未通过（${error.diagnostic.code}）。${error.diagnostic.reasons.map(reason => {try { return JSON.parse(reason).description ?? reason; } catch { return reason; }}).slice(0,3).join("；")} 诊断编号：${error.diagnostic.run_id}`);
        } else {
        const code = error instanceof Error ? error.message : "";
        warnings.push(error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
          ? "综合解释请求超时，已保留原卦盘，可重试。"
          : code === "LLM_INVALID_INTERPRETATION" ? "综合解释未通过格式或引用完整性校验。"
          : "综合解释暂不可用，已保留原卦盘，可重试。");
        }
      }
    }
    return Response.json(success({ evidence_pack: evidencePack, modern_interpretation: classical?.interpretation ?? null,
      interpretation_diagnostic: interpretationDiagnostic, diagnostic_run_id: interpretationDiagnostic?.run_id ?? classical?.diagnostic_run_id,
      model_used: classical?.model, hybrid_evidence: retrieved.hybrid_evidence, use_role_analysis:useRoles,retrieval_plan:round?undefined:retrievalPlan,
      initial_analysis:round?.snapshot,compiled_retrieval:round?.compiled,
      evidence_snapshot:agent?.snapshot,analysis_agent:agent,
      query_comparison:round?{v1:retrievalPlan.queries,v4_1:round.compiled.queries,baseline_kind:"deterministic_v1_fallback",baseline_executed:false}:undefined,
      frozen_core: saved.cast.core_facts }, { system: "divination-interpret-v2", sources: evidencePack.sources, warnings }));
  } catch (error) {
    if(error instanceof Error && ["RETRIEVAL_CHART_MISMATCH","RETRIEVAL_PROFILE_MISMATCH"].includes(error.message))return failure("divination-interpret-v2","INTERPRETATION_IDENTITY_ERROR","解释资料与原卦盘或知识版本不一致，请重试原卦盘。",undefined,502);
    return failure("divination-interpret-v2", "INTERPRETATION_SERVICE_ERROR",
      error instanceof HybridServiceError ? error.message : "解释依据暂不可用，系统未重新起卦。",
      undefined, error instanceof HybridServiceError ? error.status : 502);
  }
}
