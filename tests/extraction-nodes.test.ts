import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {questionLanguage} from "../lib/divination/language";
import {CHINESE_EXTRACTION_PROMPT,ENGLISH_EXTRACTION_PROMPT} from "../lib/divination/extraction-prompts";
const mocks=vi.hoisted(()=>({fetch:vi.fn(),trace:vi.fn()}));
vi.mock("../lib/server/case-trace",()=>({tracedModelFetch:mocks.fetch,traceNode:mocks.trace}));
beforeEach(()=>{vi.resetModules();vi.stubEnv("LLM_API_KEY","test");vi.stubEnv("LLM_MODEL","test");mocks.fetch.mockReset();mocks.trace.mockReset();mocks.trace.mockImplementation((_name,_input,fn)=>fn());mocks.fetch.mockResolvedValue(Response.json({choices:[{message:{content:JSON.stringify({need_follow_up:true,follow_up_question:"Please provide three numbers."})}}]}));});
afterEach(()=>vi.unstubAllEnvs());
describe("language-specific extraction nodes",()=>{
  it.each([['zh','我下个月去上海找朋友玩，行程能顺利吗？',CHINESE_EXTRACTION_PROMPT],['en','Will my trip to Shanghai to visit friends next month go smoothly?',ENGLISH_EXTRACTION_PROMPT]] as const)("routes %s and numeric follow-ups to exactly one node",async(language,question,prompt)=>{
    const {extractQuestionContext}=await import("../lib/server/divination-llm");
    const messages=[{role:"user" as const,content:question},{role:"user" as const,content:"18, 27, 9"}];
    await extractQuestionContext(messages,questionLanguage(messages));
    expect(mocks.trace).toHaveBeenCalledWith(`question-extraction-${language}`,expect.objectContaining({language}),expect.any(Function));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const body=JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toBe(prompt);
    expect(body.messages.slice(1)).toEqual(messages);
  });
  it("keeps prompts separate and the shared parser preserves original evidence",async()=>{
    expect(ENGLISH_EXTRACTION_PROMPT).not.toBe(CHINESE_EXTRACTION_PROMPT);
    const {parseQuestionContext}=await import("../lib/server/divination-llm");
    const question="Will I visit friends next month?";
    const parsed=parseQuestionContext(JSON.stringify({raw_question:question,domain:"travel",question_type:"outcome",event_type:"travel_outcome",goal:question,goal_groups:[question],target_entities:[],relationships:[],time_expression:"next month",known_facts:[],ambiguities:[]}),[{role:"user",content:question}]);
    expect(parsed).toMatchObject({need_follow_up:false,context:{raw_question:question,time_expression:{value:"next month"}}});
  });
});

describe("extraction transport recovery",()=>{
  it.each(["zh","en"] as const)("recovers %s connect timeout without changing the question or prompt",async language=>{
    mocks.fetch.mockRejectedValueOnce(new TypeError("fetch failed",{cause:{code:"UND_ERR_CONNECT_TIMEOUT"}}));
    const {extractQuestionContext}=await import("../lib/server/divination-llm");
    const result=await extractQuestionContext([{role:"user",content:"18,27,9"}],language);
    expect(result).toMatchObject({need_follow_up:true});
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[0][1].body).toBe(mocks.fetch.mock.calls[1][1].body);
    expect(mocks.fetch.mock.calls[0][1].signal).not.toBe(mocks.fetch.mock.calls[1][1].signal);
  });
  it("bounds persistent connection failures to three attempts",async()=>{
    mocks.fetch.mockRejectedValue(new TypeError("fetch failed"));
    const {extractChineseQuestion}=await import("../lib/server/divination-llm");
    await expect(extractChineseQuestion([])).rejects.toThrow("fetch failed");
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });
  it.each([401,403,400])("does not retry HTTP %s",async status=>{
    mocks.fetch.mockResolvedValue(Response.json({}, {status}));
    const {extractChineseQuestion}=await import("../lib/server/divination-llm");
    await expect(extractChineseQuestion([])).rejects.toThrow(`LLM_SERVICE_${status}`);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("does not retry malformed output",async()=>{
    mocks.fetch.mockResolvedValue(Response.json({choices:[{message:{content:"not JSON"}}]}));
    const {extractChineseQuestion}=await import("../lib/server/divination-llm");
    await expect(extractChineseQuestion([])).rejects.toThrow();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("recovers a request timeout followed by a transient HTTP failure",async()=>{
    mocks.fetch.mockRejectedValueOnce(new DOMException("Timed out","TimeoutError"))
      .mockResolvedValueOnce(Response.json({}, {status:503}));
    const {extractChineseQuestion}=await import("../lib/server/divination-llm");
    expect(await extractChineseQuestion([])).toMatchObject({need_follow_up:true});
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });
});
