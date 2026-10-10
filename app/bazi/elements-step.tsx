import { useState } from "react";
import CollectionButton from "@/app/components/collection-button";
import type { BaziChartResult, DayMasterStrength, ElementKey } from "@/lib/contracts/bazi";
import {
  ELEMENT_LABEL,
  FACTOR_LABEL,
  PATTERN_LABEL,
  STEM_LABEL,
  STRENGTH_LABEL,
} from "@/lib/bazi/display";
import {
  cycleFromDayMaster,
  GENERATING_ORDER,
  GROUP_INFO,
  groupForElement,
  tenGodPositions,
} from "@/lib/bazi/structure";
import { ElementIcon } from "./element-icon";
import styles from "./bazi-chart.module.css";

const SCALE: DayMasterStrength[] = [
  "very_weak",
  "somewhat_weak",
  "balanced",
  "somewhat_strong",
  "very_strong",
];

// Donut geometry.
const DONUT_R = 72;
const DONUT_C = 2 * Math.PI * DONUT_R;
const SEGMENT_GAP = 3;

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

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function ElementsStep({
  chart,
  isMock,
  profileActivity,
  personName,
  sessionId,
}: {
  chart: BaziChartResult;
  isMock: boolean;
  profileActivity: { profileId?: string; personName?: string; personRelation: string };
  personName: string;
  sessionId?: string | null;
}) {
  const dayMasterElement = chart.day_master.element;
  const positions = tenGodPositions(chart.pillars);

  // Relation diagram: day master's element at the top, the rest clockwise in
  // generating order, so 相生 always reads clockwise from the reader's anchor.
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

  // Donut: the engine's element distribution.
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

  const trace = chart.reasoning_trace;
  const override = trace.override;
  const checks = [
    ...(override && (override.triggered || !override.ruled_out.some((item) => item.pattern === override.pattern))
      ? [{ pattern: override.pattern, triggered: override.triggered, reason: override.rationale }]
      : []),
    ...(override?.ruled_out ?? []).map((item) => ({ ...item, triggered: false })),
  ];

  return (
    <>
      <h2>五行十神</h2>
      <p className="kicker">命局结构</p>
      <p className={styles.subline}>
        日主 {STEM_LABEL[chart.day_master.stem]}
        {ELEMENT_LABEL[dayMasterElement]} · 以下十神均相对日主而论
      </p>

      {/* ---- 五行分布 ---- */}
      <section className={`${styles.section} ${styles.rise}`}>
        <div className={styles.sectionHead}>
          <h3>五行分布</h3>
          <span>各五行在命局中的力量占比</span>
        </div>
        <div className={styles.donutRow}>
          <div className={styles.donut}>
            <svg width="200" height="200" viewBox="0 0 200 200" aria-hidden="true">
              <circle cx="100" cy="100" r={DONUT_R} fill="none" stroke="rgba(23,32,28,.07)" strokeWidth={24} />
              {segments
                .filter((segment) => segment.length > 0)
                .map((segment, index) => (
                  <circle
                    key={segment.element}
                    className={`${styles.segment} ${styles.el}`}
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
            <div className={`${styles.donutCenter} ${styles.el}`} data-element={dayMasterElement}>
              <small>日主</small>
              <strong>
                {STEM_LABEL[chart.day_master.stem]}
                {ELEMENT_LABEL[dayMasterElement]}
              </strong>
            </div>
          </div>

          <div className={styles.legendGrid}>
            {segments.map((segment) => {
              const info = GROUP_INFO[groupForElement(segment.element, dayMasterElement)];
              return (
                <div key={segment.element} className={`${styles.legendRow} ${styles.el}`} data-element={segment.element}>
                  <ElementIcon element={segment.element} size={17} />
                  <strong>{ELEMENT_LABEL[segment.element]}</strong>
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
                  <span className={styles.num}>{formatValue(segment.value)}</span>
                  <span className={styles.pct}>
                    {total > 0 ? `${((segment.value / total) * 100).toFixed(1)}%` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---- 五行与十神 ---- */}
      <section className={`${styles.section} ${styles.rise}`} style={{ animationDelay: "120ms" }}>
        <div className={styles.sectionHead}>
          <h3>五行与十神</h3>
          <span>点击任一五行，查看它在命局中对应的十神</span>
        </div>
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
                <small>日主</small>
                <strong>
                  {STEM_LABEL[chart.day_master.stem]}
                  {ELEMENT_LABEL[dayMasterElement]}
                </strong>
              </div>

              {cycle.map((node, index) => {
                const size = 56 + 10 * Math.min(node.count, 4);
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
                      aria-label={`${ELEMENT_LABEL[node.element]}，${info.label}，${node.count} 处`}
                      onClick={() => setSelectedElement(node.element)}
                      style={{ width: size, height: size, animationDelay: `${150 + index * 100}ms` }}
                    >
                      <span className={styles.nodeChar}>{ELEMENT_LABEL[node.element]}</span>
                      <span className={styles.nodeLabel}>
                        {info.label} · {node.count}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
            <div className={styles.cycleLegend}>
              <span>
                <i className={styles.lineSolid} />
                外圈相生（顺时针）
              </span>
              <span>
                <i className={styles.lineDashed} />
                内线相克
              </span>
            </div>
          </div>

          <div className={`${styles.groupNote} ${styles.el}`} data-element={selected.element} aria-live="polite">
            <span className="kicker">注释</span>
            <div key={selected.element} className={styles.fade} style={{ display: "grid", gap: 14 }}>
              <div className={styles.groupNoteHead}>
                <b>{ELEMENT_LABEL[selected.element]}</b>
                <strong>{selectedInfo.label}</strong>
                <span>{selectedInfo.relation}</span>
              </div>
              <p>
                {selectedInfo.definition}。{selectedInfo.polarityRule}。
              </p>
              <div className={styles.divider} />
              <strong>命局中出现的位置</strong>
              {positions[selected.group].length > 0 ? (
                <ul className={styles.positionList}>
                  {positions[selected.group].map((position) => (
                    <li key={position}>{position}</li>
                  ))}
                </ul>
              ) : (
                <p style={{ color: "var(--muted)" }}>命局中未见此类十神。</p>
              )}
              {selected.element === dayMasterElement && (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>
                  日主本身计入五行分布，但不计为十神。
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ---- 判断依据 —— 1.2 仲裁机制的可解释性展示 ---- */}
      <section className={`${styles.section} ${styles.rise}`} style={{ animationDelay: "240ms" }}>
        <div className={styles.sectionHead}>
          <h3>
            日主强弱 · 判断依据
            {isMock && <span className={styles.tag}>示例数值</span>}
          </h3>
          {trace.sources.length > 0 && <span>依据 {trace.sources.map((source) => `《${source.title}》`).join("")}</span>}
        </div>

        <div className={styles.factorList}>
          {trace.factors.map((factor) => (
            <div key={factor.key} className={styles.factorRow}>
              <b>{FACTOR_LABEL[factor.key] ?? factor.key}</b>
              <span className={styles.evidence}>{factor.evidence.join("；")}</span>
              <div className={styles.factorTrack}>
                <div
                  className={`${styles.factorFill} ${styles.grow}`}
                  style={{ width: `${Math.min(Math.max(factor.score, 0), 1) * 100}%` }}
                />
              </div>
              <span className={styles.value}>
                {factor.score} × {factor.weight} = <b>{factor.weighted_score.toFixed(2)}</b>
              </span>
            </div>
          ))}
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15 }}>
            <span>
              加权合计
              {trace.near_threshold && <span className="notice">　接近临界，建议人工复核</span>}
            </span>
            <strong>{trace.fused_score.toFixed(2)}</strong>
          </div>
          {/* Equal-width bands: the tuned thresholds aren't in the contract yet,
              so the score is labelled on its band rather than placed along a
              scale it may not be measured against. */}
          <div className={styles.scale}>
            {SCALE.map((strength) => {
              const active = strength === trace.provisional_strength;
              return (
                <div key={strength} className={`${styles.scaleSeg} ${active ? styles.scaleSegActive : ""}`}>
                  {active && <span className={`${styles.scaleChip} ${styles.fade}`}>{trace.fused_score.toFixed(2)}</span>}
                  {STRENGTH_LABEL[strength]}
                </div>
              );
            })}
          </div>
        </div>

        <div className={styles.checkList}>
          <strong style={{ fontSize: 15 }}>特殊格局检查</strong>
          {checks.length > 0 ? (
            checks.map((check) => (
              <div key={check.pattern} className={styles.checkRow}>
                <span className={`${styles.checkStatus} ${check.triggered ? styles.checkStatusOn : ""}`}>
                  {check.triggered ? "成立" : "未成立"}
                </span>
                <strong>{PATTERN_LABEL[check.pattern]}</strong>
                <span>{check.reason}</span>
              </div>
            ))
          ) : (
            <span style={{ fontSize: 14, color: "var(--muted)" }}>未发现需要特殊处理的格局，按常规判定。</span>
          )}
        </div>

        <div className={styles.verdict}>
          <span>最终判定</span>
          <strong>{STRENGTH_LABEL[trace.final_strength]}</strong>
          <span>
            {override?.triggered
              ? `因${PATTERN_LABEL[override.pattern]}成立，改按格局判定`
              : "按常规多因子判定，未触发特殊格局"}
            {chart.disposition.useful.length > 0 &&
              `　用神 ${chart.disposition.useful.map((element) => ELEMENT_LABEL[element]).join("、")}`}
            {chart.disposition.unfavourable.length > 0 &&
              `　忌神 ${chart.disposition.unfavourable.map((element) => ELEMENT_LABEL[element]).join("、")}`}
          </span>
        </div>
      </section>

      <CollectionButton
        {...profileActivity}
        action="interpretation"
        evidence={chart.reasoning_trace.factors.flatMap((factor) => factor.evidence)}
        itemType="bazi_analysis"
        label="收藏五行十神"
        module="bazi"
        sourceId={`bazi-elements:${sessionId ?? "local"}`}
        step="elements"
        summary={`${personName.trim() || "未命名人物"} · 五行分布 ${(Object.keys(chart.elements) as Array<keyof typeof chart.elements>).map((key) => `${ELEMENT_LABEL[key]} ${chart.elements[key]}`).join("，")}；日主 ${STEM_LABEL[chart.day_master.stem]}${ELEMENT_LABEL[chart.day_master.element]}。`}
        tags={["八字", "五行", "十神"]}
        title={`${personName.trim() || "未命名人物"} · 五行十神依据`}
        snapshot={{
          elements: chart.elements,
          day_master: chart.day_master,
          ten_gods: chart.ten_gods,
          reasoning_trace: chart.reasoning_trace,
        }}
      />
    </>
  );
}
