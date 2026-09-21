import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const dbPath=path.join(root,"data/knowledge_sources_complete/knowledge_sources_pages.json");
const rows=JSON.parse(fs.readFileSync(dbPath,"utf8"));
const corrupted=new Set([
  "https://ctext.org/wiki.pl?if=en&chapter=889452",
  "https://ctext.org/wiki.pl?if=en&chapter=801184",
  "https://ctext.org/wiki.pl?if=en&chapter=944578",
]);
const sources={
  ctext:["ctext","中国哲学书电子化计划","website"],
  "维基文库":["wikisource","维基文库","website"],
  YiMatrix:["yimatrix","YiMatrix易学资料库","website"],
  "vr-d.com PDF":["vr_d","VR-D电子文献库","pdf"],
  "项目文献库":["project_library","项目文献库","pdf"],
  "user-provided PDF":["project_library","项目文献库","pdf"],
  "luckclub.cn":["luckclub","LuckClub命理资料库","website"],
  "glwx.zhbc.com.cn":["zhbc","中华书局古联数据库","website"],
  "rcshm.snnu.edu.cn":["snnu","陕西师范大学学术平台","website"],
  "www.books.or.jp":["books_or_jp","日本出版书目数据库","bibliography"],
  "ndlsearch.ndl.go.jp":["ndl","日本国立国会图书馆","bibliography"],
};
const normalize=s=>String(s??"").normalize("NFKC").replace(/\r\n/g,"\n").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n").trim();
const classify=(heading,cats)=>{
  if(/白话|译文|translation/i.test(heading))return "translation";
  if(/现代|解读|研究|关键词|启示/i.test(heading))return "modern_commentary";
  if(/彖傳|彖传|象傳|象传|文言|繫辭|系辞|說卦|说卦|序卦|雜卦|杂卦|注|疏/.test(heading))return "commentary";
  return cats.includes("original")?"original":cats[0]??"original";
};
function blocks(content,cats){
  const lines=normalize(content).split("\n"),out=[];let heading="正文",buf=[];
  const flush=()=>{const text=buf.join("\n").trim();if(text)out.push({type:classify(heading,cats),heading,text});buf=[]};
  for(const line of lines){const m=line.match(/^#{1,4}\s+(.+)$/);if(m){flush();heading=m[1].trim()}else buf.push(line)}flush();return out;
}
function baseRow(r){
  const [source,source_name,source_type]=sources[r.source]??[r.source,r.source,"website"];
  const content=normalize(r.content),content_en=normalize(r.content_en)==="无"||!normalize(r.content_en)?null:normalize(r.content_en);
  const category=[...new Set(r.category)];
  return{url:r.url,title:normalize(r.title),source,source_name,source_type,catalog:normalize(r.catalog),category,content,content_en,content_blocks:blocks(content,category)};
}
function splitYuanhai(r){
  const text=normalize(r.content),parts=text.split(/(?=^###\s+)/m).filter(x=>x.trim());
  return parts.map((part,i)=>{const heading=part.match(/^###\s+(.+)$/m)?.[1]?.trim()||`第${i+1}部分`;const content=`# 渊海子平 · ${heading}\n\n${part.replace(/^###\s+.*\n?/m,"").trim()}`;const item={...r,title:`渊海子平 · ${heading}`,catalog:`${r.catalog} -> ${heading}`,url:`${r.url}#section-${i+1}`,content,content_en:null};item.content_blocks=blocks(content,item.category);return item});
}
function splitQiongtong(r){
  let text=normalize(r.content).replace(/^##\s+第\d+页\s*$/gm,"").replace(/^《》\s*$/gm,"").replace(/^》-\s*古籍典藏.*$/gm,"").replace(/^古籍典藏\s*·.*$/gm,"");
  const matches=[...text.matchAll(/^第\s*(\d+)\s*章\s*\n([^\n]+)/gm)];const out=[];
  for(let i=0;i<matches.length;i++){
    const num=matches[i][1],chapter=matches[i][2].trim(),start=matches[i].index,end=matches[i+1]?.index??text.length,body=text.slice(start,end).replace(/^第\s*\d+\s*章\s*\n[^\n]+\n?/,"").trim();
    const original=(body.match(/原\s*文\s*\n([\s\S]*?)(?=白话译文|白話譯文|$)/)?.[1]??"").trim();
    const translated=(body.match(/(?:白话译文|白話譯文)\s*\n([\s\S]*?)(?=\n---|\n关键词|\n關鍵詞|\n现代启示|\n現代啟示|$)/)?.[1]??"").trim();
    const modern=(body.match(/(?:关键词|關鍵詞|现代启示|現代啟示)[\s\S]*$/)?.[0]??"").trim();
    const segments=[
      ["original","原文",original],
      ["translation","白话译文",translated],
      ["modern_commentary","现代解释",modern],
    ].filter(([, ,content])=>content.length>20);
    if(!segments.length)segments.push(["original","正文",body]);
    for(const [type,label,section] of segments){const title=`穷通宝鉴 · 第${num}章 ${chapter} · ${label}`;const content=`# ${title}\n\n${section}`;out.push({...r,url:`/data/sources/qiongtong-baojian.pdf#chapter-${num}-${type}`,title,catalog:`明清 -> 八字命理 -> 穷通宝鉴 -> 第${num}章 -> ${chapter} -> ${label}`,category:[type],content,content_en:null,content_blocks:[{type,heading:label,text:section}]})}
  }
  return out;
}

let cleaned=[];
for(const raw of rows){
  if(corrupted.has(raw.url)||/网页目录/.test(raw.title)||raw.title==="子平真诠 - 目录")continue;
  const r=baseRow(raw);
  if(r.title==="渊海子平"&&r.content.length>50000){cleaned.push(...splitYuanhai(r));continue}
  if(r.title==="穷通宝鉴"&&r.content.length>100000){cleaned.push(...splitQiongtong(r));continue}
  cleaned.push(r);
}

const groups=new Map();
cleaned.forEach((r,i)=>{const key=`${r.title}|${r.catalog}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i)});
for(const indexes of groups.values())if(indexes.length>1){const distinctSources=new Set(indexes.map(i=>cleaned[i].source));indexes.forEach((idx,n)=>{const r=cleaned[idx];const suffix=distinctSources.size>1?`${r.source_name}版`:`第${n+1}部分`;r.title=`${r.title} · ${suffix}`;r.catalog=`${r.catalog} -> ${suffix}`})}

fs.writeFileSync(dbPath,JSON.stringify(cleaned,null,2)+"\n");
console.log(JSON.stringify({before:rows.length,after:cleaned.length,removedCorrupted:3,removedIndexes:9,splitRecords:cleaned.filter(x=>x.url.includes("#section-")||x.url.includes("qiongtong-baojian.pdf#chapter-")).length},null,2));
