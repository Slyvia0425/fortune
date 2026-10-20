import type { DivinationChatReply } from "../contracts/divination";

/** A candidate is never authority to cast. The server verifies this ID. */
export function canCastChatReply(reply: DivinationChatReply): boolean {
  return reply.status === "confirmed" && reply.confirmed_question?.state === "confirmed"
    && reply.confirmed_question.source === "explicit_user_action"
    && /^[0-9a-f-]{36}$/i.test(reply.confirmed_question.confirmation_id);
}

/** Conservative backstop for explicit, different result targets in one utterance. */
export function hasExplicitMultipleIssues(text: string): boolean {
  const events=["复合","结婚|婚期","录用|offer|入职","薪资|薪水|工资","健康|康复|痊愈","财运"];
  const requested=events.filter(event=>new RegExp(`(?:能否|能不能|是否|会不会|何时|什么时候|多久|能|会)[^，,？?；;]{0,12}(?:${event})|(?:${event})[^，,？?；;]{0,4}(?:吗|多少|如何|怎么样|[？?])`,"i").test(text));
  return requested.length>1 || /复合(?:并|和|及)结婚/.test(text);
}
