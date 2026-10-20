import type { ConfirmedQuestionV1, DivinationChatReply } from "@/lib/contracts/divination";
import { failure, record, success } from "@/lib/contracts/api";
import { callHybrid, HybridServiceError } from "@/lib/server/liuyao-hybrid";
import { UUID_PATTERN } from "@/lib/server/question-confirmation";

import { traceRoute } from "@/lib/server/case-trace";
export async function POST(request:Request){return traceRoute("confirm",request,()=>handlePost(request));}
async function handlePost(request:Request){
  const body=record(await request.json().catch(()=>null));
  if(!body||body.confirmed!==true||!UUID_PATTERN.test(String(body.conversation_id))
    ||!Number.isSafeInteger(body.revision)||Number(body.revision)<1||!/^[0-9a-f]{64}$/.test(String(body.question_hash))
    ||Object.keys(body).some(key=>!["conversation_id","revision","question_hash","confirmed"].includes(key))){
    return failure("divination-confirmation-v1","INVALID_CONFIRMATION","请明确确认当前展示的问题版本。",undefined,422);
  }
  try{
    const result=await callHybrid<{confirmed_question:ConfirmedQuestionV1}>("confirm",{conversation_id:body.conversation_id,revision:body.revision,question_hash:body.question_hash},true);
    const reply:DivinationChatReply={status:"confirmed",message:"本次问题已确认，正在起卦。",suggestions:[],conversation_id:String(body.conversation_id),draft_revision:Number(body.revision),confirmed_question:result.confirmed_question};
    return Response.json(success(reply,{system:"divination-confirmation-v1",sessionId:String(body.conversation_id)}));
  }catch(error){return failure("divination-confirmation-v1","CONFIRMATION_ERROR",error instanceof HybridServiceError?error.message:"确认未完成，可重试。",undefined,error instanceof HybridServiceError?error.status:502);}
}
