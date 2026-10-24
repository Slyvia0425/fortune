import type { DivinationInterpretationResult } from "@/lib/contracts/divination";
import styles from "./interpretation-panel.module.css";

export default function EnglishInterpretation({result}:{result:DivinationInterpretationResult}){
  const reading=result.english_reading;
  const modern=result.modern_interpretation??result.basic_interpretation;
  const citations=modern?.explainer?.citations??[];
  return <section className={styles.panel} aria-label="English interpretation">
    <header><p>I CHING READING</p><h3>Overall interpretation</h3><p>{result.basic_interpretation&&!result.modern_interpretation?"Basic textual reading. The full analysis is not yet complete.":"English translation of the original analysis. Translation does not cast a new hexagram."}</p></header>
    {reading?.status!=="ready"?<p role="status">The English translation is unavailable. Your original chart and analysis are saved. Use Retry translation below.</p>:([['summary','Summary'],['analysis','Analysis'],['advice','Practical advice']] as const).map(([key,title])=>{
      const paragraphs=reading.paragraphs.filter(p=>p.section===key);
      return paragraphs.length?<section key={key} className={styles.overall}><h4>{title}</h4>{paragraphs.map(p=><p key={p.id}>{p.text}{p.evidence_ids.map(id=>{const cite=citations.find(c=>c.evidence_id===id);return cite?<a key={id} href={`#english-evidence-${cite.number}`}> [{cite.number}]</a>:null;})}</p>)}</section>:null;
    })}
    <details><summary>Classical sources — original Chinese quotations</summary>{citations.map(c=><article key={c.evidence_id} id={`english-evidence-${c.number}`}><h4>[{c.number}] {c.title}</h4><small>{c.locator}</small><blockquote lang="zh">{c.quote}</blockquote>{c.url&&<a href={c.url} target="_blank" rel="noreferrer">Original source</a>}</article>)}{!citations.length&&result.evidence_pack.evidence.map(e=><blockquote key={e.evidence_id} lang="zh">{e.original}</blockquote>)}</details>
    <footer>For traditional cultural study and textual understanding. This reading is not medical, legal or investment advice.</footer>
  </section>;
}
