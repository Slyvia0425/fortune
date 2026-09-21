import pages from "../../data/knowledge_sources_complete/knowledge_sources_pages.json";
import type {KnowledgeCategory,KnowledgeGraphEdge,KnowledgeGraphNode,KnowledgePeriodView} from "../contracts/knowledge";

type KnowledgePage={url:string;title:string;source:string;source_name?:string;source_type?:string;catalog:string;category:KnowledgeCategory[];content:string;content_en?:string|null;content_blocks?:Array<{type:KnowledgeCategory;heading:string;text:string}>};
const records=pages as KnowledgePage[];
const clean=(value:string)=>value.replace(/[#*`>|_\[\]]+/g," ").replace(/\s+/g," ").trim();
const stableId=(page:KnowledgePage,index:number)=>`${page.source.toLowerCase().replace(/\W+/g,"-")}-${index}`;

export function getKnowledgePageById(id:string){
  const index=records.findIndex((page,pageIndex)=>stableId(page,pageIndex)===id);
  if(index<0)return null;
  const page=records[index];
  return{id:stableId(page,index),...page};
}

export function searchKnowledge(query:string,limit=18,category?:KnowledgeCategory,source?:string){
  const terms=query.trim().toLowerCase().split(/[\s，。；、]+/).filter(Boolean);
  return records.map((page,index)=>{
    if(category&&!page.category.includes(category))return null;
    if(source&&source!=="all"&&page.source!==source)return null;
    const title=page.title.toLowerCase(),catalog=page.catalog.toLowerCase(),content=page.content.toLowerCase();
    const score=terms.length?terms.reduce((sum,t)=>sum+(title.includes(t)?24:0)+(catalog.includes(t)?10:0)+(content.split(t).length-1),0):1;
    if(score<=0)return null;
    return{id:stableId(page,index),title:page.title,source:page.source,catalog:page.catalog,category:page.category,excerpt:clean(page.content).slice(0,220)+(page.content.length>220?"…":""),content:page.content,content_en:page.content_en,url:page.url,score};
  }).filter((x):x is NonNullable<typeof x>=>Boolean(x)).sort((a,b)=>b.score-a.score).slice(0,limit);
}

const n=(id:string,label:string,type:KnowledgeGraphNode["type"],summary:string,sourceQuery=label):KnowledgeGraphNode=>({id,label,type,summary,sourceQuery});
const nodes:KnowledgeGraphNode[]=[
  n("yinyang","阴阳","foundation","用相对、互根和转化说明变化的两种状态。"),n("wuxing","五行","foundation","木、火、土、金、水五类动态关系，重点是相生、相克及其平衡。"),
  n("shengke","生克","foundation","五行之间相互促进或制约的两类基本关系。","五行 生克"),n("season","四时","foundation","春夏秋冬的时序变化，用于理解五行力量随季节改变。","四时 五行"),n("direction","方位","foundation","传统体系把五行、八卦与东南西北中建立对应。","五行 方位"),
  n("wood","木","foundation","五行之一，传统上与生发、东方和春季相联系。","木 五行"),n("fire","火","foundation","五行之一，传统上与炎上、南方和夏季相联系。","火 五行"),n("earth","土","foundation","五行之一，传统上与承载、中央和四季转换相联系。","土 五行"),n("metal","金","foundation","五行之一，传统上与收敛、西方和秋季相联系。","金 五行"),n("water","水","foundation","五行之一，传统上与润下、北方和冬季相联系。","水 五行"),
  n("tiangan","天干","foundation","甲至癸十个符号，与阴阳、五行结合，用于记录时间和表达属性。"),n("dizhi","地支","foundation","子至亥十二个符号，用于纪时，并关联月份、方位和五行。"),n("jiazi","六十甲子","foundation","十天干和十二地支依次相配形成的六十组组合。"),
  ...[["zi","子"],["chou","丑"],["yin","寅"],["mao","卯"],["chen","辰"],["si","巳"],["wu","午"],["wei","未"],["shen","申"],["you","酉"],["xu","戌"],["hai","亥"]].map(([id,label])=>n(id,label,"foundation",`十二地支之一；可继续查看其对应的时序、方位与五行关系。`,`地支 ${label}`)),
  n("sizhu","四柱","bazi","出生年、月、日、时分别用一组干支表示，合称四柱。"),n("nian","年柱","bazi","四柱中的第一柱，用干支表示出生年份。"),n("yue","月柱","bazi","四柱中的第二柱，与出生月份及月令相关。"),n("ri","日柱","bazi","四柱中的第三柱，其天干称为日主。"),n("shi","时柱","bazi","四柱中的第四柱，用干支表示出生时辰。"),n("rizhu","日主","bazi","出生日的天干，是整理命盘其他关系时的参照中心。"),n("shishen","十神","bazi","根据其他干支与日主的生克及阴阳关系形成的十类名称。"),n("wangshuai","旺衰","bazi","结合季节、根气与相互作用，描述五行力量的相对状态。"),n("yongshen","用神","bazi","传统命理中用于讨论命局平衡与取用方向的概念。"),n("dayun","大运流年","bazi","传统命理中用来组织不同时间阶段的符号体系。","大运 流年"),
  n("bagua","八卦","yijing","由三条阴阳爻组成的八种基本卦形。"),n("liushisi","六十四卦","yijing","两个八卦上下相叠形成的六十四种卦形。"),n("guaxiang","卦象","yijing","由阴爻和阳爻组合成的符号结构，用来表达变化情境。"),n("guaci","卦辞","yijing","附在一卦之下、说明全卦主题的经文。"),n("yaoci","爻辞","yijing","对应每一爻的文字，需要结合爻位和全卦语境阅读。"),n("bianyao","变爻","yijing","起卦后发生变化的爻，用于连接本卦与变卦。"),n("hugua","互卦","yijing","从本卦中间爻位重新组合得到的卦象。"),n("zhouyi","《周易》","text","由卦画、卦辞和爻辞构成的核心经典。","周易"),n("yizhuan","《易传》","text","解释《周易》经文的一组传统文献，包括彖传、象传等。","彖传 象传"),n("tuan","彖传","text","侧重解释卦名、卦义和卦辞。"),n("xiang","象传","text","从卦象和爻象出发解释经文。"),
];
const edges:KnowledgeGraphEdge[]=[
  {source:"yinyang",target:"wuxing",relation:"共同构成基础"},{source:"wuxing",target:"shengke",relation:"通过生克作用"},{source:"wuxing",target:"season",relation:"随四时变化"},{source:"wuxing",target:"direction",relation:"对应方位"},
  ...["wood","fire","earth","metal","water"].map(target=>({source:"wuxing",target,relation:"包含"})),{source:"wuxing",target:"tiangan",relation:"赋予属性"},{source:"wuxing",target:"dizhi",relation:"赋予属性"},{source:"wuxing",target:"wangshuai",relation:"比较力量"},
  {source:"tiangan",target:"jiazi",relation:"参与组合"},{source:"dizhi",target:"jiazi",relation:"参与组合"},{source:"tiangan",target:"sizhu",relation:"组成"},{source:"dizhi",target:"sizhu",relation:"组成"},
  ...["zi","chou","yin","mao","chen","si","wu","wei","shen","you","xu","hai"].map(target=>({source:"dizhi",target,relation:"包含"})),
  ...["nian","yue","ri","shi"].map(target=>({source:"sizhu",target,relation:"分为"})),{source:"ri",target:"rizhu",relation:"日干作为参照"},{source:"rizhu",target:"shishen",relation:"推导关系"},{source:"sizhu",target:"wangshuai",relation:"提供判断信息"},{source:"wangshuai",target:"yongshen",relation:"用于综合取用"},{source:"sizhu",target:"dayun",relation:"连接时间阶段"},
  {source:"yinyang",target:"bagua",relation:"阴阳爻构成"},{source:"bagua",target:"liushisi",relation:"上下相叠"},{source:"liushisi",target:"guaxiang",relation:"形成"},{source:"guaxiang",target:"guaci",relation:"对应"},{source:"guaxiang",target:"yaoci",relation:"包含六爻"},{source:"guaxiang",target:"bianyao",relation:"发生变化"},{source:"guaxiang",target:"hugua",relation:"内部重组"},{source:"zhouyi",target:"guaxiang",relation:"记载"},{source:"zhouyi",target:"guaci",relation:"记载"},{source:"zhouyi",target:"yaoci",relation:"记载"},{source:"yizhuan",target:"zhouyi",relation:"解释"},{source:"yizhuan",target:"tuan",relation:"包含"},{source:"yizhuan",target:"xiang",relation:"包含"},
];

function findNode(concept:string){const normalized=concept.trim().replace(/[《》]/g,"");return nodes.find(x=>x.label.replace(/[《》]/g,"")===normalized)||nodes.find(x=>x.label.includes(normalized)||normalized.includes(x.label.replace(/[《》]/g,"")))}
export function getKnowledgeGraph(concept="五行",depth=2){
  const matched=findNode(concept)??nodes.find(x=>x.id==="wuxing")!;const ids=new Set([matched.id]);let frontier=[matched.id];
  for(let level=0;level<Math.max(1,Math.min(depth,2));level++){const next:string[]=[];for(const edge of edges){if(frontier.includes(edge.source)&&!ids.has(edge.target)){ids.add(edge.target);next.push(edge.target)}if(frontier.includes(edge.target)&&!ids.has(edge.source)){ids.add(edge.source);next.push(edge.source)}}frontier=next}
  const selectedEdges=edges.filter(e=>ids.has(e.source)&&ids.has(e.target));return{center:matched.id,nodes:nodes.filter(x=>ids.has(x.id)),edges:selectedEdges};
}


const explanationAliases:Record<string,{term:string;explanation:string;search:string;related:string[]}>= {
  "犯冲":{term:"相冲",explanation:"“犯冲”是现代口语中的概括说法，传统资料通常使用“冲”“相冲”或“六冲”。它表示某些地支处在相对、相动的关系中，具体含义必须结合所属体系和上下文判断，不能单凭一个词断定吉凶。",search:"冲破",related:["地支","六冲","刑冲合害"]},
  "命硬":{term:"身强",explanation:"“命硬”是民间说法，并非严格统一的古典术语。命理资料更常从日主强弱、旺衰和整体结构讨论，不能直接等同于克亲或人生结果。",search:"日主 旺衰 身强",related:["日主","旺衰","格局"]},
  "缺五行":{term:"五行偏缺",explanation:"“缺五行”通常指命盘表面未出现某一五行，但传统分析还会考虑藏干、月令、旺衰和整体关系，因此不宜只按数量补某一种五行。",search:"五行 旺衰 藏干",related:["五行","旺衰","藏干"]},
  "本命年":{term:"值年",explanation:"“本命年”通常指当年地支与出生年地支相同。它属于时间对应关系，传统解释仍需结合具体干支与整体结构，不代表必然吉凶。",search:"流年 地支",related:["流年","地支","六十甲子"]}
};

export function explainKnowledge(query:string){
  const cleanQuery=query.trim().slice(0,100);const alias=explanationAliases[cleanQuery];
  const searchTerm=alias?.search??cleanQuery;const evidence=searchKnowledge(searchTerm,6);
  const graphMatch=nodes.find(node=>node.label.replace(/[《》]/g,"")===cleanQuery.replace(/[《》]/g,""));
  const status=alias?"normalized":evidence.length?"exact":"unsupported";
  const matchedTerm=alias?.term??(evidence.length?cleanQuery:null);
  const explanation=alias?.explanation??graphMatch?.summary??(evidence.length?`知识库已找到与“${cleanQuery}”直接相关的资料。该词的具体含义应结合下列原文和所属体系理解。`:`当前知识库没有找到“${cleanQuery}”的直接典籍依据。对话层可以生成通俗说明，但必须标注为AI辅助解释，并避免虚构出处。`);
  const related=alias?.related??(graphMatch?getKnowledgeGraph(graphMatch.label,1).nodes.filter(n=>n.id!==graphMatch.id).slice(0,8).map(n=>n.label):[]);
  return{query:cleanQuery,matched_term:matchedTerm,explanation,normalized_terms:alias?[alias.term,...alias.related]:matchedTerm?[matchedTerm]:[],evidence_status:status,confidence:alias?.term?0.86:evidence.length?0.9:0.2,needs_llm:!alias&&!graphMatch&&!evidence.length,related_concepts:related,evidence:evidence.map(item=>({source_id:item.id,title:item.title,catalog:item.catalog,category:item.category,excerpt:item.excerpt,url:item.url}))};
}

export function compareKnowledge(query:string){const matches=searchKnowledge(query,28),selected:typeof matches=[];for(const category of ["original","commentary","translation","modern_commentary"] as KnowledgeCategory[]){const item=matches.find(m=>m.category.includes(category)&&!selected.some(s=>s.id===m.id));if(item)selected.push(item)}for(const item of matches){if(selected.length>=6)break;if(!selected.some(s=>s.id===item.id))selected.push(item)}return selected}

const topicViews:Record<string,{overview:string;differences:string;periods:KnowledgePeriodView[]}>= {
  "乾":{overview:"“乾”最初是《周易》六十四卦之首，核心意象是天与刚健。后来的解释逐渐从占筮语句扩展为关于创造、秩序和君子修养的思想。",differences:"早期经文重在具体占断；《易传》把它提升为宇宙运行与人格修养；宋代以后义理学者更强调人的道德实践。",periods:[{period:"先秦经文",meaning:"以“元、亨、利、贞”和六爻变化呈现一件事情由潜藏、发展到过盛的过程。",focus:"卦辞、爻位与吉凶情境"},{period:"战国至汉代《易传》",meaning:"把乾解释为天道生生不息，并以“天行健”联系君子自强。",focus:"宇宙生成与人格修养"},{period:"宋代以后义理解释",meaning:"进一步讨论天理、性命与人的实践，使乾成为持续进德的象征。",focus:"义理与修养工夫"}]},
  "五行":{overview:"“五行”不是五种静止物质，而是木、火、土、金、水五类作用与变化方式。不同文献的差别主要在使用范围。",differences:"早期文献用于说明政事与自然秩序；汉代以后形成更完整的对应系统；命理文献则把它用于分析干支之间的生克与时令。",periods:[{period:"先秦至两汉",meaning:"用于归纳自然材料、季节变化和治理秩序。",focus:"分类与秩序"},{period:"汉唐系统化阶段",meaning:"与阴阳、方位、颜色、音律等建立成套对应。",focus:"宇宙对应体系"},{period:"宋元明清命理文献",meaning:"重点讨论五行在月份、干支与命局中的强弱和生克。",focus:"时令、旺衰与关系判断"}]},
  "阴阳":{overview:"“阴阳”用于描述相对而互相依存的两类状态。它不是简单的好坏对立，而是强调位置、变化和转化。",differences:"早期重视自然现象与变化规律；《易传》用阴阳解释卦爻变化；后世术数则把阴阳用于干支、五行和卦象分类。",periods:[{period:"早期思想",meaning:"从明暗、寒热、动静等现象概括相对关系。",focus:"自然变化"},{period:"《易传》体系",meaning:"以阴爻和阳爻的互动解释卦象变化。",focus:"象与变"},{period:"后世术数",meaning:"成为天干地支、五行和命理分类的共同属性。",focus:"规则化应用"}]},
};
export function summarizeComparison(query:string){const key=Object.keys(topicViews).find(k=>query.includes(k));if(key)return topicViews[key];return{overview:`“${query}”在不同资料中可能承担定义、解释和应用三种功能。以下先按文献时代和资料性质整理，再保留各自出处。`,differences:"原典通常提供概念最早的语境，古代注释负责解释字义和结构，现代译注更重视可读性。它们属于不同层次，不宜合并成唯一结论。",periods:[{period:"原典语境",meaning:"查看该词在经典原文中的具体位置和上下文。",focus:"原文含义"},{period:"古代注释",meaning:"查看历代注家如何解释原句、象义或规则。",focus:"传统解释"},{period:"现代整理",meaning:"通过校注、译文和研究说明理解版本差异。",focus:"现代阅读"}]}}

export const knowledgeStats={pages:records.length,sources:[...new Set(records.map(x=>x.source))],books:[...new Set(records.map(x=>x.catalog.split(" -> ")[0]||x.title))],categories:{original:records.filter(x=>x.category.includes("original")).length,commentary:records.filter(x=>x.category.includes("commentary")).length,translation:records.filter(x=>x.category.includes("translation")).length,modern_commentary:records.filter(x=>x.category.includes("modern_commentary")).length}};

