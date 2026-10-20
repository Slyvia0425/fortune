import type { FrozenQuestionRecord } from "@/lib/contracts/divination";
import { failure, record, success } from "@/lib/contracts/api";
import { callHybrid, HybridServiceError } from "@/lib/server/liuyao-hybrid";
import { UUID_PATTERN } from "@/lib/server/question-confirmation";

export async function POST(request:Request){
  const body=record(await request.json().catch(()=>null));
  if(!body||!UUID_PATTERN.test(String(body.chart_id)))return failure("divination-frozen-v4","INVALID_REQUEST","卦盘编号无效。",undefined,422);
  try{return Response.json(success(await callHybrid<FrozenQuestionRecord>("frozen",{chart_id:body.chart_id}),{system:"divination-frozen-v4"}));}
  catch(error){return failure("divination-frozen-v4","FROZEN_ERROR",error instanceof HybridServiceError?error.message:"无法恢复原卦盘。",undefined,error instanceof HybridServiceError?error.status:502);}
}
