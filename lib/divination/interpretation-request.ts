/** Retry infrastructure failures only, retaining the exact frozen-chart request. */
export async function requestInterpretation<T>(body: unknown, signal: AbortSignal, fetcher: typeof fetch = fetch, pause = (ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))): Promise<{response:Response;payload:T}> {
  const serialized=JSON.stringify(body);
  for(let attempt=0;attempt<3;attempt++){
    signal.throwIfAborted();
    let response:Response;
    try{
      response=await fetcher("/api/divination/interpret",{method:"POST",headers:{"content-type":"application/json"},body:serialized,signal});
    }catch(error){
      if(signal.aborted||!(error instanceof TypeError)||attempt===2)throw error;
      await pause(1000*(attempt+1));continue;
    }
    const text=await response.text();
    let payload:T;
    try{payload=JSON.parse(text) as T;}
    catch{
      // Next's error page is HTML and never reached our JSON route handler.
      if([500,502,503,504].includes(response.status)&&attempt<2){await pause(1000*(attempt+1));continue;}
      throw new Error("解读服务暂时无法返回有效结果，原卦盘已保留。");
    }
    return {response,payload};
  }
  throw new Error("解读服务暂不可用，原卦盘已保留。");
}
