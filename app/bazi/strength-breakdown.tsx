import { useState } from "react";
import type { BaziChartResult, DayMasterStrength } from "@/lib/contracts/bazi";
import { FACTOR_LABEL, PATTERN_LABEL, STRENGTH_LABEL } from "@/lib/bazi/display";
import { contribution } from "@/lib/bazi/strength";
import { SourceLink } from "./knowledge-link";
import { StrengthDemo } from "./strength-demo";
import { engineText } from "@/lib/bazi/engine-text";
import styles from "./bazi-chart.module.css";
import { useI18n } from "@/lib/i18n";

const SCALE: DayMasterStrength[] = [
  "very_weak",
  "somewhat_weak",
  "somewhat_strong",
  "very_strong",
];

/** 日主强弱 · 判断依据: the five factors and what each adds to the weighted total, where that lands on the four strengths, and the special-pattern checks. */
export function StrengthBreakdown({ chart, delay }: { chart: BaziChartResult; delay: string }) {
  const { t, locale } = useI18n();
  // Which factor row is expanded; null when all are collapsed.
  const [openFactor, setOpenFactor] = useState<string | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const trace = chart.reasoning_trace;
  const override = trace.override;
  const checks = [
    ...(override && (override.triggered || !override.ruled_out.some((item) => item.pattern === override.pattern))
      ? [{ pattern: override.pattern, triggered: override.triggered, reason: override.rationale }]
      : []),
    ...(override?.ruled_out ?? []).map((item) => ({ ...item, triggered: false })),
  ];

  return (
    <section id="sec-strength" className={`${styles.section} ${styles.rise}`} style={{ animationDelay: delay }}>
      <div className={styles.sectionHead}>
        <h3>{t("日主强弱 · 判断依据")}</h3>
        {trace.sources.length > 0 && <span>{t("依据 {books}", { books: trace.sources.map((source) => `《${source.title}》`).join("") })}</span>}
      </div>

      <div className={styles.noteRow}>
        <p className={styles.sectionNote}>
          {t("每行为「因子程度（0–1）× 权重 = 贡献值」，各行相加即为加权合计。克泄耗是阻力、程度越高越不利，按「（1 − 程度）× 权重」计入。权重由标注案例调优得出，点击任一行查看依据与出处。")}
        </p>
        <button type="button" className={styles.demoButton} onClick={() => setDemoOpen(true)}>
          {t("命盘演示")}
        </button>
      </div>
      {demoOpen && <StrengthDemo chart={chart} onClose={() => setDemoOpen(false)} />}

      <div className={styles.factorList}>
        {trace.factors.map((factor) => {
          const open = openFactor === factor.key;
          const source = factor.source_id
            ? chart.source_refs.find((ref) => ref.source_id === factor.source_id)
            : undefined;
          const hasDetail = true;
          return (
            <div key={factor.key}>
              {/* The row itself is the control: clicking an item of evidence to
                  see where it came from needs no separate affordance. */}
              <button
                type="button"
                className={styles.factorRow}
                aria-expanded={open}
                disabled={!hasDetail}
                onClick={() => setOpenFactor(open ? null : factor.key)}
              >
                <b>{t(FACTOR_LABEL[factor.key]) ?? factor.key}</b>
                                  <div className={styles.factorTrack}>
                  <div
                    className={`${styles.factorFill} ${styles.grow}`}
                    style={{ width: `${Math.min(Math.max(factor.score, 0), 1) * 100}%` }}
                  />
                </div>
                <span className={styles.value}>
                  {contribution(factor).formula} = <b>{contribution(factor).value.toFixed(2)}</b>
                  {hasDetail && <i className={styles.caret} aria-hidden="true" />}
                </span>
              </button>
              {open && (
                <dl className={`${styles.factorDetail} ${styles.fade}`}>
                  <dt>{t("满足程度")}</dt>
                  <dd>
                    {factor.scale && factor.level !== null ? (
                      <>
                        <div className={styles.ladder} role="img"
                          aria-label={t("共 {n} 档，本盘为第 {k} 档「{label}」，得 {score}", { n: factor.scale.labels.length, k: factor.level + 1, label: factor.scale.labels[factor.level], score: factor.score })}>
                          {factor.scale.labels.map((label, index) => (
                            <div key={label} className={`${styles.rung} ${index === factor.level ? styles.rungOn : ""}`}>
                              <b>{label}</b>
                              <span>{factor.scale!.scores[index]}</span>
                            </div>
                          ))}
                        </div>
                        <span className={styles.ladderNote}>
                          {t("共 {n} 档，本盘为第 {k} 档「{label}」，得 {score}", { n: factor.scale.labels.length, k: factor.level + 1, label: factor.scale.labels[factor.level], score: factor.score })}
                          {factor.scale.derived && `。${t("档位顺序取自典籍。")}`}
                        </span>
                      </>
                    ) : (
                      <>
                        <div className={styles.ratioTrack} role="img" aria-label={String(factor.score)}>
                          <div className={styles.ratioFill} style={{ width: `${Math.min(Math.max(factor.score, 0), 1) * 100}%` }} />
                        </div>
                        <span className={styles.ladderNote}>{t("连续取值 0–1，不分档；本盘为 {score}", { score: factor.score })}</span>
                      </>
                    )}
                  </dd>
                  {factor.calculation && (
                    <>
                      <dt>{t("计算")}</dt>
                      <dd>{factor.calculation}</dd>
                    </>
                  )}
                  {(factor.rule_text || source || factor.chapter) && (
                    <>
                      <dt>{t("依据")}</dt>
                      <dd>
                        <div className={styles.basisCard}>
                          {(source || factor.chapter) && (
                            <div className={styles.basisHead}>
                              <span>
                                {source && `《${source.title}》`}
                                {[source?.edition, factor.chapter].filter(Boolean).join(" · ")}
                              </span>
                            </div>
                          )}
                          {factor.rule_text && (
                            <p className={styles.ruleText}>
                              {engineText(factor.rule_text, locale, t)}
                            </p>
                          )}
                          {(factor.quotation || factor.kb_url?.startsWith("http")) && (
                            <div className={styles.basisFoot}>
                              {factor.quotation && <span>“{factor.quotation}”</span>}
                              <SourceLink url={factor.kb_url} />
                            </div>
                          )}
                        </div>
                      </dd>
                    </>
                  )}
                  <dt>{t("合计贡献")}</dt>
                  <dd>
                    {contribution(factor).formula.replace("×", t("× 权重"))} = {contribution(factor).value.toFixed(2)}
                  </dd>
                </dl>
              )}
            </div>
          );
        })}
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}>
          <span>
            {t("加权合计")}
            {trace.near_balance && <span className="notice">　{t("接近平衡（强弱不明显），扶抑结论请谨慎参考")}</span>}
          </span>
          <strong>{trace.fused_score.toFixed(2)}</strong>
        </div>
        {/* Equal-width bands: the cuts are the design's, so the score is labelled on its band. */}
        <div className={styles.scale}>
          {SCALE.map((strength) => {
            const active = strength === trace.provisional_strength;
            return (
              <div key={strength} className={`${styles.scaleSeg} ${active ? styles.scaleSegActive : ""}`}>
                {active && <span className={`${styles.scaleChip} ${styles.fade}`}>{trace.fused_score.toFixed(2)}</span>}
                {t(STRENGTH_LABEL[strength])}
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.checkList}>
        <strong style={{ fontSize: 15 }}>{t("特殊格局检查")}</strong>
        {checks.length > 0 ? (
          checks.map((check) => (
            <div key={check.pattern} className={styles.checkRow}>
              <span className={`${styles.checkStatus} ${check.triggered ? styles.checkStatusOn : ""}`}>
                {check.triggered ? t("成立") : t("未成立")}
              </span>
              <strong>{t(PATTERN_LABEL[check.pattern])}</strong>
              <span>{engineText(check.reason, locale, t)}</span>
            </div>
          ))
        ) : (
          <span style={{ fontSize: 14, color: "var(--muted)" }}>{t("未发现需要特殊处理的格局，按常规判定。")}</span>
        )}
      </div>

      <div className={styles.verdict}>
        <span>{t("最终判定")}</span>
        <strong>{t(STRENGTH_LABEL[trace.final_strength])}</strong>
        <span>
          {override?.triggered
            ? t("因{pattern}成立，改按格局判定", { pattern: t(PATTERN_LABEL[override.pattern]) })
            : t("按常规多因子判定，未触发特殊格局")}
        </span>
      </div>
    </section>

  );
}
