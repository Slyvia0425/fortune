import { useState, type CSSProperties } from "react";
import type { BaziChartResult, ElementKey } from "@/lib/contracts/bazi";
import { ELEMENT_LABEL, STEM_LABEL } from "@/lib/bazi/display";
import { cycleFromDayMaster, GROUP_INFO, groupForElement, tenGodPositions } from "@/lib/bazi/structure";
import { BAZI_TERMS } from "@/lib/bazi/knowledge-links";
import { TermLink } from "./knowledge-link";
import { TenGodRanking } from "./ten-god-ranking";
import { engineText } from "@/lib/bazi/engine-text";
import styles from "./bazi-chart.module.css";
import { useI18n } from "@/lib/i18n";

// Relation diagram geometry, in viewBox units (400 × 380).
const VIEW_W = 400;
const VIEW_H = 380;
const CX = 200;
const CY = 195;
const RING = 130;

function onRing(angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: CX + RING * Math.cos(a), y: CY + RING * Math.sin(a) };
}

/** 五行与十神: the five elements as a ring of generation (outer) and overcoming (inner) around the day master; pick one to read its ten gods. */
export function TenGodRelations({ chart, delay }: { chart: BaziChartResult; delay: string }) {
  const { t, locale } = useI18n();
  const dayMasterElement = chart.day_master.element;
  const positions = tenGodPositions(chart.pillars);

  // Day master's element at the top, the rest clockwise in generating order, so 相生 always reads clockwise from the reader's anchor.
  const cycle = cycleFromDayMaster(dayMasterElement).map((element, index) => {
    const group = groupForElement(element, dayMasterElement);
    return {
      element,
      group,
      count: positions[group].length,
      ...onRing(-90 + index * 72),
    };
  });

  const busiest = [...cycle].sort((a, b) => b.count - a.count)[0];
  const [selectedElement, setSelectedElement] = useState<ElementKey>(busiest.element);
  const selected = cycle.find((node) => node.element === selectedElement) ?? cycle[0];
  const selectedInfo = GROUP_INFO[selected.group];
  const [view, setView] = useState<"info" | "ranking">("info");

  return (
    <section id="sec-relations" className={`${styles.section} ${styles.rise}`} style={{ animationDelay: delay }}>
      <div className={styles.sectionHead}>
        <h3>{t("五行与十神")}</h3>
        <span>{view === "info" ? t("点击任一五行，查看它在命局中对应的十神") : t("点击任一十神，查看它在命局中的位置")}</span>
      </div>
      <div className={styles.viewSwitch} role="tablist">
        {(
          [
            ["info", "基本信息"],
            ["ranking", "强弱排行"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            className={`${styles.viewTab} ${view === key ? styles.viewTabOn : ""}`}
            onClick={() => setView(key)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {view === "ranking" ? (
        <TenGodRanking chart={chart} />
      ) : (
      <div className={styles.relationGrid}>
        <div>
          <div className={styles.cycle}>
            <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} aria-hidden="true">
              <circle cx={CX} cy={CY} r={RING} fill="none" stroke="#b9c9bd" strokeWidth={1.5} />
              {/* Chevrons on the ring mark the clockwise 相生 direction. */}
              {cycle.map((_, index) => {
                const angle = -90 + index * 72 + 36;
                const point = onRing(angle);
                return (
                  <path
                    key={`chevron-${index}`}
                    d="M -4 -3.5 L 3 0 L -4 3.5"
                    fill="none"
                    stroke="#9fb5a5"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    transform={`translate(${point.x} ${point.y}) rotate(${angle + 90})`}
                  />
                );
              })}
              {/* 相克: each element controls the one two steps ahead. */}
              {cycle.map((node, index) => {
                const target = cycle[(index + 2) % 5];
                const touchesDayMaster = index === 0 || (index + 2) % 5 === 0;
                return (
                  <line
                    key={`control-${node.element}`}
                    x1={node.x}
                    y1={node.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={touchesDayMaster ? "#a79f8e" : "#d3cbbb"}
                    strokeWidth={1.3}
                    strokeDasharray="5 5"
                  />
                );
              })}
            </svg>

            <div className={`${styles.cycleCenter} ${styles.el}`} data-element={dayMasterElement}>
              <small>{t("日主")}</small>
              <strong>
                {STEM_LABEL[chart.day_master.stem]}
                {ELEMENT_LABEL[dayMasterElement]}
              </strong>
            </div>

            {cycle.map((node, index) => {
              const size = 68 + 7 * Math.min(node.count, 4);
              const info = GROUP_INFO[node.group];
              return (
                <div
                  key={node.element}
                  className={styles.nodeWrap}
                  style={{ left: `${(node.x / VIEW_W) * 100}%`, top: `${(node.y / VIEW_H) * 100}%` }}
                >
                  <button
                    type="button"
                    className={`${styles.node} ${node.count === 0 ? styles.nodeEmpty : ""} ${styles.el} ${styles.pop}`}
                    data-element={node.element}
                    aria-pressed={node.element === selected.element}
                    aria-label={`${t(ELEMENT_LABEL[node.element])}, ${t(info.label)}, ${t("{count} 处", { count: node.count })}`}
                    onClick={() => setSelectedElement(node.element)}
                    style={{ "--k": size / VIEW_W, animationDelay: `${150 + index * 100}ms` } as CSSProperties}
                  >
                    <span className={styles.nodeChar}>{ELEMENT_LABEL[node.element]}</span>
                    <span className={styles.nodeLabel}>
                      {t(info.label)} · {node.count}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          <div className={styles.cycleLegend}>
            <span>
              <i className={styles.lineSolid} />
              {t("外圈相生（顺时针）")}
            </span>
            <span>
              <i className={styles.lineDashed} />
              {t("内线相克")}
            </span>
          </div>
        </div>

        <div className={`${styles.groupNote} ${styles.el}`} data-element={selected.element} aria-live="polite">
          <span className="kicker">{t("注释")}</span>
          <div key={selected.element} className={styles.fade} style={{ display: "grid", gap: 14 }}>
            <div className={styles.groupNoteHead}>
              <b>{ELEMENT_LABEL[selected.element]}</b>
              <strong>
                <TermLink term={BAZI_TERMS.group[selected.group]}>{t(selectedInfo.label)}</TermLink>
              </strong>
              <span>{t(selectedInfo.relation)}</span>
            </div>
            <p>
              {t(selectedInfo.definition)}. {t(selectedInfo.polarityRule)}.
            </p>
            <div className={styles.divider} />
            <strong>{t("命局中出现的位置")}</strong>
            {positions[selected.group].length > 0 ? (
              <ul className={styles.positionList}>
                {positions[selected.group].map((position) => (
                  <li key={position}>{engineText(position, locale, t)}</li>
                ))}
              </ul>
            ) : (
              <p style={{ color: "var(--muted)" }}>{t("命局中未见此类十神。")}</p>
            )}
            {selected.element === dayMasterElement && (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>
                {t("日主本身计入五行分布，但不计为十神。")}
              </p>
            )}
          </div>
        </div>
      </div>
      )}
    </section>

  );
}
