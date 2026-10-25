import { join } from "node:path";
import { cachedInterpretation } from "./interpretation-cache";
import { requestPlannerJson, analysisModelProfile } from "./divination-llm";
import { questionLanguage } from "../divination/language";

export const CHINESE_RESEARCH_VERSION="chinese-research-question-v1";
export interface ChineseResearchQuestion { version:typeof CHINESE_RESEARCH_VERSION; original_question:string; question_zh:string }
export class QuestionTranslationError extends Error { constructor(){super("QUESTION_TRANSLATION_UNAVAILABLE");} }
export function validateChineseQuestion(original:string,value:unknown):string{
  const text=(value as {question_zh?:unknown})?.question_zh;
  if(typeof text!=="string"||!text.trim()||text.length>240||!/[\p{Script=Han}]/u.test(text))throw new QuestionTranslationError();
  const quantities=(s:string)=>(s.match(/\d+(?:\.\d+)?/g)??[]).sort().join(",");
  if(quantities(original)!==quantities(text))throw new QuestionTranslationError();
  return text.trim();
}
/** Translation is derived data, never a replacement for the confirmed question/hash. */
export async function prepareChineseQuestion(owner:string,original:string):Promise<ChineseResearchQuestion>{
  if(questionLanguage([{role:"user",content:original}])==="zh")return {version:CHINESE_RESEARCH_VERSION,original_question:original,question_zh:original};
  try{
    const response=await cachedInterpretation(owner,{version:CHINESE_RESEARCH_VERSION,original_question:original,model:analysisModelProfile()},false,async()=>{
      const output=await requestPlannerJson(`Translate original_question into Simplified Chinese. This is a translation task: preserve its meaning, people, relationships, negation, time frame and all Arabic numerals. Do not answer the question or add information. Keep relative time expressions relative. Return only JSON {"question_zh":"Chinese translation"}, at most 240 characters.`,{original_question:original},undefined,{timeoutMs:30_000});
      return Response.json({version:CHINESE_RESEARCH_VERSION,original_question:original,question_zh:validateChineseQuestion(original,JSON.parse(output))});
    },join(process.cwd(),".runtime","chinese-research-questions"));
    return await response.json();
  }catch{throw new QuestionTranslationError();}
}

/** Keep controlled Chinese theory terms while supplying the translated event context. */
export function chineseRetrievalQuery(terms:string,questionZh:string):string{
  if(!questionZh.trim()||!/[\p{Script=Han}]/u.test(questionZh))throw new QuestionTranslationError();
  const query=`${terms}\n问事：${questionZh}`;
  if(questionZh.length>500)throw new QuestionTranslationError();
  if(query.length>500)return questionZh;
  return query;
}
