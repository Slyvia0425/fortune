import { createHash } from "node:crypto";

export function canonicalAnalysis(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonicalAnalysis).join(",")}]`;
  if(value&&typeof value==="object")return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonicalAnalysis(v)}`).join(",")}}`;
  return JSON.stringify(value)??"null";
}
export function analysisHash(value:unknown):string{return createHash("sha256").update(canonicalAnalysis(value)).digest("hex");}
export function freezeAnalysis<T>(value:T):T{
  if(value&&typeof value==="object"){Object.values(value).forEach(freezeAnalysis);Object.freeze(value);}return value;
}
