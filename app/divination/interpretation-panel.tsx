import type { DivinationInterpretationResult } from "@/lib/contracts/divination";
import styles from "./interpretation-panel.module.css";
import { useI18n } from "@/lib/i18n";

export default function InterpretationPanel({ result }: { result: DivinationInterpretationResult }) {
  const { t } = useI18n();
  const modern = result.modern_interpretation;
  const { primary, transformed, moving_lines: movingLines } = result.evidence_pack;
  const movingLabel = movingLines.length ? `第 ${movingLines.join("、")} 爻` : "无动爻";

  return <section className={styles.panel} aria-labelledby="interpretation-title">
    <header>
      <p>OVERALL INTERPRETATION</p>
      <h3 id="interpretation-title">{t("综合解释")}</h3>
      <span>{t("结合本次卦盘、古籍规则、参考案例与候选用神分析。")}</span>
    </header>
    <dl className={styles.structure}>
      <div><dt>{t("本卦")}</dt><dd>{primary.name}</dd></div>
      <div><dt>{t("上下卦")}</dt><dd>{primary.upper_trigram}上 · {primary.lower_trigram}下</dd></div>
      <div><dt>{t("五行关系")}</dt><dd>{primary.five_element_relation}</dd></div>
      <div><dt>{t("动爻")}</dt><dd>{movingLabel}</dd></div>
      <div><dt>{t("变卦")}</dt><dd>{transformed.name}</dd></div>
    </dl>
    <section className={styles.overall}>
      <h4>{t("综合解释")}</h4>
      <p>{modern?.overall_interpretation ?? "现代中文综合解释暂不可用；系统保留了本次卦象结构，稍后可重新请求解释。"}</p>
    </section>
    {modern?.uncertainties.length ? <section className={styles.uncertainties}><h4>{t("解读边界")}</h4><ul>{modern.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
    <details><summary>{t("卦爻辞原文与出处")}</summary>{result.evidence_pack.evidence.map(item => <article key={item.evidence_id}><h4>{item.hexagram_name}{item.line_position ? ` · 第 ${item.line_position} 爻` : " · 卦辞"}</h4><blockquote>{item.original}</blockquote><p>{item.source_ids.map(id => result.evidence_pack.sources.find(source => source.source_id === id)?.title ?? id).join("、")}</p></article>)}</details>
    <footer>{modern?.disclaimer ?? "本解释仅用于传统文化学习与文本理解，不构成医疗、法律、投资或其他现实决策建议。"}</footer>
  </section>;
}
