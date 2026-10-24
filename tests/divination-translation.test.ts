import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({request:vi.fn(),cache:vi.fn(),owner:"session-a"}));
vi.mock("next/headers",()=>({cookies:async()=>({get:()=>({value:mocks.owner})})}));
vi.mock("../lib/server/module4-auth",()=>({AUTH_COOKIE:"auth"}));
vi.mock("../lib/server/liuyao-hybrid",()=>({DIVINATION_SESSION_COOKIE:"anon"}));
vi.mock("../lib/server/divination-llm",()=>({requestPlannerJson:mocks.request,analysisModelProfile:()=>"model-v1"}));
vi.mock("../lib/server/interpretation-cache",()=>({cachedInterpretation:mocks.cache}));
import {englishInterpretation} from "../lib/server/divination-translation";
const original={result:{modern_interpretation:{overall_interpretation:"未来 3 个月可能变化",uncertainties:[],disclaimer:""},frozen_core:{chart_hash:"unchanged"}},warnings:[]};
beforeEach(()=>{
  vi.clearAllMocks();mocks.owner="session-a";
  mocks.cache.mockImplementation((_owner,_identity,_retry,generate)=>generate());
  mocks.request.mockResolvedValue(JSON.stringify({paragraphs:[{id:"p1",text:"There may be changes within 3 months."}]}));
});
describe("English presentation layer",()=>{
  it("preserves original analysis and scopes translation cache by owner, content and model",async()=>{
    const response=await englishInterpretation(Response.json(original));
    const payload=await response.json();
    expect(payload.result.modern_interpretation).toEqual(original.result.modern_interpretation);
    expect(payload.result.frozen_core).toEqual(original.result.frozen_core);
    expect(payload.result.english_reading.status).toBe("ready");
    expect(mocks.cache.mock.calls[0][0]).toBe("session-a");
    expect(mocks.cache.mock.calls[0][1]).toMatchObject({version:"english-reading-v1",model:"model-v1",source:[{text:"未来 3 个月可能变化"}]});
    expect(mocks.cache.mock.calls[0][4]).toContain("divination-translations");
  });
  it("retains original results if translation fails and supports translation-only retry",async()=>{
    mocks.request.mockRejectedValueOnce(new Error("timeout"));
    const failed=await (await englishInterpretation(Response.json(original))).json();
    expect(failed.result.english_reading.status).toBe("unavailable");
    expect(failed.result.modern_interpretation).toEqual(original.result.modern_interpretation);
    const retried=await (await englishInterpretation(Response.json(original),true)).json();
    expect(retried.result.english_reading.status).toBe("ready");
    expect(mocks.cache.mock.calls[1][2]).toBe(true);
  });
  it("does not send unauthorized responses to the model",async()=>{
    const response=await englishInterpretation(Response.json({error:"not authorized"},{status:401}));
    expect(response.status).toBe(401);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
