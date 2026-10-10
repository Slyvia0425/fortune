import type {DivinationChatMessage,DivinationChatReply,DivinationExtraction} from "@/lib/contracts/divination";
import {extractDivinationIntent} from "../server/divination-llm";

const timeOf=(text:string)=>text.match(/(?:未来|近|在)?(?:[0-9一二三四五六七八九十]+\s*(?:天|周|个月|月|年)|今天|明天|后天|今年|明年|本周|下周|这周末|下个月|近期)/)?.[0]??"";
const numbersOf=(text:string)=>[...text.matchAll(/(?<!\d)(\d{1,6})(?!\d)/g)].map(match=>Number(match[1]));
const userMessages=(messages:DivinationChatMessage[])=>messages.filter(message=>message.role==="user"&&message.content.trim());
const userText=(messages:DivinationChatMessage[])=>userMessages(messages).map(message=>message.content.trim()).join(" ");

function castingNumbers(messages:DivinationChatMessage[]) {
  const users=userMessages(messages);
  const latestNumbers=numbersOf(users.at(-1)?.content??"");
  // A follow-up such as “18、27、9” replaces incidental numbers in prior context.
  if(latestNumbers.length===3)return latestNumbers;
  const allNumbers=numbersOf(users.map(message=>message.content).join(" "));
  return allNumbers.length===3?allNumbers:[];
}

export function continueDivinationChat(messages:DivinationChatMessage[]):DivinationChatReply{
  const text=userText(messages);
  if(!text)return{status:"clarify",message:"想问哪一件事？请用一句话说明问题。",suggestions:["我想问未来三个月的工作安排"]};
  if(/灵签|观音|抽签/.test(text))return{status:"clarify",message:"这里仅提供易卦起卦。观音灵签请前往独立的“灵签”板块；如果要继续问卦，请直接说明所问事件。",suggestions:["我想用易卦问未来三个月的工作"]};
  const question=text.replace(/(?:我想|请|帮我)?(?:用)?(?:六爻起卦|六爻|易卦|起卦|卦象|数字起卦|三币)/g,"").trim();
  if(question.length<4)return{status:"clarify",message:"请用一句话说明所问事件，例如“我是否应接受新的工作机会”。",suggestions:["我是否应接受新的工作机会？"]};
  const timeRange=timeOf(text);
  const numbers=castingNumbers(messages);
  if(numbers.length!==3)return{status:"clarify",message:"请按顺序提供恰好三个整数作为起卦数字，例如“18、27、9”。",suggestions:["18、27、9"]};
  return{status:"ready",message:"信息齐全。系统将冻结本次时间与时区，并调用已配置的三数字算法排盘。",suggestions:[],cast_request:{question:text,method:"three_numbers",numbers:numbers as [number,number,number]},extraction:{source:"rules",question,time_range:timeRange,method:"three_numbers",numbers:numbers as [number,number,number]}};
}

export async function continueDivinationChatWithLlm(messages:DivinationChatMessage[]):Promise<DivinationChatReply>{
  const deterministic=continueDivinationChat(messages);
  // Exact three-number input is a Core fact, not an LLM inference.  Return it
  // immediately so a slow semantic parser cannot make the cast UI appear stuck.
  if(deterministic.status==="ready")return deterministic;
  try{
    const intent=await extractDivinationIntent(messages);
    if(!intent)return withRuleExtraction(messages,"LLM_EMPTY_OR_INVALID_RESPONSE");
    if(!deterministic.cast_request)return withRuleExtraction(messages,"LLM_INVALID_NUMBERS");
    const extraction:DivinationExtraction={source:"llm",question:intent.question,time_range:intent.timeRange,method:"three_numbers",numbers:intent.numbers};
    return{...deterministic,extraction};
  }catch(error){return withRuleExtraction(messages,error instanceof Error?error.message:"LLM_UNKNOWN_ERROR")}
}

function withRuleExtraction(messages:DivinationChatMessage[],fallbackReason?:string):DivinationChatReply{
  const text=userText(messages),timeRange=timeOf(text),numbers=castingNumbers(messages);
  return{...continueDivinationChat(messages),extraction:{source:"rules",question:text||undefined,time_range:timeRange||undefined,method:numbers.length===3?"three_numbers":undefined,numbers:numbers.length===3?numbers as [number,number,number]:undefined,fallback_reason:fallbackReason}};
}
