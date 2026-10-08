import type { DivinationInterpretationResult } from "@/lib/contracts/divination";
import styles from "./interpretation-panel.module.css";

const ROLE_LABEL = {
  primary_judgment: "本卦卦辞",
  primary_moving_line: "本卦动爻",
  transformed_judgment: "变卦卦辞",
  transformed_static_line: "变卦静爻",
  special_line: "乾坤用爻",
} as const;

export default function InterpretationPanel({ result }: { result: DivinationInterpretationResult }) {
  const modern = result.modern_interpretation;
  const sourceById = new Map(result.evidence_pack.sources.map((source) => [source.source_id, source]));
  return <section className={styles.panel} aria-labelledby="interpretation-title">
    <header><p>GROUNDED INTERPRETATION</p><h3 id="interpretation-title">典籍依据与现代转述</h3><span>{result.evidence_pack.selection_rule}</span></header>
    <div className={styles.evidenceList}>{result.evidence_pack.evidence.map((item) => {
      const reading = modern?.readings.find((entry) => entry.evidence_id === item.evidence_id);
      return <article className={styles.evidenceCard} key={item.evidence_id}>
        <div className={styles.evidenceMeta}><strong>{ROLE_LABEL[item.role]}</strong><span>{item.hexagram_name}{item.line_position ? ` · 第 ${item.line_position} 爻` : ""}</span><small>证据 {item.evidence_id}</small></div>
        <section><h4>原文</h4><blockquote>{item.original}</blockquote></section>
        <section><h4>传统注释</h4>{item.commentary.length ? item.commentary.map((text, index) => <p key={index}>{text}</p>) : <p className={styles.muted}>本地资料未附可核验注释。</p>}</section>
        {item.translation_en ? <details><summary>资料所附英文译文</summary><p lang="en">{item.translation_en}</p></details> : null}
        <section className={styles.modern}><h4>现代中文转述</h4><p>{reading?.modern_chinese ?? "LLM 暂不可用；为避免无依据扩写，本次只展示典籍证据。"}</p></section>
        <ul className={styles.sources}>{item.source_ids.map((id) => {const source=sourceById.get(id);return source ? <li key={id}>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : source.title}<small>{[source.edition, source.chapter, id].filter(Boolean).join(" · ")}</small></li> : null;})}</ul>
      </article>;
    })}</div>
    {modern?.contextual_reflections.length ? <section className={styles.reflections}><h4>结合问题的反思</h4>{modern.contextual_reflections.map((item, index) => <div key={index}><p>{item.text}</p><small>依据：{item.evidence_ids.join("、")}</small></div>)}</section> : null}
    {modern?.uncertainties.length ? <section className={styles.uncertainties}><h4>资料边界</h4><ul>{modern.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
    <footer>{modern?.disclaimer ?? "本解释仅用于传统文化学习与文本理解，不构成现实决策建议。"}</footer>
  </section>;
}
