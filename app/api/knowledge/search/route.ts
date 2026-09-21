import {success} from "@/lib/contracts/api";
import type {KnowledgeCategory} from "@/lib/contracts/knowledge";
import {knowledgeStats,searchKnowledge} from "@/lib/knowledge/library";
export async function GET(request:Request){const p=new URL(request.url).searchParams;const q=p.get("q")?.trim().slice(0,100)??"";const category=(p.get("category")||undefined) as KnowledgeCategory|undefined;const source=p.get("source")||undefined;const result=searchKnowledge(q,18,category,source);return Response.json({...success(result,{system:"knowledge-search-v2",sources:result.map(x=>({source_id:x.id,title:x.title,url:x.url}))}),stats:knowledgeStats})}
