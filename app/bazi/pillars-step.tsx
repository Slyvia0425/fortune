import { useEffect, useMemo, useRef, useState } from "react";
import type { BaziChartResult, ElementKey, EvidenceRef, TenGod } from "@/lib/contracts/bazi";
import { focusTileId, isFocusedHidden } from "@/lib/bazi/evidence";
import {
  BRANCH_LABEL,
  ELEMENT_LABEL,
  LUCK_DIRECTION_LABEL,
  PILLAR_LABEL,
  QI_LABEL,
  SOLAR_TERM_LABEL,
  STEM_LABEL,
  TEN_GOD_LABEL,
} from "@/lib/bazi/display";
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


interface TimelineItem {
  key: string;
  /** Line above the characters, e.g. "23 岁起" or "2026". */
  top: string;
  /** Line below, when there is one. */
  bottom?: string;
  stem: string;
  branch: string;
  stemElement: ElementKey;
  branchElement: ElementKey;
  stemTenGod: TenGod;
  branchTenGod: TenGod;
}

/**
 * One horizontally scrolling row of pillars.
 *
 * Selection and "now" are shown differently on purpose: the current period is
 * a fact about the calendar, the selection is something the reader did.
 */
function TimelineRow({
  title,
  note,
  items,
  selectedKey,
  currentKey,
  onSelect,
}: {
  title: string;
  note?: string;
  items: TimelineItem[];
  selectedKey: string;
  currentKey?: string;
  onSelect: (key: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  // Bring the selection into view when the row first renders or its contents
  // change — otherwise a row of eighty years opens on the wrong decade.
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>('[data-selected="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [selectedKey, items]);

  return (
    <div className={styles.timeline}>
      <div className={styles.timelineHead}>
        <span className={styles.timelineTitle}>{title}</span>
        {note && <span className={styles.timelineNote}>{note}</span>}
      </div>
      <div className={styles.timelineRow} ref={scroller}>
        {items.map((item) => {
          const selected = item.key === selectedKey;
          return (
            <button
              type="button"
              key={item.key}
              data-selected={selected}
              className={`${styles.luckCard} ${selected ? styles.luckCardCurrent : ""}`}
              aria-pressed={selected}
              onClick={() => onSelect(item.key)}
            >
              <small className={styles.luckAge}>{item.top}</small>
              {item.bottom && <small className={styles.luckYear}>{item.bottom}</small>}
              <span className={`${styles.luckChar} ${styles.el}`} data-element={item.stemElement}>
                <b>{item.stem}</b>
                <i>{TEN_GOD_LABEL[item.stemTenGod]}</i>
              </span>
              <span className={`${styles.luckChar} ${styles.el}`} data-element={item.branchElement}>
                <b>{item.branch}</b>
                <i>{TEN_GOD_LABEL[item.branchTenGod]}</i>
              </span>
              {item.key === currentKey && <span className={styles.luckNow}>当前</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PillarsStep({
  chart,
  isMock,
  warnings,
  focus = null,
}: {
  chart: BaziChartResult;
  isMock: boolean;
  warnings: string[];
  /** Arrived from an evidence reference: select and highlight that character.
   *  The parent re-mounts this step (changes its key) for each new reference. */
  focus?: EvidenceRef | null;
}) {
  const cells = chartCells(chart.pillars);
  const dayMaster = cells.find((cell) => cell.isDayMaster) ?? cells[0];
  const [selectedId, setSelectedId] = useState(focus ? focusTileId(focus) : dayMaster.id);
  const [showCalib, setShowCalib] = useState(false);

  const selected = cells.find((cell) => cell.id === selectedId) ?? dayMaster;
  const note = cellNote(selected, dayMaster);
  const time = chart.resolved_time;
  const term = chart.solar_term;
  const onset = chart.luck_onset;
  const thisYear = chart.current_period.year.year;

  const currentCycleKey =
    chart.luck_cycles.find((c) => thisYear >= c.start_year && thisYear <= c.end_year)?.start_year ??
    chart.luck_cycles[0]?.start_year;
  const [cycleKey, setCycleKey] = useState(String(currentCycleKey));
  const [yearKey, setYearKey] = useState(String(thisYear));

  const selectedCycle =
    chart.luck_cycles.find((c) => String(c.start_year) === cycleKey) ?? chart.luck_cycles[0];

  // Years of the selected cycle only; the full span would be eighty cards.
  const yearsOfCycle = useMemo(
    () =>
      chart.annual_cycles.filter(
        (a) => a.year >= selectedCycle.start_year && a.year <= selectedCycle.end_year,
      ),
    [chart.annual_cycles, selectedCycle],
  );

  function renderTile(cell: ChartCell) {
    const meta = cell.polarity
      ? `${POLARITY_LABEL[cell.polarity]}${ELEMENT_LABEL[cell.element]}`
      : `${ELEMENT_LABEL[cell.element]}${cell.isMonthBranch ? " · 月令" : ""}`;
    return (
      <button
        type="button"
        className={`${styles.tile} ${styles.el}`}
        data-element={cell.element}
        data-ref-focus={focus != null && focusTileId(focus) === cell.id && focus.position !== "hidden"}
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
          {time.crossed_pillar_boundary && <span className={styles.arrow}>|</span>}
          {time.crossed_pillar_boundary && <span className="notice">校正后跨越了时柱边界</span>}
          {/* The month pillar is set by a 节; some rules in 1.2 additionally
              split the month at its 中气, so the position within the term is
              shown, not just which month it is. */}
          <span className={styles.termRow}>
            节气：{SOLAR_TERM_LABEL[term.current_term]}后 {term.days_since_term.toFixed(1)} 天
            <span className={styles.arrow}>·</span>
            距{SOLAR_TERM_LABEL[term.next_term]} {term.days_to_next_term.toFixed(1)} 天
            <span className={styles.arrow}>·</span>
            月令取{SOLAR_TERM_LABEL[term.month_term]}
            {term.near_boundary && <span className="notice">　接近节气交界，结论对出生时刻较敏感</span>}
          </span>
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
                      data-ref-focus={isFocusedHidden(focus, pillar.label, hidden)}
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
        <p className={styles.legendNote}>
          藏干指地支中所藏的天干，按本气、中气、余气分主次：本气是该地支的主要之气，中气与余气依次为辅，条形长度示意这一主次关系。
        </p>
      </div>

      <p className="panel-intro" style={{ marginTop: 20 }}>
        {chart.overview}
      </p>

      {/* 大运：与四柱同属 1.1 的确定性计算，故并入本页；仅展示，不含吉凶判断 */}
      <section className={`${styles.luckBlock} ${styles.rise}`} style={{ animationDelay: "480ms" }}>
        <div className={styles.sectionHead}>
          <h3>大运</h3>
          <span>推算结果展示，不含有利与否的判断</span>
        </div>

        <p className={styles.legendNote}>
          起运 {onset.years} 岁{onset.months > 0 && ` ${onset.months} 个月`} ·{" "}
          {LUCK_DIRECTION_LABEL[onset.direction]}
          {onset.rationale && `　${onset.rationale}`}
        </p>

        <TimelineRow
          title="大运"
          items={chart.luck_cycles.map((cycle) => ({
            key: String(cycle.start_year),
            top: `${cycle.start_age} 岁起`,
            bottom: `${cycle.start_year}–${cycle.end_year}`,
            stem: STEM_LABEL[cycle.stem],
            branch: BRANCH_LABEL[cycle.branch],
            stemElement: cycle.stem_element,
            branchElement: cycle.branch_element,
            stemTenGod: cycle.stem_ten_god,
            branchTenGod: cycle.branch_ten_god,
          }))}
          selectedKey={cycleKey}
          currentKey={String(currentCycleKey)}
          onSelect={setCycleKey}
        />

        <TimelineRow
          title="流年"
          note={`${selectedCycle.start_year}–${selectedCycle.end_year}　随所选大运变化`}
          items={yearsOfCycle.map((year) => ({
            key: String(year.year),
            top: `${year.year}`,
            stem: STEM_LABEL[year.stem],
            branch: BRANCH_LABEL[year.branch],
            stemElement: year.stem_element,
            branchElement: year.branch_element,
            stemTenGod: year.stem_ten_god,
            branchTenGod: year.branch_ten_god,
          }))}
          selectedKey={yearKey}
          currentKey={String(thisYear)}
          onSelect={setYearKey}
        />

      </section>
    </>
  );
}
