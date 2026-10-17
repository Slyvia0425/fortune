import { AsyncLocalStorage } from "node:async_hooks";

interface Budget {deadlineAt:number;signal:AbortSignal}
const budget=new AsyncLocalStorage<Budget>();
export const WORKFLOW_BUDGET_MS=180_000;
export function workflowRemaining(){const state=budget.getStore();return state?state.signal.aborted?0:Math.max(0,state.deadlineAt-Date.now()):Infinity;}
export function withWorkflowDeadline<T>(work:()=>Promise<T>,deadlineAt=Date.now()+WORKFLOW_BUDGET_MS):Promise<T>{
  return budget.run({deadlineAt,signal:AbortSignal.timeout(Math.max(1,deadlineAt-Date.now()))},work);
}
export async function boundedWorkflow<T>(capMs:number,work:()=>Promise<T>):Promise<T>{
  const state=budget.getStore(),remaining=Math.min(capMs,workflowRemaining()-25);
  if(remaining<=0||state?.signal.aborted)throw new Error("WORKFLOW_DEADLINE");
  const abort=new AbortController();const signal=state?AbortSignal.any([state.signal,abort.signal]):abort.signal;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    return await Promise.race([budget.run({deadlineAt:Date.now()+remaining,signal},work),
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new Error("WORKFLOW_NODE_TIMEOUT"));},remaining);})]);
  }finally{if(timer)clearTimeout(timer);}
}
export function workflowFetch(input:string|URL|Request,init?:RequestInit){
  const state=budget.getStore();
  if(state&&(state.signal.aborted||Date.now()>=state.deadlineAt))return Promise.reject(new Error("WORKFLOW_DEADLINE"));
  return globalThis.fetch(input,{...init,signal:state?AbortSignal.any([state.signal,...(init?.signal?[init.signal]:[])]):init?.signal});
}
