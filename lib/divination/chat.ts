import type {DivinationChatMessage,DivinationChatReply,DivinationExtraction,QuestionContext} from "@/lib/contracts/divination";
import {extractQuestionContext} from "../server/divination-llm";

const timeOf=(text:string)=>text.match(/(?:未来|近|在)?(?:[0-9一二三四五六七八九十]+\s*(?:天|周|个月|月|年)|今天|明天|后天|今年|明年|本周|下周|这周末|下个月|近期)/)?.[0]??"";
const numbersOf=(text:string)=>[...text.matchAll(/(?<!\d)(\d{1,6})(?!\d)/g)].map(match=>Number(match[1]));
const userMessages=(messages:DivinationChatMessage[])=>messages.filter(message=>message.role==="user"&&message.content.trim());
const userText=(messages:DivinationChatMessage[])=>userMessages(messages).map(message=>message.content.trim()).join(" ");

function castingNumbers(messages:DivinationChatMessage[]) {
  const users=userMessages(messages); const latest=numbersOf(users.at(-1)?.content??"");
  if(latest.length===3)return latest;
  const all=numbersOf(users.map(message=>message.content).join(" "));
  return all.length===3?all:[];
}

function ruleContext(messages:DivinationChatMessage[]):QuestionContext {
  const text=userText(messages); const question=text.replace(/[0-9０-９]+[、，,\s]+[0-9０-９]+[、，,\s]+[0-9０-９]+/g,"").trim();
  const generic=/^(?:我想问|想问|请问)?(?:未来|近)?[一二三四五六七八九十0-9]*个?(?:月|周|天)?的?(?:工作|事业|感情|财运|学业|健康)(?:怎么样|如何|安排)?[？?。！!]*$/;
  const goal=question.length>=4&&!generic.test(question)?{value:question.slice(0,160),provenance:"user_explicit" as const,verification_status:"extracted" as const}:{value:null,provenance:"unknown" as const,verification_status:"unknown" as const};
  return {raw_question:question||text,initiator:{value:null,provenance:"unknown",verification_status:"unknown"},number_provider:{value:null,provenance:"unknown",verification_status:"unknown"},perspective_person:{value:null,provenance:"unknown",verification_status:"unknown"},target_entities:[],relationships:[],topic_candidates:[],goal,question_kind:{value:null,provenance:"unknown",verification_status:"unknown"},process_stage:{value:null,provenance:"unknown",verification_status:"unknown"},time_expression:timeOf(text)?{value:timeOf(text),provenance:"user_explicit",verification_status:"extracted"}:{value:null,provenance:"unknown",verification_status:"unknown"},known_facts:[],assumptions:[],exclusions:[],ambiguities:goal.value?[]:["尚未说明希望确认的具体结果"],goal_groups:[],parser_status:"unavailable"};
}

function semanticGaps(context:QuestionContext):string[] {
  const gaps=[...context.ambiguities];
  if(!context.goal.value)gaps.push("尚未说明希望确认的具体结果");
  if(context.goal_groups.length>1)gaps.push("同时包含多个目标");
  const raw=context.raw_question;
  if(/(?:他|她|对方|孩子|家人)/.test(raw)&&!context.relationships.length&&!context.perspective_person.value)gaps.push("所问人物与提问者的关系未明确");
  return [...new Set(gaps)];
}

function clarifyMessage(gaps:string[],numbers:number[]) {
  if(!numbers.length)return {message:"请按顺序提供恰好三个整数作为起卦数字，例如“18、27、9”。",suggestions:["18、27、9"]};
  if(gaps.some(gap=>/具体结果|目标|工作|未明确/.test(gap)))return {message:"数字已记录，可先冻结本卦。你想问工作中的哪一个结果：求职/能否拿到 offer、升职或调岗、是否离职，还是现岗位能否稳定发展？",suggestions:["我想问未来三个月能否拿到实习 offer","我想问是否应接受调岗"]};
  if(gaps.some(gap=>/关系/.test(gap)))return {message:"数字已记录。请说明“他/她”与你的关系，以及这次具体想确认什么结果。",suggestions:["他是我的朋友，我想问他能否按期回款"]};
  return {message:"数字已记录。请从多个目标中选定本次主问的一项，其他目标可在本卦的后续问题中再单独讨论。",suggestions:[]};
}

function makeReply(messages:DivinationChatMessage[],context:QuestionContext,source:DivinationExtraction["source"],fallbackReason?:string):DivinationChatReply {
  const text=userText(messages); const numbers=castingNumbers(messages); const gaps=semanticGaps(context);
  const timeRange=context.time_expression.value??timeOf(text)??undefined;
  const extraction:DivinationExtraction={source,question:context.goal.value??context.raw_question,time_range:timeRange||undefined,method:numbers.length===3?"three_numbers":undefined,numbers:numbers.length===3?numbers as [number,number,number]:undefined,fallback_reason:fallbackReason};
  const cast_request=numbers.length===3?{question:context.raw_question,method:"three_numbers" as const,numbers:numbers as [number,number,number]}:undefined;
  if(!numbers.length||gaps.length){const clarification=clarifyMessage(gaps,numbers);return {status:"clarify",...clarification,cast_request,extraction,question_context:context};}
  return {status:"ready",message:"问题目标与起卦数字已确认。系统将冻结本次时间与时区；后续补充只更新问题语境，不会重新起卦。",suggestions:[],cast_request,extraction,question_context:context};
}

export function continueDivinationChat(messages:DivinationChatMessage[]):DivinationChatReply{
  const text=userText(messages);
  if(!text)return {status:"clarify",message:"想问哪一件事？请用一句话说明问题。",suggestions:["我想问未来三个月能否拿到实习 offer"]};
  if(/灵签|观音|抽签/.test(text))return {status:"clarify",message:"这里仅提供易卦起卦。观音灵签请前往独立的“灵签”板块；如果要继续问卦，请直接说明所问事件。",suggestions:["我想用易卦问未来三个月的工作"]};
  return makeReply(messages,ruleContext(messages),"rules","LLM_NOT_USED");
}

export async function continueDivinationChatWithLlm(messages:DivinationChatMessage[]):Promise<DivinationChatReply>{
  const text=userText(messages); if(!text||/灵签|观音|抽签/.test(text))return continueDivinationChat(messages);
  try {
    const extracted=await extractQuestionContext(messages);
    if(!extracted)return makeReply(messages,ruleContext(messages),"unavailable","LLM_EMPTY_OR_INVALID_RESPONSE");
    if(extracted.need_follow_up) {
      const context=ruleContext(messages);
      return {status:"clarify",message:extracted.follow_up_question,suggestions:[],extraction:{source:"llm",question:context.raw_question,time_range:context.time_expression.value??undefined},question_context:context};
    }
    return makeReply(messages,extracted.context,"llm");
  }
  catch(error) { return makeReply(messages,ruleContext(messages),"unavailable",error instanceof Error?error.message:"LLM_UNKNOWN_ERROR"); }
}
