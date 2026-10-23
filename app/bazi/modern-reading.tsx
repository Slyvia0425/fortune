import { useI18n } from "@/lib/i18n";
import type { EvidenceItem } from "@/lib/bazi/interpretation";
import type { ReadingState } from "./use-reading";
import styles from "./bazi-chart.module.css";

function References({ ids, evidence }: { ids: string[]; evidence: EvidenceItem[] }) {
  const { t } = useI18n();
  const cited = ids.map((id) => evidence.find((item) => item.id === id)).filter((item): item is EvidenceItem => Boolean(item));
  if (cited.length === 0) return null;
  return (
    <ul className={styles.readingRefs} aria-label={t("参考出处")}>
      {cited.map((item) => (
        <li key={item.id}>
          <span>{t("参考出处")}</span>
          「{item.quotation}」<cite>{item.source}</cite>
        </li>
      ))}
    </ul>
  );
}

/**
 * 现代解读: three paragraphs in everyday words. The first reads the pillars, the elements and the ten gods, the second refines it with the
 * strength and the useful and unfavourable elements, and the third looks at the three directions of this page on their bright side. A language model writes them and the server checks the answer against the engine's
 * conclusions; without a model the same three paragraphs come from templates, and the line at the foot says which one it is.
 */
export function ModernReading({ reading }: { reading: ReadingState }) {
  const { t } = useI18n();
  const { status, result } = reading;
  const waiting = status === "loading" || status === "idle";

  return (
    <div className={styles.readingCard} aria-live="polite">
      {result ? (
        <div className={`${styles.readingBody} ${waiting ? styles.readingStale : ""}`}>
          <h4 className={styles.readingLabel}>{t("命盘特征")}</h4>
          <p className={styles.readingPara}>{result.reading.part1}</p>
          <References ids={result.reading.part1_refs} evidence={result.evidence} />
          <h4 className={styles.readingLabel}>{t("强弱与用神")}</h4>
          <p className={styles.readingPara}>{result.reading.part2}</p>
          <References ids={result.reading.part2_refs} evidence={result.evidence} />
          <h4 className={styles.readingLabel}>{t("职业、学业与财运")}</h4>
          <p className={styles.readingPara}>{result.reading.part3}</p>
          <p className={styles.readingSource}>
            {waiting
              ? t("解读生成中…")
              : result.source === "llm"
                ? t("由语言模型（{model}）根据命盘结论撰写，并已核对与规则引擎的结论一致。", { model: result.model ?? "" })
                : result.reason === "failed"
                  ? t("模型的回答没有通过核对，回答由模块兜底逻辑生成。")
                  : result.reason === "rate_limited"
                    ? t("请求比较频繁，本次回答由模块兜底逻辑生成，稍后可以重新生成。")
                    : t("未连接语言模型，回答由模块兜底逻辑生成。")}{" "}
            <button type="button" className={styles.readingAgain} onClick={reading.regenerate} disabled={waiting}>
              {t("重新生成")}
            </button>
          </p>
        </div>
      ) : status === "error" ? (
        <p className={styles.readingSource}>
          {t("解读暂时没有生成。")}{" "}
          <button type="button" className={styles.readingAgain} onClick={reading.regenerate}>
            {t("重新生成")}
          </button>
        </p>
      ) : (
        <p className={styles.readingWait}>{t("解读生成中…")}</p>
      )}
    </div>
  );
}
