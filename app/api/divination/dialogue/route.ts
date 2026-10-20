import type { DialogueState } from "@/lib/contracts/divination";
import { failure, record, success } from "@/lib/contracts/api";
import { callHybrid, HybridServiceError } from "@/lib/server/liuyao-hybrid";
import { dialogueReply, UUID_PATTERN } from "@/lib/server/question-confirmation";

import { traceRoute } from "@/lib/server/case-trace";
export async function POST(request:Request){return traceRoute("dialogue",request,()=>handlePost(request));}
async function handlePost(request:Request){
  const body=record(await request.json().catch(()=>null));
  if(!body||!UUID_PATTERN.test(String(body.conversation_id)))return failure("divination-dialogue-v2","INVALID_REQUEST","会话编号无效。",undefined,422);
  try{
    const state=await callHybrid<DialogueState>("dialogue-load",{conversation_id:body.conversation_id});
    return Response.json(success({...state,reply:dialogueReply(state)},{system:"divination-dialogue-v2",sessionId:state.conversation_id}));
  }catch(error){return failure("divination-dialogue-v2","DIALOGUE_ERROR",error instanceof HybridServiceError?error.message:"无法恢复草稿。",undefined,error instanceof HybridServiceError?error.status:502);}
}
