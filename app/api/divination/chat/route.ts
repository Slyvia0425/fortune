import type { DialogueState, DivinationChatMessage } from "@/lib/contracts/divination";
import { failure, record, success } from "@/lib/contracts/api";
import { continueDivinationChatWithLlm, singleIssueClarification } from "@/lib/divination/chat";
import { analyzeSingleQuestion } from "@/lib/server/analysis-planner-llm";
import { callHybrid, HybridServiceError } from "@/lib/server/liuyao-hybrid";
import { dialogueReply, UUID_PATTERN } from "@/lib/server/question-confirmation";

import { traceRoute } from "@/lib/server/case-trace";
export async function POST(request: Request) { return traceRoute("chat",request,()=>handlePost(request)); }
async function handlePost(request: Request) {
  let checkpoint:DialogueState|undefined;
  const body = record(await request.json().catch(()=>null));
  const last = Array.isArray(body?.messages) ? record(body.messages.at(-1)) : null;
  if (!body || !last || last.role !== "user" || typeof last.content !== "string" || !last.content.trim() || last.content.length > 500
    || (body.conversation_id !== undefined && !UUID_PATTERN.test(String(body.conversation_id)))
    || (body.message_id !== undefined && !UUID_PATTERN.test(String(body.message_id)))) {
    return failure("divination-chat-v2", "INVALID_REQUEST", "请提供一条不超过500字的用户消息和有效会话编号。", undefined, 422);
  }
  const timezone = typeof body.timezone === "string" ? body.timezone : "Asia/Hong_Kong";
  try { new Intl.DateTimeFormat("en", {timeZone:timezone}); } catch { return failure("divination-chat-v2","INVALID_TIMEZONE","请提供有效时区。",undefined,422); }
  try {
    const initial = await callHybrid<DialogueState>("dialogue-load", { conversation_id:body.conversation_id });
    checkpoint=initial;
    const messageId = String(body.message_id ?? crypto.randomUUID());
    const duplicate = initial.messages.find(m=>m.message_id===messageId);
    if (duplicate) {
      if(duplicate.content!==last.content.trim())return failure("divination-chat-v2","MESSAGE_CONFLICT","消息编号与内容不一致。",undefined,409);
      if(initial.messages.filter(m=>m.role==="user").at(-1)?.message_id!==messageId)return failure("divination-chat-v2","STALE_MESSAGE","此消息属于旧版本，请读取当前草稿。",undefined,409);
      if(initial.reply&&initial.reply.question_analysis_status!=="extraction_failed")return Response.json(success(dialogueReply(initial),{system:"divination-chat-v2",sessionId:initial.conversation_id}));
    } else if (body.draft_revision !== undefined && body.draft_revision !== initial.revision) {
      return failure("divination-chat-v2", "STALE_DRAFT", "问题版本已更新，请重新读取。", undefined, 409);
    }
    const messages:DivinationChatMessage[] = duplicate ? initial.messages : [...initial.messages, {role:"user",content:last.content.trim(),message_id:messageId}];
    if (messages.length > 126) return failure("divination-chat-v2", "DIALOGUE_LIMIT", "本次对话较长，请开启新问题；原记录已保留。", undefined, 422);
    // Invalidate any earlier candidate before the model runs.
    const collected = duplicate ? initial : await callHybrid<DialogueState>("dialogue-save", {
      conversation_id:initial.conversation_id, expected_revision:initial.revision, messages, candidate:null, reply:null,
    }, true);
    checkpoint=collected;
    let result = duplicate&&initial.reply?.question_analysis_status==="extraction_failed"
      ? {...initial.reply,status:"ready_for_confirmation" as const} : await continueDivinationChatWithLlm(messages);
    let questionAnalysis;
    if(result.status==="ready_for_confirmation"&&result.question_context){
      questionAnalysis=await analyzeSingleQuestion(result.question_context);
      if(questionAnalysis.status==="semantic_conflict")result={...result,...singleIssueClarification(questionAnalysis.issue_count)};
      else if(questionAnalysis.status!=="valid")result={...result,status:"blocked",question_analysis_status:questionAnalysis.status,
        retry_message:messages.filter(m=>m.role==="user").at(-1),message:"问事预检暂未完成，草稿已保留。可重试预检，无需重新输入已提供的信息。"};
      else result={...result,question_analysis_status:"valid"};
    }
    const candidate = result.status === "ready_for_confirmation" && result.question_context && result.extraction?.numbers&&questionAnalysis?.status==="valid"
      ? {question_context:result.question_context, numbers:result.extraction.numbers, timezone,question_analysis:questionAnalysis} : null;
    const saved = await callHybrid<DialogueState>("dialogue-save", {
      conversation_id:collected.conversation_id, expected_revision:collected.revision,
      messages:[...messages,{role:"assistant",content:result.message,message_id:crypto.randomUUID()}], candidate, reply:result,
    }, true);
    return Response.json(success(dialogueReply(saved), {system:"divination-chat-v2",sessionId:saved.conversation_id}));
  } catch(error) {
    return failure("divination-chat-v2","DIALOGUE_ERROR",error instanceof HybridServiceError?error.message:"问事整理未完成，草稿已保留，可重试。",checkpoint?{conversation_id:checkpoint.conversation_id,draft_revision:checkpoint.revision}:undefined,error instanceof HybridServiceError?error.status:502);
  }
}
