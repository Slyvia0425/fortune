import { useState } from "react";
import CollectionButton from "@/app/components/collection-button";
import type { BaziChartResult } from "@/lib/contracts/bazi";
import { BRANCH_LABEL, ELEMENT_LABEL, PILLAR_LABEL, QI_LABEL, STEM_LABEL, TEN_GOD_LABEL } from "@/lib/bazi/display";
import { cellNote, chartCells, GENERATING_ORDER, type ChartCell } from "@/lib/bazi/structure";
import { ElementIcon } from "./element-icon";
import styles from "./bazi-chart.module.css";

// Bar lengths only illustrate the primary/middle/residual ordering; they are
// not weights used anywhere in the calculation.
const QI_WIDTH = { primary: "100%", middle: "60%", residual: "30%" } as const;

const POLARITY_LABEL = { yang: "阳", yin: "阴" } as const;

function signed(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}

export function PillarsStep({
  chart,
  isMock,
  warnings,
  profileActivity,
  personName,
  sessionId,
}: {
  chart: BaziChartResult;
  isMock: boolean;
  warnings: string[];
  profileActivity: { profileId?: string; personName?: string; personRelation: string };
  personName: string;
  sessionId?: string | null;
}) {
  const cells = chartCells(chart.pillars);
  const dayMaster = cells.find((cell) => cell.isDayMaster) ?? cells[0];
  const [selectedId, setSelectedId] = useState(dayMaster.id);
  const [showCalib, setShowCalib] = useState(false);

  const selected = cells.find((cell) => cell.id === selectedId) ?? dayMaster;
  const note = cellNote(selected, dayMaster);
  const time = chart.resolved_time;

  function renderTile(cell: ChartCell) {
    const meta = cell.polarity
      ? `${POLARITY_LABEL[cell.polarity]}${ELEMENT_LABEL[cell.element]}`
      : `${ELEMENT_LABEL[cell.element]}${cell.isMonthBranch ? " · 月令" : ""}`;
    return (
      <button
        type="button"
        className={`${styles.tile} ${styles.el}`}
        data-element={cell.element}
        aria-pressed={cell.id === selected.id}
        aria-label={`${cell.position === "stem" ? "天干" : "地支"} ${cell.char}`}
        onClick={() => setSelectedId(cell.id)}
      >
        <span className={styles.tileChar}>{cell.char}</span>
        <span className={styles.tileMeta}>
          <ElementIcon element={cell.element} size={13} />
          {meta}
        </span>
      </button>
    );
  }

  return (
    <>
      <div className={styles.header}>
        <div>
          <h2>四柱排盘</h2>
          <p className="kicker">{isMock ? "模拟命盘" : "规则引擎计算结果"}</p>
          <p className={styles.subline}>
            日主 {STEM_LABEL[chart.day_master.stem]}
            {ELEMENT_LABEL[chart.day_master.element]}
          </p>
        </div>
        <button
          type="button"
          className={styles.calibButton}
          aria-expanded={showCalib}
          onClick={() => setShowCalib((open) => !open)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
            <circle cx="8" cy="8" r="6" />
            <path d="M8 4.8V8l2.2 1.6" />
          </svg>
          时间校准
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
          </svg>
        </button>
      </div>

      {warnings.map((warning) => (
        <p className="notice" key={warning}>
          {warning}
        </p>
      ))}

      {showCalib && (
        <div className={`${styles.calibStrip} ${styles.fade}`}>
          <span>
            {time.timezone}
            {time.timezone !== "UTC" &&
              `（UTC${time.utc_offset_minutes >= 0 ? "+" : "−"}${Math.abs(time.utc_offset_minutes / 60).toFixed(1)}）`}
            {time.dst_applied && " · 已计入夏令时"}
          </span>
          <span className={styles.arrow}>|</span>
          <span>民用时间 {time.civil_time}</span>
          <span className={styles.arrow}>→</span>
          <span>经度修正 {signed(time.longitude_correction_minutes)} 分</span>
          <span className={styles.arrow}>+</span>
          <span>均时差 {signed(time.equation_of_time_minutes)} 分</span>
          <span className={styles.arrow}>→</span>
          <strong>真太阳时 {time.true_solar_time}</strong>
          {time.crossed_pillar_boundary && <span className="notice">校正后跨越了时柱边界</span>}
        </div>
      )}

      <div className={styles.board}>
        <div className={styles.pillarGrid}>
          {chart.pillars.map((pillar, index) => {
            const stem = cells.find((cell) => cell.id === `${pillar.label}-stem`)!;
            const branch = cells.find((cell) => cell.id === `${pillar.label}-branch`)!;
            const isDay = pillar.label === "day";
            return (
              <div
                key={pillar.label}
                className={`${styles.pillarCard} ${isDay ? styles.pillarCardDay : ""} ${styles.rise}`}
                style={{ animationDelay: `${index * 90}ms` }}
              >
                <span className={`${styles.pillarLabel} ${isDay ? styles.pillarLabelDay : ""}`}>
                  {PILLAR_LABEL[pillar.label]}
                </span>
                <span className={`${styles.godPill} ${isDay ? styles.godPillDay : ""}`}>
                  {pillar.ten_god ? TEN_GOD_LABEL[pillar.ten_god] : "日主"}
                </span>
                {renderTile(stem)}
                {renderTile(branch)}
                <div className={styles.hiddenList}>
                  {pillar.hidden_stems.map((hidden) => (
                    <div
                      key={`${hidden.stem}-${hidden.qi}`}
                      className={`${styles.hiddenRow} ${styles.el}`}
                      data-element={hidden.element}
                    >
                      <div>
                        <span>
                          <b>{STEM_LABEL[hidden.stem]}</b> {QI_LABEL[hidden.qi]}
                        </span>
                        <span>{TEN_GOD_LABEL[hidden.ten_god]}</span>
                      </div>
                      <div className={styles.qiTrack}>
                        <div className={`${styles.qiBar} ${styles.grow}`} style={{ width: QI_WIDTH[hidden.qi] }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <aside
          className={`${styles.aside} ${styles.el} ${styles.rise}`}
          data-element={selected.element}
          style={{ animationDelay: "360ms" }}
          aria-live="polite"
        >
          <span className="kicker">注释</span>
          {/* Keyed so the note fades in afresh each time the selection changes. */}
          <div key={selected.id} className={styles.fade} style={{ display: "grid", gap: 12 }}>
            <span className={styles.asideChar}>{selected.char}</span>
            <span className={styles.asideTitle}>{note.title}</span>
            <span className={styles.asidePlace}>{note.place}</span>
            <div className={styles.divider} />
            {note.relation && <span className={styles.asideRelation}>{note.relation}</span>}
            <p className={styles.asideBody}>{note.body}</p>
          </div>
          <span className={styles.asideHint}>点击命盘中任意一字，查看它在命局中的位置与关系。</span>
        </aside>
      </div>

      <div className={styles.legend}>
        <span>五行色标</span>
        {GENERATING_ORDER.map((element) => (
          <span key={element} className={styles.el} data-element={element}>
            <ElementIcon element={element} />
            {ELEMENT_LABEL[element]}
          </span>
        ))}
      </div>

      <p className="panel-intro" style={{ marginTop: 20 }}>
        {chart.overview}
      </p>

      <CollectionButton
        {...profileActivity}
        action="calculation"
        autoRecord
        evidence={chart.source_refs.map((ref) =>
          [ref.title, ref.edition, ref.chapter].filter(Boolean).join(" · "),
        )}
        itemType="bazi_record"
        label="收藏命盘"
        module="bazi"
        sourceId={`bazi-chart:${sessionId ?? "local"}`}
        step="pillars"
        summary={`${personName.trim() || "未命名人物"} · ${chart.pillars.map((pillar) => `${STEM_LABEL[pillar.stem]}${BRANCH_LABEL[pillar.branch]}`).join(" ")}。${chart.overview}`}
        tags={["八字", "四柱"]}
        title={`${personName.trim() || "未命名人物"} · 四柱命盘`}
        snapshot={{ pillars: chart.pillars, resolved_time: chart.resolved_time, source_refs: chart.source_refs }}
      />
    </>
  );
}
