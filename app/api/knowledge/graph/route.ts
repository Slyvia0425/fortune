import {failure,success} from "@/lib/contracts/api";
import {getKnowledgeGraph} from "@/lib/knowledge/library";
export async function GET(request:Request){const params=new URL(request.url).searchParams;const concept=params.get("concept")?.slice(0,50)||"五行";const depth=Number(params.get("depth")||2);const result=getKnowledgeGraph(concept,depth);if(!result)return failure("knowledge-graph-v3","CONCEPT_NOT_FOUND",`当前图谱尚未收录“${concept}”，系统不会回退到无关概念。`,{concept},404);return Response.json(success(result,{system:"knowledge-graph-v3",warnings:[],mock:false}))}
