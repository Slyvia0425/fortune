import { afterEach, expect, it, vi } from "vitest";

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.resetModules();});
it("PR-6 transport permits 120s without raising Q1/P1/G1 default 30s cap",async()=>{
  vi.resetModules();vi.stubEnv("LLM_API_KEY","test-only");vi.stubEnv("LLM_MODEL","test-model");vi.stubEnv("LLM_TIMEOUT_MS","60000");
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:"{}"}}]}),{status:200})));
  const timeout=vi.spyOn(AbortSignal,"timeout");
  const {requestPlannerJson}=await import("../lib/server/divination-llm");
  await requestPlannerJson("test",{});expect(timeout).toHaveBeenLastCalledWith(30_000);
  await requestPlannerJson("test",{},undefined,120_000);expect(timeout).toHaveBeenLastCalledWith(120_000);
});

it.each([0,-1,NaN,Infinity,120_001,1.5])("rejects invalid per-request timeout %s before fetching",async(ms)=>{
  vi.stubEnv("LLM_API_KEY","test-only");vi.stubEnv("LLM_MODEL","test-model");
  const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  const {requestPlannerJson}=await import("../lib/server/divination-llm");
  await expect(requestPlannerJson("test",{},undefined,ms)).rejects.toThrow("PLANNER_TIMEOUT_INVALID");
  expect(fetch).not.toHaveBeenCalled();
});

it("PR6 request signal is aborted by its shared node deadline",async()=>{
  vi.stubEnv("LLM_API_KEY","test-only");vi.stubEnv("LLM_MODEL","test-model");
  let requestSignal:AbortSignal|undefined;
  vi.stubGlobal("fetch",vi.fn((_url,init)=>new Promise((_resolve,reject)=>{
    requestSignal=init.signal;
    requestSignal!.addEventListener("abort",()=>reject(new Error("aborted")),{once:true});
  })));
  const {requestPlannerJson}=await import("../lib/server/divination-llm");
  const {boundedWorkflow}=await import("../lib/server/workflow-budget");
  await expect(boundedWorkflow(30,()=>requestPlannerJson("test",{},undefined,120_000))).rejects.toThrow();
  expect(requestSignal?.aborted).toBe(true);
});

it("explicit 120s call is clamped to node remaining time and usage is observable",async()=>{
  vi.stubEnv("LLM_API_KEY","test-only");vi.stubEnv("LLM_MODEL","test-model");
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({model:"test-model",choices:[{message:{content:"{}"},finish_reason:"stop"}],usage:{prompt_tokens:123,completion_tokens:45}}),{status:200})));
  const {requestPlannerJson}=await import("../lib/server/divination-llm"),{boundedWorkflow}=await import("../lib/server/workflow-budget");
  const metadata=vi.fn();await boundedWorkflow(1000,()=>requestPlannerJson("test",{},undefined,{timeoutMs:120_000,onMetadata:metadata}));
  expect(metadata).toHaveBeenCalledWith(expect.objectContaining({model:"test-model",finish_reason:"stop",input_tokens:123,output_tokens:45,request_timeout_ms:expect.any(Number)}));
  expect(metadata.mock.calls[0][0].request_timeout_ms).toBeLessThan(1000);
});
