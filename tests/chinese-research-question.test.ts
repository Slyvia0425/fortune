import {beforeEach,describe,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({request:vi.fn(),cache:vi.fn()}));
vi.mock("../lib/server/divination-llm",()=>({requestPlannerJson:mocks.request,analysisModelProfile:()=>"model-v1"}));
vi.mock("../lib/server/interpretation-cache",()=>({cachedInterpretation:mocks.cache}));
import {prepareChineseQuestion,chineseRetrievalQuery,validateChineseQuestion} from "../lib/server/chinese-research-question";
beforeEach(()=>{vi.resetAllMocks();mocks.cache.mockImplementation((_owner,_key,_retry,generate)=>generate());});
describe("Chinese research question",()=>{
  it("translates before retrieval while preserving the original question",async()=>{
    const original="Will my trip to Shanghai to visit friends next month go smoothly?";
    mocks.request.mockResolvedValue(JSON.stringify({question_zh:"下个月去上海找朋友玩的行程会顺利吗？"}));
    const result=await prepareChineseQuestion("owner",original);
    expect(result.original_question).toBe(original);
    const query=chineseRetrievalQuery("世应 生克",result.question_zh);
    expect(query).toContain("问事：下个月去上海");expect(query).not.toContain("Will my trip");
    expect(mocks.cache.mock.calls[0][0]).toBe("owner");
    expect(mocks.cache.mock.calls[0][1]).toMatchObject({original_question:original,model:"model-v1"});
  });
  it("keeps Chinese questions without a model round trip",async()=>{
    expect((await prepareChineseQuestion("owner","下个月出行会顺利吗？")).question_zh).toBe("下个月出行会顺利吗？");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("does not silently search in English if translation fails",async()=>{
    mocks.request.mockRejectedValue(new Error("unavailable"));
    await expect(prepareChineseQuestion("owner","Will the trip go smoothly?")).rejects.toThrow("QUESTION_TRANSLATION_UNAVAILABLE");
    expect(()=>chineseRetrievalQuery("世应","Will the trip go smoothly?")).toThrow();
  });
  it("rejects empty translations and changed numeric time ranges",()=>{
    expect(()=>validateChineseQuestion("Within 3 months?",{question_zh:"6个月内吗？"})).toThrow();
    expect(()=>validateChineseQuestion("Will it work?",{question_zh:""})).toThrow();
    expect(validateChineseQuestion("Within 3 months?",{question_zh:"3个月内吗？"})).toBe("3个月内吗？");
  });
});
