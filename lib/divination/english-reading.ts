import type { DivinationInterpretationResult } from "../contracts/divination";

export interface ReadingParagraph { id: string; section: "summary" | "analysis" | "advice" | "limits"; text: string; evidence_ids: string[] }
export interface EnglishReading { status: "ready" | "unavailable"; paragraphs: ReadingParagraph[] }

/** Only presentation prose is translated. Facts, quotations and citation IDs stay untouched. */
export function readingParagraphs(result: DivinationInterpretationResult): ReadingParagraph[] {
  const modern=result.modern_interpretation??result.basic_interpretation;
  const report=modern?.explainer;
  const paragraphs:ReadingParagraph[]=[];
  const add=(section:ReadingParagraph["section"],text:string,evidence_ids:string[]=[])=>{
    if(text.trim())paragraphs.push({id:`p${paragraphs.length+1}`,section,text,evidence_ids});
  };
  if(report){
    for(const [key,section] of [["verdict","summary"],["analysis","analysis"],["advice","advice"]] as const)
      for(const id of report.sections[key]){const claim=report.claims.find(c=>c.claim_id===id);if(claim)add(section,claim.text,claim.evidence_ids);}
  }else if(modern)add("summary",modern.overall_interpretation);
  if(result.structured_reasoning){
    const r=result.structured_reasoning;
    for(const f of r.findings){
      add("analysis",`${f.observation}\n${f.interpretation}`,f.evidence_ids);
    }
    r.competing_views.forEach(v=>add("analysis",v.description));
  }
  return paragraphs;
}

export function validateEnglishReading(source:ReadingParagraph[], value:unknown):ReadingParagraph[]{
  const rows=(value as {paragraphs?:unknown})?.paragraphs;
  if(!Array.isArray(rows)||rows.length!==source.length)throw new Error("TRANSLATION_INCOMPLETE");
  return source.map((original,index)=>{
    const row=rows[index];
    if(!row||row.id!==original.id||typeof row.text!=="string"||!row.text.trim()||row.text.length>20000)throw new Error("TRANSLATION_INVALID");
    // Reject changed quantities. Semantic fidelity is also required by the translation prompt.
    const numbers=(text:string)=>(text.match(/\d+(?:\.\d+)?/g)??[]).sort().join(",");
    if(numbers(original.text)!==numbers(row.text)||!/\b[a-zA-Z]{2,}\b/.test(row.text))throw new Error("TRANSLATION_FACT_MISMATCH");
    return {...original,text:row.text};
  });
}
