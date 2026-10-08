import {failure,record,success,text} from "@/lib/contracts/api";
import {explainKnowledge} from "@/lib/knowledge/library";

function respond(query:string,sessionId?:string){
  if(!query)return failure("knowledge-explain-v1","VALIDATION_ERROR","请提供需要解释的术语。");
  const result=explainKnowledge(query);
  const warnings=result.evidence_status==="unsupported"?["当前知识库没有直接证据；如由LLM补充解释，必须标注为AI辅助解释。"]:[];
  return Response.json(success(result,{system:"knowledge-explain-v1",sessionId:sessionId||null,sources:result.evidence.map(x=>({source_id:x.source_id,title:x.title,chapter:x.catalog,url:x.url})),warnings,mock:false}));
}
export async function GET(request:Request){const p=new URL(request.url).searchParams;return respond(text(p.get("q"),100),text(p.get("session_id"),100));}
export async function POST(request:Request){let body:Record<string,unknown>|null=null;try{body=record(await request.json())}catch{}if(!body)return failure("knowledge-explain-v1","INVALID_JSON","请求体必须是JSON对象。");return respond(text(body.query,100)||text(body.term,100),text(body.session_id,100));}
