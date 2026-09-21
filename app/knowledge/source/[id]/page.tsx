import Link from "next/link";
import {notFound} from "next/navigation";
import {getKnowledgePageById} from "@/lib/knowledge/library";
import type {KnowledgeCategory} from "@/lib/contracts/knowledge";

const categoryLabel:Record<KnowledgeCategory,string>={original:"古籍原文",commentary:"古代注释",translation:"现代译文",modern_commentary:"现代研究"};
const sourceNames:Record<string,string>={ctext:"中国哲学书电子化计划",wikisource:"维基文库",yimatrix:"YiMatrix易学资料库",vr_d:"VR-D电子文献库",project_library:"项目文献库",luckclub:"LuckClub命理资料库",zhbc:"中华书局古联数据库",snnu:"陕西师范大学学术平台",books_or_jp:"日本出版书目数据库",ndl:"日本国立国会图书馆"};

export default async function SourceDetail({params}:{params:Promise<{id:string}>}){
  const{id}=await params;const item=getKnowledgePageById(decodeURIComponent(id));if(!item)notFound();
  const lines=item.content.split("\n").filter(Boolean);
  return <main className="knowledge-page detail-page"><section className="detail-hero"><div className="page-shell"><Link href="/knowledge" className="detail-back">← 返回知识中心</Link><p className="kicker">SOURCE DETAIL · 资料详情</p><h1>{item.title}</h1><p>{item.catalog}</p></div></section><section className="page-shell detail-layout"><article className="detail-document"><div className="detail-tags">{item.category.map(c=><span key={c}>{categoryLabel[c]}</span>)}</div><div className="reader-content">{lines.map((line,i)=>line.startsWith("#")?<h2 key={i}>{line.replace(/^#+\s*/,"")}</h2>:<p key={i}>{line.replace(/[*_`]/g,"")}</p>)}</div>{item.content_en&&<><hr/><h2>English Text</h2><div className="reader-content">{item.content_en.split("\n").filter(Boolean).map((line,i)=><p key={i}>{line.replace(/[*_`#]/g,"")}</p>)}</div></>}</article><aside className="detail-meta"><span>资料信息</span><dl><div><dt>来源</dt><dd>{sourceNames[item.source]??item.source}</dd></div><div><dt>内容类型</dt><dd>{item.category.map(c=>categoryLabel[c]).join("、")}</dd></div><div><dt>资料编号</dt><dd>{item.id}</dd></div></dl><a href={item.url} target="_blank" rel="noreferrer">查看原始出处 ↗</a><p>引用时请回到原始来源核对完整上下文。</p></aside></section></main>
}
