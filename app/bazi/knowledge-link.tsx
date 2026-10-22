import type { ReactNode } from "react";
import { knowledgeSourceHref, knowledgeTermHref } from "@/lib/bazi/knowledge-links";
import { useI18n } from "@/lib/i18n";
import styles from "./bazi-chart.module.css";

/**
 * One link to the source of a citation: the knowledge centre's page when it holds the text, the original web page
 * otherwise. Never both. A new tab, so the chart on show is not lost.
 */
export function SourceLink({ url, arrow = true }: { url: string | null | undefined; arrow?: boolean }) {
  const { t } = useI18n();
  const internal = knowledgeSourceHref(url);
  if (internal) {
    return (
      <a href={internal} target="_blank" rel="noreferrer">
        {t("在典籍中查看")}
        {arrow ? " ↗" : ""}
      </a>
    );
  }
  if (url?.startsWith("http")) {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        {t("查看原文")}
        {arrow ? " ↗" : ""}
      </a>
    );
  }
  return null;
}

/** A term that the knowledge centre explains, underlined so it reads as a link without shouting. */
export function TermLink({ term, children }: { term: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <a
      className={styles.termLink}
      href={knowledgeTermHref(term)}
      target="_blank"
      rel="noreferrer"
      title={t("在典籍中查看「{term}」", { term })}
    >
      {children}
    </a>
  );
}
