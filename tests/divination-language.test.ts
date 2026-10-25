import {describe,it,expect,vi} from "vitest";
import {questionLanguage,divinationText} from "../lib/divination/language";
import {validateEnglishReading,readingParagraphs,type ReadingParagraph} from "../lib/divination/english-reading";
import {dialogueReply} from "../lib/server/question-confirmation";
import type {DialogueState,DivinationInterpretationResult} from "../lib/contracts/divination";

vi.mock("../lib/server/divination-llm",()=>({extractQuestionContext:vi.fn(async()=>null)}));
import {continueDivinationChatWithLlm} from "../lib/divination/chat";
const users=(...contents:string[])=>contents.map(content=>({role:"user" as const,content}));
describe("question language",()=>{
  it("detects English and inherits it for numbers and acknowledgements",()=>{
    expect(questionLanguage(users("Will I get the job?","18, 27, 9","OK"))).toBe("en");
    expect(questionLanguage(users("Career prospects?"))).toBe("en");
    expect(questionLanguage(users("18, 27, 9"),"en")).toBe("en");
  });
  it("does not mistake embedded English terms for an English question",()=>{
    expect(questionLanguage(users("未来三个月能拿到 offer 吗？"))).toBe("zh");
    expect(questionLanguage(users("我明天要不要去 career"))).toBe("zh");
  });
  it("honors explicit language requests across follow-ups",()=>{
    expect(questionLanguage(users("请用英文回答","我想问工作","18 27 9"))).toBe("en");
    expect(questionLanguage(users("Please reply in Chinese","Will I get the job?"))).toBe("zh");
  });
  it("restores language even when a pending draft has no reply",()=>{
    const state={conversation_id:"test",revision:1,messages:users("Will I get the job?"),candidate:null,reply:null} as DialogueState;
    expect(dialogueReply(state).response_language).toBe("en");
    expect(dialogueReply(state).message).toContain("draft");
  });
  it("localizes fallback without allowing a cast",async()=>{
    const reply=await continueDivinationChatWithLlm(users("Will I get the job?"));
    expect(reply.message).toContain("exactly three positive integers");
    expect(reply.response_language).toBe("en");
    expect(reply.cast_request).toBeUndefined();
    expect(divinationText("en","卦盘与检索服务暂不可用，请稍后重试。")).toContain("unavailable");
  });
});
describe("translation integrity",()=>{
  const source:ReadingParagraph[]=[{id:"p1",section:"summary",text:"未来 3 个月可能有变化。",evidence_ids:["E1"]}];
  it("keeps the original section and citation IDs",()=>{
    const result=validateEnglishReading(source,{paragraphs:[{id:"p1",text:"There may be changes within 3 months.",evidence_ids:["fake"],section:"advice"}]});
    expect(result[0]).toEqual({...source[0],text:"There may be changes within 3 months."});
    expect(source[0].text).toContain("未来");
  });
  it("rejects missing paragraphs, changed IDs and changed numbers",()=>{
    for(const paragraphs of [[],[{id:"p2",text:"Within 3 months."}],[{id:"p1",text:"Within 6 months."}]])expect(()=>validateEnglishReading(source,{paragraphs})).toThrow();
  });
  it("extracts reading prose without a limitations section, frozen facts or original quotations",()=>{
    const result={basic_interpretation:{overall_interpretation:"可能有变化",uncertainties:["尚待确认"],disclaimer:"仅供学习"},frozen_core:{secret:"original"},evidence_pack:{evidence:[{original:"古籍原文"}]}} as unknown as DivinationInterpretationResult;
    expect(readingParagraphs(result).map(p=>p.text)).toEqual(["可能有变化"]);
  });
});
