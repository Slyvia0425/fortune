import {expect,it,vi} from "vitest";
import {requestInterpretation} from "../lib/divination/interpretation-request";
const body={chart_id:"saved-chart",chart_hash:"frozen-hash",response_language:"en",retry:false};
it("recovers HTML 500 without recasting or forcing regeneration",async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response('<!DOCTYPE html>error',{status:500})).mockResolvedValueOnce(Response.json({result:{analysis_status:"complete"}}));
 const pause=vi.fn().mockResolvedValue(undefined);
 const result=await requestInterpretation(body,new AbortController().signal,fetcher,pause);
 expect(result.payload).toEqual({result:{analysis_status:"complete"}});
 expect(fetcher).toHaveBeenCalledTimes(2);
 expect(fetcher.mock.calls[1]).toEqual(fetcher.mock.calls[0]);
 expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual(body);
});
it("never retries a JSON application error or unauthorized HTML",async()=>{
 const application=vi.fn().mockResolvedValue(Response.json({error:{message:"source unavailable"}},{status:503}));
 expect((await requestInterpretation(body,new AbortController().signal,application)).response.status).toBe(503);
 expect(application).toHaveBeenCalledTimes(1);
 const unauthorized=vi.fn().mockResolvedValue(new Response('<html>login</html>',{status:401}));
 await expect(requestInterpretation(body,new AbortController().signal,unauthorized)).rejects.toThrow();
 expect(unauthorized).toHaveBeenCalledTimes(1);
});
it("bounds retries and honors cancellation",async()=>{
 const fetcher=vi.fn().mockImplementation(async()=>new Response('<html>error</html>',{status:500}));
 await expect(requestInterpretation(body,new AbortController().signal,fetcher,async()=>{})).rejects.toThrow();
 expect(fetcher).toHaveBeenCalledTimes(3);
 fetcher.mockClear();const abort=new AbortController();abort.abort();
 await expect(requestInterpretation(body,abort.signal,fetcher)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
});
