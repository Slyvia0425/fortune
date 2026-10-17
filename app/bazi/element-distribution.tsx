import { useState } from "react";
import type { BaziChartResult, ElementKey } from "@/lib/contracts/bazi";
import { ELEMENT_LABEL, STEM_LABEL } from "@/lib/bazi/display";
import { GENERATING_ORDER, GROUP_INFO, groupForElement } from "@/lib/bazi/structure";
import { ElementIcon } from "./element-icon";
import styles from "./bazi-chart.module.css";

// Donut geometry.
const DONUT_R = 72;
const DONUT_C = 2 * Math.PI * DONUT_R;
const SEGMENT_GAP = 3;

/** 五行分布: the engine's weighted element distribution as a ring. Hovering the ring lifts one element and dims the rest; the legend follows. */
export function ElementDistribution({ chart, delay }: { chart: BaziChartResult; delay: string }) {
  const dayMasterElement = chart.day_master.element;
  // The element the pointer (or keyboard focus, or a tap) is on in the distribution: it is lifted, the rest dim, and the centre reads it out.
  const [focusedElement, setFocusedElement] = useState<ElementKey | null>(null);

  const total = GENERATING_ORDER.reduce((sum, element) => sum + (chart.elements[element] ?? 0), 0);
  const maxValue = Math.max(...GENERATING_ORDER.map((element) => chart.elements[element] ?? 0), 1);
  const arcs = GENERATING_ORDER.map((element) => {
    const value = chart.elements[element] ?? 0;
    return { element, value, arc: total > 0 ? (value / total) * DONUT_C : 0 };
  });
  const segments = arcs.map((item, index) => ({
    element: item.element,
    value: item.value,
    start: arcs.slice(0, index).reduce((sum, previous) => sum + previous.arc, 0),
    length: Math.max(item.arc - SEGMENT_GAP, 0),
  }));

  const focused = focusedElement ? segments.find((segment) => segment.element === focusedElement) ?? null : null;
  const focusedInfo = focused ? GROUP_INFO[groupForElement(focused.element, dayMasterElement)] : null;
  /** Which element's segment the pointer is over, from where it is on the ring (so the gaps and dashes of the strokes do not matter). */
  const elementAt = (event: React.MouseEvent<HTMLDivElement>): ElementKey | null => {
    const box = event.currentTarget.getBoundingClientRect();
    const scale = box.width / 200;
    const dx = (event.clientX - box.left) / scale - 100;
    const dy = (event.clientY - box.top) / scale - 100;
    const radius = Math.hypot(dx, dy);
    if (radius < DONUT_R - 16 || radius > DONUT_R + 16 || total <= 0) return null;
    const along = (((Math.atan2(dy, dx) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)) * DONUT_C;     // from 12 o'clock, clockwise
    const hit = arcs.reduce<{ element: ElementKey; from: number } | null>((found, item, index) => {
      const from = arcs.slice(0, index).reduce((sum, previous) => sum + previous.arc, 0);
      return item.arc > 0 && along >= from && along < from + item.arc ? { element: item.element, from } : found;
    }, null);
    return hit ? hit.element : null;
  };
  const toggleFocus = (element: ElementKey) => setFocusedElement((current) => (current === element ? null : element));

  return (
    <section id="sec-distribution" className={`${styles.section} ${styles.rise}`} style={{ animationDelay: delay }}>
      <div className={styles.sectionHead}>
        <h3>五行分布</h3>
        <span>八个字各记一次（四个天干，四个地支的本气），各五行占全局的比例</span>
      </div>
      <div className={styles.donutRow}>
        <div
          className={styles.donut}
          onMouseMove={(event) => setFocusedElement(elementAt(event))}
          onMouseLeave={() => setFocusedElement(null)}
          onClick={(event) => {
            const element = elementAt(event);
            if (element) toggleFocus(element);
          }}
        >
          <svg width="200" height="200" viewBox="0 0 200 200" aria-hidden="true">
            <circle cx="100" cy="100" r={DONUT_R} fill="none" stroke="rgba(23,32,28,.07)" strokeWidth={24} />
            {segments
              .filter((segment) => segment.length > 0)
              .map((segment, index) => (
                <circle
                  key={segment.element}
                  className={`${styles.segment} ${styles.el} ${focusedElement === segment.element ? styles.segmentLifted : ""} ${focusedElement && focusedElement !== segment.element ? styles.dim : ""}`}
                  data-element={segment.element}

                  cx="100"
                  cy="100"
                  r={DONUT_R}
                  fill="none"
                  strokeWidth={24}
                  strokeDasharray={`${segment.length} ${DONUT_C}`}
                  strokeDashoffset={-segment.start}
                  transform="rotate(-90 100 100)"
                  style={{ animationDelay: `${150 + index * 180}ms` }}
                />
              ))}
          </svg>
          <div className={`${styles.donutCenter} ${styles.el}`} data-element={focused ? focused.element : dayMasterElement}>
            {focused && focusedInfo ? (
              <>
                <small>
                  {ELEMENT_LABEL[focused.element]} · {focusedInfo.label}
                </small>
                <strong>{total > 0 ? `${((focused.value / total) * 100).toFixed(1)}%` : "—"}</strong>
              </>
            ) : (
              <>
                <small>日主</small>
                <strong>
                  {STEM_LABEL[chart.day_master.stem]}
                  {ELEMENT_LABEL[dayMasterElement]}
                </strong>
              </>
            )}
          </div>
        </div>

        <div className={styles.legendGrid}>
          {segments.map((segment) => {
            const info = GROUP_INFO[groupForElement(segment.element, dayMasterElement)];
            return (
              <div
                key={segment.element}
                className={`${styles.legendRow} ${styles.el} ${focusedElement && focusedElement !== segment.element ? styles.dim : ""}`}
                data-element={segment.element}
              >
                <ElementIcon element={segment.element} size={17} />
                <strong>
                  {ELEMENT_LABEL[segment.element]}
                </strong>
                <span className={styles.groupText}>
                  {info.label} · {info.relation}
                </span>
                <div className={styles.barTrack}>
                  {segment.value > 0 && (
                    <div
                      className={`${styles.barFill} ${styles.grow}`}
                      style={{ width: `${(segment.value / maxValue) * 100}%` }}
                    />
                  )}
                </div>
                <span className={styles.pct}>
                  {total > 0 ? `${((segment.value / total) * 100).toFixed(1)}%` : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>

  );
}
