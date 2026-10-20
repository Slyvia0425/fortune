import type { FrozenQuestionRecord } from "@/lib/contracts/divination";
import { failure, record, success } from "@/lib/contracts/api";
import { callHybrid, HybridServiceError } from "@/lib/server/liuyao-hybrid";
import { loadInitialAnalysisPlan } from "@/lib/server/initial-plan-store";
import { UUID_PATTERN } from "@/lib/server/question-confirmation";

// Only validated plans are persisted. Technical failures remain retryable.
import { traceRoute } from "@/lib/server/case-trace";
export async function POST(request:Request){return traceRoute("plan",request,()=>handlePost(request));}
async function handlePost(request:Request){
  const body=record(await request.json().catch(()=>null));
  if(!body||!UUID_PATTERN.test(String(body.chart_id))||Object.keys(body).some(k=>!["chart_id","chart_hash"].includes(k)))return failure("liuyao-plan-pr3","INVALID_REQUEST","规划必须引用服务端冻结卦盘。",undefined,422);
  try{
    const saved=await callHybrid<FrozenQuestionRecord>("frozen",{chart_id:body.chart_id});
    if(body.chart_hash&&body.chart_hash!==saved.cast.chart_hash)return failure("liuyao-plan-pr3","CHART_MISMATCH","卦盘版本不一致。",undefined,409);
    if(saved.confirmation_status!=="confirmed"||!saved.confirmed_question)return failure("liuyao-plan-pr3","CONFIRMATION_REQUIRED","旧记录不能冒充已确认问事进入规划。",undefined,409);
    const result=await loadInitialAnalysisPlan(saved);
    return Response.json(success(result,{system:"liuyao-plan-pr3",warnings:result.status==="ready"?result.initial_plan.warnings:["规划尚未完成，原确认问题与卦盘已保留。"]}));
  }catch(error){return failure("liuyao-plan-pr3","PLANNING_ERROR",error instanceof HybridServiceError?error.message:"分析计划暂未完成，原卦盘已保留。",undefined,error instanceof HybridServiceError?error.status:502);}
}
