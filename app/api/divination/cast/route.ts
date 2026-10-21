import type { DivinationCastResult } from "@/lib/contracts/divination";
import { enrichDivinationReading } from "@/lib/divination/reading";
import { failure, record, success } from "@/lib/contracts/api";
import { callHybrid, HybridServiceError } from "@/lib/server/liuyao-hybrid";
import { UUID_PATTERN } from "@/lib/server/question-confirmation";

import { traceRoute } from "@/lib/server/case-trace";
export async function POST(request: Request) {return traceRoute("cast",request,()=>handlePost(request));}
async function handlePost(request: Request) {
  const body=record(await request.json().catch(()=>null));
  if(!body||!UUID_PATTERN.test(String(body.confirmation_id))||!UUID_PATTERN.test(String(body.request_id))
    ||Object.keys(body).some(key=>!["confirmation_id","request_id"].includes(key))){
    return failure("divination-cast-v4","CONFIRMATION_REQUIRED","请通过对话确认问题后起卦。",undefined,422);
  }
  try{
    const data=await callHybrid<DivinationCastResult>("cast",{confirmation_id:body.confirmation_id,request_id:body.request_id});
    const enriched=data.primary&&data.mutual&&data.transformed?enrichDivinationReading(data):data;return Response.json(success(enriched,{system:"divination-cast-v4",sessionId:data.core_receipt?.request_id}));
  }catch(error){return failure("divination-cast-v4","CAST_SERVICE_ERROR",error instanceof HybridServiceError?error.message:"起卦未完成，请使用原确认记录重试。",undefined,error instanceof HybridServiceError?error.status:502);}
}
