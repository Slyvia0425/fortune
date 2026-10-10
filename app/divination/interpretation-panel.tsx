import type { DivinationInterpretationResult } from "@/lib/contracts/divination";
import HybridEvidencePanel from "./hybrid-evidence-panel";
import styles from "./interpretation-panel.module.css";

export default function InterpretationPanel({ result }: { result: DivinationInterpretationResult }) {
  const modern = result.modern_interpretation;
  const { primary, transformed, moving_lines: movingLines } = result.evidence_pack;
  const movingLabel = movingLines.length ? `第 ${movingLines.join("、")} 爻` : "无动爻";

  return <section className={styles.panel} aria-labelledby="interpretation-title">
    <header>
      <p>OVERALL INTERPRETATION</p>
      <h3 id="interpretation-title">总体解读</h3>
      <span>同一次冻结卦盘的规则依据与卦爻辞文本解读。</span>
    </header>
    <dl className={styles.structure}>
      <div><dt>本卦</dt><dd>{primary.name}</dd></div>
      <div><dt>上下卦</dt><dd>{primary.upper_trigram}上 · {primary.lower_trigram}下</dd></div>
      <div><dt>五行关系</dt><dd>{primary.five_element_relation}</dd></div>
      <div><dt>动爻</dt><dd>{movingLabel}</dd></div>
      <div><dt>变卦</dt><dd>{transformed.name}</dd></div>
    </dl>
    <HybridEvidencePanel result={result} />
    <section className={styles.overall}>
      <h4>卦爻辞文本解读</h4><p>以下为经典文本的现代转述，不替代六爻取用规则判断。</p>
      <p>{modern?.overall_interpretation ?? "现代中文总体解读暂不可用；系统保留了本次卦象结构，稍后可重新请求解释。"}</p>
    </section>
    {modern?.uncertainties.length ? <section className={styles.uncertainties}><h4>解读边界</h4><ul>{modern.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
    <details><summary>卦爻辞原文与出处</summary>{result.evidence_pack.evidence.map(item => <article key={item.evidence_id}><h4>{item.hexagram_name}{item.line_position ? ` · 第 ${item.line_position} 爻` : " · 卦辞"}</h4><blockquote>{item.original}</blockquote><p>{item.source_ids.map(id => result.evidence_pack.sources.find(source => source.source_id === id)?.title ?? id).join("、")}</p></article>)}</details>
    <footer>{modern?.disclaimer ?? "本解释仅用于传统文化学习与文本理解，不构成医疗、法律、投资或其他现实决策建议。"}</footer>
  </section>;
}
