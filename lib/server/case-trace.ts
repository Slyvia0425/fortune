import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { workflowFetch } from "./workflow-budget";

interface Trace { run_id:string; directory:string; sequence:number; failed:boolean; references:Set<string> }
const storage=new AsyncLocalStorage<Trace>();
const sensitive=/^(authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|signature|owner|anonymous_session|session_token|x-anonymous-session|x-divination-signature)$/i;
// Diagnostic payloads remain private; credentials are removed even inside JSON strings.
export function redactTrace(value:unknown):unknown {
  if(typeof value==="string"){
    if(/^[\s]*[\[{]/.test(value)){try{const parsed=JSON.parse(value),safe=redactTrace(parsed);return JSON.stringify(parsed)===JSON.stringify(safe)?value:JSON.stringify(safe);}catch{/* Plain model output. */}}
    return value.replace(/Bearer\s+[^\s"',}]+/gi,"Bearer [REDACTED]").replace(/\bsk-[A-Za-z0-9_-]{8,}/g,"[REDACTED]");
  }
  if(Array.isArray(value))return value.map(redactTrace);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,sensitive.test(key)?"[REDACTED]":redactTrace(item)]));
  return value??null;
}
async function persist(state:Trace,name:string,value:unknown){
  const collect=(item:unknown)=>{
    if(Array.isArray(item)){item.forEach(collect);return;}
    if(item&&typeof item==="object")for(const [key,child] of Object.entries(item)){
      if(["chart_id","confirmation_id","conversation_id"].includes(key)&&typeof child==="string"&&/^[a-f0-9-]{36}$/i.test(child))state.references.add(child);
      if(!sensitive.test(key))collect(child);
    }
  };
  collect(value);
  try{
    await mkdir(state.directory,{recursive:true,mode:0o700});
    const temporary=join(state.directory,`${name}.${randomUUID()}.tmp`);
    await writeFile(temporary,JSON.stringify(redactTrace(value),null,2),{mode:0o600,flag:"wx"});
    await rename(temporary,join(state.directory,name));
  }catch{state.failed=true;console.error("CASE_TRACE_WRITE_FAILED",state.run_id);}
}
/** No active API trace means no extra files (unit tests and library users stay unchanged). */
export async function traceNode<T>(node:string,input:unknown,work:()=>Promise<T>|T,project:(result:T)=>unknown=result=>result):Promise<T>{
  const state=storage.getStore();if(!state)return work();
  const sequence=++state.sequence,started=Date.now(),name=`${String(sequence).padStart(3,"0")}-${node.replace(/[^a-z0-9_-]/gi,"_")}.json`;
  const base={run_id:state.run_id,sequence,node,started_at:new Date(started).toISOString(),input:redactTrace(input)};
  await persist(state,name,{...base,status:"running"});
  try{
    const result=await work();
    await persist(state,name,{...base,status:"returned",elapsed_ms:Date.now()-started,output:project(result)});
    return result;
  }catch(error){
    await persist(state,name,{...base,status:"threw",elapsed_ms:Date.now()-started,error:{name:error instanceof Error?error.name:"Error",message:error instanceof Error?error.message:String(error),cause_code:error instanceof Error&&error.cause&&typeof error.cause==="object"&&"code" in error.cause?String(error.cause.code):undefined,issues:error&&typeof error==="object"&&"issues" in error?error.issues:undefined}});
    throw error;
  }
}
export async function traceRoute(node:string,request:Request,work:()=>Promise<Response>,root=join(process.cwd(),".runtime","case-traces")):Promise<Response>{
  if(process.env.LIUYAO_CASE_TRACE==="false")return work();
  const run_id=randomUUID(),state:Trace={run_id,directory:join(root,run_id),sequence:0,failed:false,references:new Set()};
  return storage.run(state,async()=>{
    // Never record request/response headers, cookies, or owner credentials.
    const body=await request.clone().json().catch(()=>null);
    let response:Response;
    try{response=await traceNode(`route-${node}`,body,work,()=>({note:"See response.json for the API result."}));}
    catch(error){await persist(state,"manifest.json",{version:"case-trace-v1",run_id,route:node,input:body,references:[...state.references],node_count:state.sequence,status:"threw"});throw error;}
    const output=await response.clone().json().catch(()=>null);
    await persist(state,"response.json",{run_id,http_status:response.status,output});
    await persist(state,"manifest.json",{version:"case-trace-v1",run_id,route:node,created_at:new Date().toISOString(),input:body,references:[...state.references],node_count:state.sequence,logging_status:state.failed?"partial":"complete",http_status:response.status});
    response.headers.set("X-Divination-Trace-Id",run_id);
    response.headers.set("X-Divination-Trace-Status",state.failed?"partial":"complete");
    return response;
  });
}
/** Save exact model messages and returned content, never transport credentials or hidden reasoning. */
export async function tracedModelFetch(input:string|URL|Request,init?:RequestInit):Promise<Response>{
  if(!storage.getStore())return workflowFetch(input,init);
  let body:unknown=null;try{body=JSON.parse(String(init?.body));}catch{/* Non-JSON request. */}
  let output:unknown;
  return traceNode("model-call",body,async()=>{
    const response=await workflowFetch(input,init);
    const data=await response.clone().json().catch(()=>null);
    output={http_status:response.status,model:data?.model,usage:data?.usage,choices:data?.choices?.map((choice:{message?:{content?:unknown};finish_reason?:unknown})=>({content:choice.message?.content,finish_reason:choice.finish_reason}))};
    return response;
  },()=>output);
}
