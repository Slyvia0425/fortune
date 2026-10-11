import type { BaziChartResult } from "@/lib/contracts/bazi";
import { ARBITRATION_LABEL, ELEMENT_LABEL, METHOD_LABEL } from "@/lib/bazi/display";
import styles from "./bazi-chart.module.css";

/** 用神推导: the two methods (扶抑, 调候) side by side with what each took, and the arbitration between them across the full width. */
export function YongshenDerivation({ chart, delay }: { chart: BaziChartResult; delay: string }) {
  const derivation = chart.derivation;
  const arbitration = derivation.arbitration;

  return (
    <section id="sec-yongshen" className={`${styles.section} ${styles.rise}`} style={{ animationDelay: delay }}>
      <div className={styles.sectionHead}>
        <h3>用神推导</h3>
        <span>扶抑与调候并行推导，结论冲突时按优先规则裁决</span>
      </div>

      <div className={styles.derivationGrid}>
        {derivation.methods.map((method) => {
          // A special pattern takes its own way of choosing 用神; the two methods are then shown for comparison only, unless the
          // pattern's books named none and the result fell back to this method's.
          const sameAsResult =
            method.useful.length === chart.disposition.useful.length &&
            method.useful.every((element) => chart.disposition.useful.includes(element));
          const adopted =
            arbitration.outcome === "other"
              ? sameAsResult
              : arbitration.outcome === method.method || arbitration.outcome === "both" || arbitration.outcome === "agree";
          const setAside = arbitration.outcome === "other" && !adopted;
          const source = method.source_id
            ? chart.source_refs.find((ref) => ref.source_id === method.source_id)
            : undefined;
          return (
            <div
              key={method.method}
              className={`${styles.methodCard} ${adopted ? styles.methodCardAdopted : ""}`}
            >
              <div className={styles.methodHead}>
                <strong>{METHOD_LABEL[method.method]}</strong>
                {adopted && <span className={styles.adoptedTag}>已采纳</span>}
                {setAside && <span className={styles.setAsideTag}>未采用</span>}
              </div>
              <p className={styles.methodBasis}>{method.basis}</p>
              {setAside && <p className={styles.methodNote}>特殊格局成立，改按格局自己的取法；这里是按常规推出的结果，仅供对照。</p>}
              <div className={styles.chipRow}>
                <span className={styles.chipLabel}>用神</span>
                {method.useful.map((element) => (
                  <span key={element} className={`${styles.chip} ${styles.el}`} data-element={element}>
                    {ELEMENT_LABEL[element]}
                  </span>
                ))}
              </div>
              {method.unfavourable && method.unfavourable.length > 0 && (
                <div className={styles.chipRow}>
                  <span className={styles.chipLabel}>忌神</span>
                  {method.unfavourable.map((element) => (
                    <span key={element} className={`${styles.chipMuted} ${styles.el}`} data-element={element}>
                      {ELEMENT_LABEL[element]}
                    </span>
                  ))}
                </div>
              )}
              {source && (
                <p className={styles.methodSource}>
                  <span>《{source.title}》{source.chapter ?? ""}</span>
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.arbitration}>
        <div className={styles.arbitrationHead}>
          <span className={styles.arbitrationTag}>
            {arbitration.outcome === "other" ? "特殊格局" : arbitration.conflict ? "结论冲突" : "结论一致"}
          </span>
          <strong>{ARBITRATION_LABEL[arbitration.outcome]}</strong>
        </div>
        <p className={styles.methodBasis}>{arbitration.rationale}</p>
        <div className={styles.chipRow}>
          <span className={styles.chipLabel}>用神</span>
          {chart.disposition.useful.map((element) => (
            <span key={element} className={`${styles.chip} ${styles.el}`} data-element={element}>
              {ELEMENT_LABEL[element]}
            </span>
          ))}
          <span className={styles.chipLabel} style={{ marginLeft: 16 }}>忌神</span>
          {chart.disposition.unfavourable.map((element) => (
            <span key={element} className={`${styles.chipMuted} ${styles.el}`} data-element={element}>
              {ELEMENT_LABEL[element]}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
