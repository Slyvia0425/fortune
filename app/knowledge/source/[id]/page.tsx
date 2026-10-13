import Link from "next/link";
import {notFound} from "next/navigation";
import {getKnowledgePageById} from "@/lib/knowledge/library";
import type {KnowledgeCategory} from "@/lib/contracts/knowledge";
import {CollectionBookmark,CollectionBookmarkProvider} from "../../collection-bookmarks";

const categoryLabel:Record<KnowledgeCategory,string>={original:"古籍原文",commentary:"古代注释",translation:"现代译文",modern_commentary:"现代研究"};
const sourceNames:Record<string,string>={ctext:"中国哲学书电子化计划",wikisource:"维基文库",yimatrix:"YiMatrix易学资料库",vr_d:"VR-D电子文献库",project_library:"项目文献库",luckclub:"LuckClub命理资料库",zhbc:"中华书局古联数据库",snnu:"陕西师范大学学术平台",books_or_jp:"日本出版书目数据库",ndl:"日本国立国会图书馆"};

type ContentBlock={type:KnowledgeCategory;heading:string;text:string};
type ReaderPart={kind:"title"|"contents"|"section"|"subsection"|"text";text:string};
const genericBlockHeading=/^(?:原文|正文|译文|今译|注释|古代注释|现代译文)$/;
const cleanMarkdown=(value:string)=>value
  .replace(/^\s*[-*+]\s+/,"")
  .replace(/^#{1,6}\s*/,"")
  .replace(/\*\*([^*]+)\*\*/g,"$1")
  .replace(/__([^_]+)__/g,"$1")
  .replace(/`([^`]+)`/g,"$1")
  .replace(/\[([^\]]+)\]\([^)]+\)/g,"$1")
  .trim();

function readableParagraphs(value:string){
  const clean=cleanMarkdown(value).replace(/\s*---\s*$/g,"").trim();
  if(!clean||genericBlockHeading.test(clean))return[];
  if(clean.length<=260)return[clean];
  const sentences=clean.match(/[^。！？；!?;]+[。！？；!?;]?/g)?.map(item=>item.trim()).filter(Boolean)??[clean];
  const result:string[]=[];let current="";
  for(const sentence of sentences){
    if(current&&current.length+sentence.length>220){result.push(current);current=""}
    if(sentence.length>280){
      if(current){result.push(current);current=""}
      for(let start=0;start<sentence.length;start+=220)result.push(sentence.slice(start,start+220));
    }else current+=sentence;
  }
  if(current)result.push(current);
  return result;
}

function fingerprint(value:string){let hash=2166136261;for(let index=0;index<value.length;index++){hash^=value.charCodeAt(index);hash=Math.imul(hash,16777619)}return`fnv1a-${(hash>>>0).toString(16).padStart(8,"0")}`}

function readerParts(content:string,title:string):ReaderPart[]{
  const paragraphs=content.split(/\n\s*\n/).map(value=>value.trim()).filter(Boolean);
  const normalized=paragraphs.map(value=>cleanMarkdown(value).replace(/\s+/g," "));
  const repeatedStart=normalized.findIndex((value,index)=>index>1&&normalized.slice(1,index).includes(value));
  const firstSubsection=paragraphs.findIndex((value,index)=>index>1&&/^[一二三四五六七八九十]+者(?:論|论)/.test(cleanMarkdown(value)));
  const contentsEnd=firstSubsection>2?firstSubsection-1:repeatedStart;
  const parts:ReaderPart[]=[];
  paragraphs.forEach((text,index)=>{
    const plain=cleanMarkdown(text);
    if(!plain||genericBlockHeading.test(plain))return;
    if(index===0&&(plain===cleanMarkdown(title)||text.startsWith("#"))){parts.push({kind:"title",text:plain});return}
    if(contentsEnd>1&&index>0&&index<contentsEnd){parts.push({kind:"contents",text:plain});return}
    if(index===contentsEnd){parts.push({kind:"section",text:plain});return}
    if(/^#{1,3}\s+/.test(text)||/^第[一二三四五六七八九十百〇零两]+(?:卷|篇|章|節|节|論|论)/.test(plain)){parts.push({kind:"section",text:plain});return}
    if(/^[一二三四五六七八九十]+者(?:論|论)/.test(plain)){parts.push({kind:"subsection",text:plain});return}
    readableParagraphs(text).forEach(paragraph=>parts.push({kind:"text",text:paragraph}));
  });
  return parts;
}

function ReaderText({content,title}:{content:string;title:string}){
  const parts=readerParts(content,title);
  return <div className="reader-content">{parts.map((part,index)=>{
    if(part.kind==="title")return <h2 className="reader-book-title" key={index}>{part.text}</h2>;
    if(part.kind==="contents"){
      const first=parts[index-1]?.kind!=="contents";
      return <div className={`reader-contents ${first?"reader-contents-first":""}`} key={index}>{first&&<strong>本卷提要 <small>CONTENTS</small></strong>}<p>{part.text}</p></div>;
    }
    if(part.kind==="section")return <h2 className="reader-section" key={index}>{part.text}</h2>;
    if(part.kind==="subsection")return <h3 className="reader-subsection" key={index}>{part.text}</h3>;
    return <p key={index}>{part.text}</p>;
  })}</div>;
}

function startsWithHeading(content:string,heading:string){
  const first=content.split(/\n\s*\n|\n/).map(cleanMarkdown).find(Boolean);
  return first===cleanMarkdown(heading);
}

export default async function SourceDetail({params}:{params:Promise<{id:string}>}){
  const{id}=await params;const item=getKnowledgePageById(decodeURIComponent(id));if(!item)notFound();
  const blocks=(item.content_blocks??[]) as ContentBlock[];
  const originals=blocks.filter(block=>block.type==="original");
  const notes=blocks.filter(block=>block.type!=="original");
  const hasEnglish=Boolean(item.content_en&&item.content_en!=="无");
  const detailUrl=`/knowledge/source/${encodeURIComponent(item.id)}`;
  return <CollectionBookmarkProvider><main className="knowledge-page detail-page"><section className="detail-hero"><div className="page-shell"><Link href="/knowledge" className="detail-back">← 返回知识中心</Link><p className="kicker">SOURCE DETAIL · 资料详情</p><h1>{item.title}</h1><p>{item.catalog}</p></div></section><section className="page-shell detail-layout"><article className="detail-document"><div className="detail-toolbar"><div className="detail-tags">{item.category.map(c=><span key={c}>{categoryLabel[c]}</span>)}</div><CollectionBookmark input={{sourceId:item.id,itemType:"knowledge_item",title:item.title,sourceUrl:detailUrl,checksum:fingerprint(JSON.stringify(item.content_blocks??item.content)),excerpt:item.catalog,sourceVersion:"knowledge-corpus-v2"}}/></div>{(notes.length>0||hasEnglish)&&<nav className="reader-jump-links" aria-label="本页注释与译文"><span>相关内容</span>{notes.map((block,index)=><a href={`#annotation-${index}`} key={`${block.type}-${index}`}>{categoryLabel[block.type]}{block.heading&&!genericBlockHeading.test(cleanMarkdown(block.heading))?` · ${cleanMarkdown(block.heading)}`:""}</a>)}{hasEnglish&&<a href="#english-text">英文文本</a>}</nav>}{originals.length?originals.map((block,index)=>{const heading=cleanMarkdown(block.heading||"");return <section className="reader-block" key={`${block.heading}-${index}`}>{heading&&!genericBlockHeading.test(heading)&&!startsWithHeading(block.text,heading)&&<h2 className="reader-section">{heading}</h2>}<ReaderText content={block.text} title={heading||item.title}/></section>}):<ReaderText content={item.content} title={item.title}/>} {notes.length>0&&<section className="reader-annotations"><header><span>ANNOTATIONS & TRANSLATIONS</span><h2>注释与译文</h2></header>{notes.map((block,index)=>{const heading=cleanMarkdown(block.heading||"");return <section id={`annotation-${index}`} className={`reader-note-block ${block.type}`} key={`${block.type}-${index}`}><div><span>{categoryLabel[block.type]}</span>{heading&&!genericBlockHeading.test(heading)&&<h3>{heading}</h3>}</div><ReaderText content={block.text} title={heading||item.title}/></section>})}</section>}{hasEnglish&&<section id="english-text" className="reader-annotations"><header><span>ENGLISH TEXT</span><h2>英文文本</h2></header><ReaderText content={item.content_en!} title="English Text"/></section>}</article><aside className="detail-meta"><span>资料信息</span><dl><div><dt>来源</dt><dd>{sourceNames[item.source]??item.source}</dd></div><div><dt>内容类型</dt><dd>{item.category.map(c=>categoryLabel[c]).join("、")}</dd></div><div><dt>资料编号</dt><dd>{item.id}</dd></div></dl><a href={item.url} target="_blank" rel="noreferrer">查看原始出处 ↗</a><p>引用时请回到原始来源核对完整上下文。</p></aside></section></main></CollectionBookmarkProvider>
}

