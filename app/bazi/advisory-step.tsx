import { useState } from "react";
import type { AdvisoryDomain, BaziChartResult } from "@/lib/contracts/bazi";
import {
  DOMAIN_LABEL,
  PILLAR_LABEL,
  STEM_LABEL,
  TEN_GOD_GROUP_LABEL,
  TEN_GOD_LABEL,
} from "@/lib/bazi/display";
import styles from "./bazi-chart.module.css";

/**
 * 命局倾向对照: for each domain, which ten-god groups the chart holds and what the texts say of them,. Description only: no scores, no ranking, no advice. The
 * wording is the engine's own template text (the rule base's definitions and quotations, and the counts from the chart).
 */
export function AdvisoryStep({ chart }: { chart: BaziChartResult }) {
  return (
    <>
      <h2>命局倾向对照</h2>
      <p className="kicker">依据命局十神与典籍说法</p>
      <p className={styles.subline}>
        以下按职业、学业、财运三个方向，列出命局里相关的十神，以及典籍对它们的说法。只是说明，不排序、不评分，也不构成职业、教育或投资建议。
      </p>

      <Tallies chart={chart} />
    </>
  );
}

function Tallies({ chart }: { chart: BaziChartResult }) {
  const tallies = chart.domain_tallies;
  const [tab, setTab] = useState<AdvisoryDomain>(tallies[0]?.domain ?? "career");
  const tally = tallies.find((t) => t.domain === tab) ?? tallies[0];
  const citedIds = new Set(tallies.flatMap((t) => t.groups.map((g) => g.source_id)).filter(Boolean));
  const cited = chart.source_refs.filter((ref) => citedIds.has(ref.source_id));        // only the books this page quotes

  return (
    <>
      <div className={styles.tabs} role="tablist">
        {tallies.map((item) => (
          <button
            key={item.domain}
            type="button"
            role="tab"
            aria-selected={item.domain === tab}
            className={`${styles.tab} ${item.domain === tab ? styles.tabActive : ""}`}
            onClick={() => setTab(item.domain)}
          >
            {DOMAIN_LABEL[item.domain]}
          </button>
        ))}
      </div>

      <p className={`panel-intro ${styles.domainLead}`}>{tally.narrative}</p>

      <div className={styles.tallyList} key={tab}>
        {tally.groups.map((group, index) => {
          const source = group.source_id
            ? chart.source_refs.find((ref) => ref.source_id === group.source_id)
            : undefined;
          return (
            <section
              key={group.group}
              className={`${styles.tallyCard} ${group.count === 0 ? styles.tallyCardEmpty : ""} ${styles.rise}`}
              style={{ animationDelay: `${index * 80}ms` }}
            >
              <div className={styles.tallyHead}>
                {/* Category first, the ten-god group beside it: the category
                    names the association, the group is the evidence for it. */}
                <strong>{group.category}</strong>
                <span className={styles.groupTag}>
                  {TEN_GOD_GROUP_LABEL[group.group]}
                </span>
                <span className={styles.tallyCount}>{group.count} 处</span>
              </div>

              {/* Plain language first, the classical passage after it: the quotation is the evidence, not the explanation. */}
              <p className={styles.groupNarrative}>{group.narrative}</p>

              {group.quotation ? (
                <div className={`${styles.basisCard} ${styles.tallyBasis}`}>
                  {group.quotation_plain && <p className={styles.ruleText}>{group.quotation_plain}</p>}
                  <div className={group.quotation_plain ? styles.basisFoot : undefined}>
                    <span>「{group.quotation}」</span>
                    {source && (
                      <cite>
                        《{source.title}》{(group.chapter ?? source.chapter ?? "").replace(`${source.title} · `, "")}
                      </cite>
                    )}
                  </div>
                </div>
              ) : (
                <p className={styles.noQuote}>典籍未见相应的性情描述，此条为结构义，无引文。</p>
              )}

              <div className={styles.occurrenceRow}>
                <span className={styles.chipLabel}>命局中的位置</span>
                {group.occurrences.length === 0 && (
                  <span className={styles.chipLabel}>命局中未见</span>
                )}
                {group.occurrences.map((occ) => (
                  <span
                    key={`${occ.pillar}-${occ.position}-${occ.ten_god}`}
                    className={`${styles.occurrence} ${styles.el}`}
                    data-element={occ.element}
                  >
                    <small>
                      {PILLAR_LABEL[occ.pillar]}
                      {occ.position === "hidden" ? "藏干" : ""}
                    </small>
                    <b>{STEM_LABEL[occ.stem]}</b>
                    <small>{TEN_GOD_LABEL[occ.ten_god]}</small>
                  </span>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {cited.length > 0 && (
        <p className={styles.legendNote}>
          参考文献：
          {cited.map((ref) => [ref.title, ref.edition].filter(Boolean).join(" · ")).join("；")}
        </p>
      )}
    </>
  );
}
