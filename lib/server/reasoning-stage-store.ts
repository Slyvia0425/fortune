import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { analysisHash } from "../divination/analysis-utils";

export interface ReasoningStageStore {load:(stage:"reasoning"|"writing")=>Promise<unknown|null>;save:(stage:"reasoning"|"writing"|"diagnostic",value:unknown)=>Promise<void>}
export function reasoningStageStore(owner:string,key:string,directory=join(process.cwd(),".runtime","structured-reasoning")):ReasoningStageStore{
  const root=join(directory,analysisHash({owner,key}));
  return {
    async load(stage){
      try{
        const envelope=JSON.parse(await readFile(join(root,`${stage}.json`),"utf8"));
        if(envelope.key!==key||envelope.digest!==analysisHash(envelope.value))throw new Error("REASONING_CHECKPOINT_CORRUPT");
        return envelope.value;
      }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}
    },
    async save(stage,value){
      const serialized=JSON.parse(JSON.stringify(value));await mkdir(root,{recursive:true,mode:0o700});
      const path=join(root,`${stage}.json`),temp=join(root,`${stage}.${randomUUID()}.tmp`);
      await writeFile(temp,JSON.stringify({key,digest:analysisHash(serialized),value:serialized}),{mode:0o600,flag:"wx"});await rename(temp,path);
    },
  };
}
