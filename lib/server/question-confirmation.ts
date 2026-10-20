import type { DialogueState, DivinationChatReply } from "../contracts/divination";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function dialogueReply(state: DialogueState): DivinationChatReply {
  const reply = state.reply ?? {status:"clarify" as const,message:"草稿已保存，请继续补充本次问题。",suggestions:[]};
  const checkedCandidate=state.candidate?.question_analysis?.status==="valid"?state.candidate:null;
  return {...reply,cast_request:undefined,conversation_id:state.conversation_id,draft_revision:state.revision,
    confirmation_preview:checkedCandidate??undefined,confirmed_question:state.confirmed_question??undefined,
    status:state.confirmed_question?"confirmed":checkedCandidate?"ready_for_confirmation":reply.status==="blocked"?"blocked":"clarify"};
}
