import type {DivinationChatMessage,DivinationChatReply,DivinationExtraction} from "@/lib/contracts/divination";
import {extractDivinationIntent} from "../server/divination-llm";

const timeOf=(text:string)=>text.match(/(?:未来|近|在)?(?:[0-9一二三四五六七八九十]+\s*(?:天|周|个月|月|年)|今天|明天|后天|今年|明年|本周|下周|这周末|下个月|近期)/)?.[0]??"";
const numbersOf=(text:string)=>[...text.matchAll(/(?<!\d)(\d{1,6})(?!\d)/g)].map(match=>Number(match[1]));
const userText=(messages:DivinationChatMessage[])=>messages.filter(message=>message.role==="user").map(message=>message.content.trim()).filter(Boolean).join(" ");

export function continueDivinationChat(messages:DivinationChatMessage[]):DivinationChatReply{
  const text=userText(messages);
  if(!text)return{status:"clarify",message:"想问哪一件事？请用一句话说明问题。",suggestions:["我想问未来三个月的工作安排"]};
  if(/灵签|观音|抽签/.test(text))return{status:"clarify",message:"这里仅提供易卦起卦。观音灵签请前往独立的“灵签”板块；如果要继续问卦，请直接说明所问事件。",suggestions:["我想用易卦问未来三个月的工作"]};
  const question=text.replace(/(?:我想|请|帮我)?(?:用)?(?:六爻起卦|六爻|易卦|起卦|卦象|数字起卦|三币)/g,"").trim();
  if(question.length<4)return{status:"clarify",message:"请用一句话说明所问事件，例如“我是否应接受新的工作机会”。",suggestions:["我是否应接受新的工作机会？"]};
  const timeRange=timeOf(text);
  if(!timeRange)return{status:"clarify",message:"这个问题希望看哪个时间范围？例如“未来三个月”或“今年内”。",suggestions:["未来三个月","今年内"]};
  const numbers=numbersOf(text).filter(value=>value>0&&value<=999_999).slice(-3);
  if(numbers.length<2)return{status:"clarify",message:"请给我两个正整数作为上卦和下卦数字（可选第三个数字决定动爻），例如“18 和 27”。",suggestions:["18 和 27","18、27、9"]};
  return{status:"ready",message:"信息齐全。我将按固定规则计算本卦、动爻、互卦和变卦。",suggestions:[],cast_request:{question,method:"numbers",numbers,time_range:timeRange}};
}

export async function continueDivinationChatWithLlm(messages:DivinationChatMessage[]):Promise<DivinationChatReply>{
  try{
    const intent=await extractDivinationIntent(messages);
    if(!intent)return withRuleExtraction(messages,"LLM_EMPTY_OR_INVALID_RESPONSE");
    if(intent.method==="numbers"&&(!intent.numbers||intent.numbers.length<2))return withRuleExtraction(messages,"LLM_INVALID_NUMBERS");
    if(!intent.timeRange)return withRuleExtraction(messages,"LLM_MISSING_TIME_RANGE");
    const extraction:DivinationExtraction={source:"llm",question:intent.question,time_range:intent.timeRange,method:intent.method??"random",numbers:intent.method==="numbers"?intent.numbers:undefined};
    return{status:"ready",message:intent.method==="random"?"我已理解你的问题与时间范围，将使用随机起卦并由规则引擎计算卦象。":"信息齐全。我将按固定规则计算本卦、动爻、互卦和变卦。",suggestions:[],cast_request:{question:intent.question,method:intent.method??"random",numbers:intent.method==="numbers"?intent.numbers:undefined,time_range:intent.timeRange},extraction};
  }catch(error){return withRuleExtraction(messages,error instanceof Error?error.message:"LLM_UNKNOWN_ERROR")}
}

function withRuleExtraction(messages:DivinationChatMessage[],fallbackReason?:string):DivinationChatReply{
  const text=userText(messages),timeRange=timeOf(text),numbers=numbersOf(text).filter(value=>value>0&&value<=999_999).slice(-3);
  return{...continueDivinationChat(messages),extraction:{source:"rules",question:text||undefined,time_range:timeRange||undefined,method:numbers.length>=2?"numbers":undefined,numbers:numbers.length?numbers:undefined,fallback_reason:fallbackReason}};
}
