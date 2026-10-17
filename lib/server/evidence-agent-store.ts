import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { analysisHash } from "../divination/analysis-utils";
import type { AgentResult } from "../divination/agent-controller";

export function evidenceAgentStore(owner:string,fingerprint:string,directory=join(process.cwd(),".runtime","analysis-agent")){
  const root=join(directory,analysisHash({owner,fingerprint})),path=join(root,"checkpoint.json");
  const decode=(raw:string)=>{
    const envelope=JSON.parse(raw) as {digest:string;state:AgentResult};
    if(envelope.digest!==analysisHash(envelope.state)||envelope.state.fingerprint!==fingerprint)throw new Error("AGENT_CHECKPOINT_CORRUPT");
    return envelope.state;
  };
  const load=async():Promise<AgentResult|null>=>{
    try{return decode(await readFile(path,"utf8"));}
    catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    // A crash between journal write and atomic rename still has a usable snapshot.
    let files:string[];try{files=await readdir(root);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}
    const valid:AgentResult[]=[];
    for(const file of files.filter(f=>/^\d+-[a-f0-9-]+\.json$/.test(f)).sort().reverse()){
      try{valid.push(decode(await readFile(join(root,file),"utf8")));}catch{/* An interrupted journal write is not a committed checkpoint. */}
    }
    return valid.sort((a,b)=>b.snapshot.completed_rounds-a.snapshot.completed_rounds||Number(b.terminal)-Number(a.terminal)||Number(Boolean(b.gap_analysis))-Number(Boolean(a.gap_analysis)))[0]??null;
  };
  const save=async(state:AgentResult)=>{
    if(state.fingerprint!==fingerprint)throw new Error("AGENT_CHECKPOINT_SCOPE_INVALID");
    await mkdir(root,{recursive:true,mode:0o700});
    // Hash the serialized representation (optional undefined keys disappear in JSON).
    const serialized=JSON.parse(JSON.stringify(state)) as AgentResult;
    const envelope=JSON.stringify({digest:analysisHash(serialized),state:serialized});
    // Keep an immutable journal as well as the latest checkpoint for crash recovery.
    await writeFile(join(root,`${Date.now()}-${randomUUID()}.json`),envelope,{mode:0o600,flag:"wx"});
    const old=await load();if(old&&old.snapshot.completed_rounds>state.snapshot.completed_rounds)return;
    const temp=join(root,`${randomUUID()}.tmp`);await writeFile(temp,envelope,{mode:0o600,flag:"wx"});await rename(temp,path);
  };
  return {load,save};
}
