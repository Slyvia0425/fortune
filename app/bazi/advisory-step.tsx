import { useState } from "react";
import type { AdvisoryDomain, BaziChartResult } from "@/lib/contracts/bazi";
import {
  DOMAIN_LABEL,
  ELEMENT_LABEL,
  PILLAR_LABEL,
  STEM_LABEL,
  TEN_GOD_GROUP_LABEL,
  TEN_GOD_LABEL,
} from "@/lib/bazi/display";
import styles from "./bazi-chart.module.css";

const DISPOSITION_TAG: Record<string, string> = {
  useful: "用神",
  unfavourable: "忌神",
  neutral: "",
};

/**
 * Domain tallies: how many of each ten-god group the chart holds, what the
 * texts say the group concerns, and where each occurrence sits.
 *
 * Deliberately without scores or ranking. An earlier draft weighted each group
 * (core +3, secondary +2) and ordered the domains by the total, but the texts
 * supply no such hierarchy, and totals were not comparable across domains while
 * sharing one 契合度 label. What remains is what a reader can check.
 */
export function AdvisoryStep({ chart, isMock }: { chart: BaziChartResult; isMock: boolean }) {
  const tallies = chart.domain_tallies;
  const [domainKey, setDomainKey] = useState<AdvisoryDomain>(tallies[0]?.domain ?? "career");
  const tally = tallies.find((t) => t.domain === domainKey) ?? tallies[0];

  return (
    <>
      <h2>命局倾向对照</h2>
      <p className="kicker">{isMock ? "模拟数据" : "对照结果"}</p>
      <p className={styles.subline}>
        以下列出典籍将各生活领域与哪些十神相关联，以及它们在本命局中出现的次数与位置。不排序、不评分，也不构成职业、教育或投资建议。
      </p>

      <div className={styles.carryOver}>
        <span className={styles.chipLabel}>承上（来自命局诊断）</span>
        <span>
          日主 {STEM_LABEL[chart.day_master.stem]}
          {ELEMENT_LABEL[chart.day_master.element]}
        </span>
        {chart.disposition.useful.length > 0 && (
          <span>用神 {chart.disposition.useful.map((e) => ELEMENT_LABEL[e]).join("、")}</span>
        )}
        {chart.disposition.unfavourable.length > 0 && (
          <span>忌神 {chart.disposition.unfavourable.map((e) => ELEMENT_LABEL[e]).join("、")}</span>
        )}
      </div>

      <div className={styles.tabs} role="tablist">
        {tallies.map((item) => (
          <button
            key={item.domain}
            type="button"
            role="tab"
            aria-selected={item.domain === domainKey}
            className={`${styles.tab} ${item.domain === domainKey ? styles.tabActive : ""}`}
            onClick={() => setDomainKey(item.domain)}
          >
            {DOMAIN_LABEL[item.domain]}
          </button>
        ))}
      </div>

      <div className={styles.tallyList} key={domainKey}>
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
                {DISPOSITION_TAG[group.disposition] && (
                  <span
                    className={`${styles.dispositionTag} ${
                      group.disposition === "useful" ? styles.dispositionUseful : ""
                    }`}
                  >
                    {DISPOSITION_TAG[group.disposition]}
                  </span>
                )}
                <span className={styles.entryGloss}>典籍称{group.gloss}</span>
              </div>

              {/* Plain language first, the classical passage after it: the
                  quotation is the evidence, not the explanation. */}
              <p className={styles.groupNarrative}>{group.narrative}</p>

              {group.quotation ? (
                <blockquote className={styles.quote}>
                  「{group.quotation}」
                  {source && (
                    <cite>
                      《{source.title}》{group.chapter ?? source.chapter ?? ""}
                    </cite>
                  )}
                </blockquote>
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

      <p className="panel-intro">{tally.narrative}</p>

      {chart.source_refs.length > 0 && (
        <p className={styles.legendNote}>
          参考文献：
          {chart.source_refs
            .map((ref) => [ref.title, ref.edition, ref.chapter].filter(Boolean).join(" · "))
            .join("；")}
        </p>
      )}
    </>
  );
}
