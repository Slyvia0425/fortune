import { Fragment, useMemo, useState } from "react";
import type { BaziChartResult, ElementKey } from "@/lib/contracts/bazi";
import { ELEMENT_LABEL, TEN_GOD_GROUP_LABEL, TEN_GOD_LABEL } from "@/lib/bazi/display";
import { cycleFromDayMaster, GROUP_INFO, groupForElement, tenGodRanking, type TenGodGroup } from "@/lib/bazi/structure";
import { useI18n } from "@/lib/i18n";
import { engineText } from "@/lib/bazi/engine-text";
import styles from "./bazi-chart.module.css";

/**
 * 强弱排行: the ten gods ordered by how often they appear in the chart (visible and hidden stems, each counted once).
 * A count, not a judgement of strength or favour: the classics give no weights for it, so none are invented here.
 */
export function TenGodRanking({ chart }: { chart: BaziChartResult }) {
  const { t, locale } = useI18n();
  const dayMasterElement = chart.day_master.element;
  const ranking = useMemo(() => tenGodRanking(chart.pillars), [chart.pillars]);
  const elementOfGroup = useMemo(() => {
    const map = {} as Record<TenGodGroup, ElementKey>;
    for (const element of cycleFromDayMaster(dayMasterElement))
      map[groupForElement(element, dayMasterElement)] = element;
    return map;
  }, [dayMasterElement]);

  const distinctCounts = [...new Set(ranking.map((item) => item.count))];
  const total = ranking.reduce((sum, item) => sum + item.count, 0);
  const top = ranking[0].count;
  const [selectedGod, setSelectedGod] = useState(ranking[0].tenGod);
  const leaders = ranking.filter((item) => item.count === top && top > 0);

  return (
    <div className={styles.rankWrap}>
      <p className={styles.rankSummary}>
        {t("按各十神在命局中出现的次数排序（天干与藏干各计一次，共 {total} 处）。", { total })}
        {leaders.length > 0 && (
          <>
            {t("出现最多的是")} <b>{leaders.map((item) => t(TEN_GOD_LABEL[item.tenGod])).join("、")}</b>{t("，{top} 处。", { top })}
          </>
        )}
      </p>

      <div className={styles.rankList} role="group" aria-label={t("十神出现次数排行")}>
        {ranking.map((item, index) => {
          const element = elementOfGroup[item.group];
          const isSelected = item.tenGod === selectedGod;
          // Equal counts share a rank and the next count takes the next number (1, 1, 2, 2, 3 …).
          const rank = distinctCounts.indexOf(item.count) + 1;
          return (
            <Fragment key={item.tenGod}>
              <button
                type="button"
                className={`${styles.rankRow} ${styles.el} ${item.count === 0 ? styles.rankRowEmpty : ""} ${isSelected ? styles.rankRowOn : ""}`}
                data-element={element}
                aria-pressed={isSelected}
                onClick={() => setSelectedGod(item.tenGod)}
              >
                <span className={styles.rankNo}>{item.count > 0 ? rank : "–"}</span>
                <span className={styles.rankName}>
                  <b>{t(TEN_GOD_LABEL[item.tenGod])}</b>
                  <small>{t(TEN_GOD_GROUP_LABEL[item.group])}</small>
                </span>
                <span className={styles.rankTrack}>
                  {item.count > 0 && (
                    <span
                      className={styles.rankBar}
                      style={{
                        width: `${(item.count / top) * 100}%`,
                        animationDelay: `${index * 60}ms`,
                      }}
                    />
                  )}
                </span>
                <span className={styles.rankCount}>{item.count > 0 ? item.count : t("未见")}</span>
              </button>
              {isSelected && (
                <div className={`${styles.rankDetail} ${styles.el}`} data-element={element} aria-live="polite">
                  <div className={styles.fade} style={{ display: "grid", gap: 10 }}>
                    <div className={styles.groupNoteHead}>
                      <b>{t(ELEMENT_LABEL[element])}</b>
                      <strong>{t(TEN_GOD_LABEL[item.tenGod])}</strong>
                      <span>{t(GROUP_INFO[item.group].relation)}</span>
                    </div>
                    {item.positions.length > 0 ? (
                      <ul className={styles.positionList}>
                        {item.positions.map((position) => (
                          <li key={position}>{engineText(position, locale, t)}</li>
                        ))}
                      </ul>
                    ) : (
                      <p style={{ margin: 0, color: "var(--muted)" }}>{t("命局中未见{name}。", { name: t(TEN_GOD_LABEL[item.tenGod]) })}</p>
                    )}
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
