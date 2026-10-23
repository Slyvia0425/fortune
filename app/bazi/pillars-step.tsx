import { useMemo, useState } from "react";
import type { BaziChartResult, ElementKey, TenGod } from "@/lib/contracts/bazi";
import CollectionButton from "@/app/components/collection-button";
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
import {
  chartSourceId,
  dayMasterText,
  displayName,
  personKey,
  pillarText,
  sourceEvidence,
  type BaziProfileActivity,
} from "./profile-activity";
import { engineText, short } from "@/lib/bazi/engine-text";
import styles from "./bazi-chart.module.css";
import { useI18n } from "@/lib/i18n";

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
  const { t } = useI18n();
  return (
    <div className={styles.timeline}>
      <div className={styles.timelineHead}>
        <span className={styles.timelineTitle}>{title}</span>
        {note && <span className={styles.timelineNote}>{note}</span>}
      </div>
      <div className={styles.timelineRow}>
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
                <i>{short(t(TEN_GOD_LABEL[item.stemTenGod]))}</i>
              </span>
              <span className={`${styles.luckChar} ${styles.el}`} data-element={item.branchElement}>
                <b>{item.branch}</b>
                <i>{short(t(TEN_GOD_LABEL[item.branchTenGod]))}</i>
              </span>
              {item.key === currentKey && <span className={styles.luckNow}>{t("当前")}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PillarsStep({
  chart,
  warnings,
  profileActivity,
}: {
  chart: BaziChartResult;
  warnings: string[];
  profileActivity?: BaziProfileActivity;
}) {
  const { t, locale } = useI18n();
  const cells = chartCells(chart.pillars);
  const dayMaster = cells.find((cell) => cell.isDayMaster) ?? cells[0];
  const [selectedId, setSelectedId] = useState(dayMaster.id);
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
      ? t(`${POLARITY_LABEL[cell.polarity]}${ELEMENT_LABEL[cell.element]}`)
      : `${t(ELEMENT_LABEL[cell.element])}${cell.isMonthBranch ? ` · ${t("月令")}` : ""}`;
    return (
      <button
        type="button"
        className={`${styles.tile} ${styles.el}`}
        data-element={cell.element}
        aria-pressed={cell.id === selected.id}
        aria-label={`${t(cell.position === "stem" ? "天干" : "地支")} ${cell.char}`}
        onClick={() => setSelectedId(cell.id)}
      >
        <span className={styles.tileChar}>{cell.char}</span>
        <span className={styles.tileMeta}>
          <ElementIcon element={cell.element} size={13} />
          {/* Each part stays whole, so on a narrow tile the line breaks between parts ("木 ·" / "月令") rather than inside one. */}
          {meta.split(" · ").map((part, index, parts) => (
            <span key={part} className={styles.tileMetaPart}>
              {index < parts.length - 1 ? `${part} ·` : part}
            </span>
          ))}
        </span>
      </button>
    );
  }

  return (
    <>
      <div className={styles.header}>
        <div>
          <h2>{t("四柱排盘")}</h2>
          <p className="kicker">{t("规则引擎计算结果")}</p>
          <p className={styles.subline}>
            {t("日主")} {STEM_LABEL[chart.day_master.stem]}
            {locale === "en" ? " " : ""}
            {t(ELEMENT_LABEL[chart.day_master.element])}
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
          {t("时间校准")}
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
            {time.dst_applied && ` · ${t("已计入夏令时")}`}
          </span>
          <span className={styles.arrow}>|</span>
          <span>{t("民用时间")} {time.civil_time}</span>
          <span className={styles.arrow}>→</span>
          <span>{t("经度修正")} {t("{value} 分", { value: signed(time.longitude_correction_minutes) })}</span>
          <span className={styles.arrow}>+</span>
          <span>{t("均时差")} {t("{value} 分", { value: signed(time.equation_of_time_minutes) })}</span>
          <span className={styles.arrow}>→</span>
          <strong>{t("真太阳时")} {time.true_solar_time}</strong>
          {time.crossed_pillar_boundary && <span className={styles.arrow}>|</span>}
          {time.crossed_pillar_boundary && <span className="notice">{t("校正后跨越了时柱边界")}</span>}
          {/* The month pillar is set by a 节; some rules in 1.2 additionally
              split the month at its 中气, so the position within the term is
              shown, not just which month it is. */}
          <span className={styles.termRow}>
            {t("节气：{term}后 {days} 天", { term: t(SOLAR_TERM_LABEL[term.current_term]), days: term.days_since_term.toFixed(1) })}
            <span className={styles.arrow}>·</span>
            {t("距{term} {days} 天", { term: t(SOLAR_TERM_LABEL[term.next_term]), days: term.days_to_next_term.toFixed(1) })}
            <span className={styles.arrow}>·</span>
            {t("月令取{term}", { term: t(SOLAR_TERM_LABEL[term.month_term]) })}
            {term.near_boundary && <span className="notice">　{t("接近节气交界，结论对出生时刻较敏感")}</span>}
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
                  {t(PILLAR_LABEL[pillar.label])}
                </span>
                <span className={`${styles.godPill} ${isDay ? styles.godPillDay : ""}`}>
                  {pillar.ten_god ? short(t(TEN_GOD_LABEL[pillar.ten_god])) : t("日主")}
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
                          <b>{STEM_LABEL[hidden.stem]}</b> {short(t(QI_LABEL[hidden.qi]))}
                        </span>
                        <span>{short(t(TEN_GOD_LABEL[hidden.ten_god]))}</span>
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
          <span className="kicker">{t("注释")}</span>
          {/* Keyed so the note fades in afresh each time the selection changes. */}
          <div key={selected.id} className={styles.fade} style={{ display: "grid", gap: 12 }}>
            <span className={styles.asideChar}>{selected.char}</span>
            <span className={styles.asideTitle}>{engineText(note.title, locale, t)}</span>
            <span className={styles.asidePlace}>{engineText(note.place, locale, t)}</span>
            <div className={styles.divider} />
            {note.relation && <span className={styles.asideRelation}>{engineText(note.relation, locale, t)}</span>}
            <p className={styles.asideBody}>{engineText(note.body, locale, t)}</p>
          </div>
          <span className={styles.asideHint}>{t("点击命盘中任意一字，查看它在命局中的位置与关系。")}</span>
        </aside>
      </div>

      <div className={styles.legend}>
        <span>{t("五行色标")}</span>
        {GENERATING_ORDER.map((element) => (
          <span key={element} className={styles.el} data-element={element}>
            <ElementIcon element={element} />
            {t(ELEMENT_LABEL[element])}
          </span>
        ))}
        <p className={styles.legendNote}>
          {t("藏干指地支中所藏的天干，按本气、中气、余气分主次：本气是该地支的主要之气，中气与余气依次为辅，条形长度示意这一主次关系。")}
        </p>
      </div>

      {profileActivity ? (
        <div className={styles.collectRow}>
          {/* The chart itself is recorded automatically: the personal agent
              needs every chart a person has, not only the ones they remembered
              to bookmark. */}
          <CollectionButton
            {...profileActivity}
            action="calculation"
            autoRecord
            evidence={[
              `公历 ${time.true_solar_time}（真太阳时）`,
              `节气：${SOLAR_TERM_LABEL[term.current_term]}后 ${term.days_since_term.toFixed(1)} 天`,
              `起运 ${onset.years} 岁${onset.months > 0 ? ` ${onset.months} 个月` : ""} · ${LUCK_DIRECTION_LABEL[onset.direction]}`,
              ...sourceEvidence(chart),
            ]}
            itemType="bazi_record"
            label="收藏四柱"
            module="bazi"
            sourceId={`${chartSourceId(chart, personKey(profileActivity))}:pillars`}
            step="pillars"
            summary={`${displayName(profileActivity)} · 四柱 ${pillarText(chart)}；日主 ${dayMasterText(chart)}。`}
            tags={["八字", "四柱", "排盘"]}
            title={`${displayName(profileActivity)} · 八字命盘`}
            snapshot={{
              pillars: chart.pillars,
              resolved_time: chart.resolved_time,
              solar_term: chart.solar_term,
              luck_onset: chart.luck_onset,
              day_master: chart.day_master,
            }}
          />
        </div>
      ) : null}

      {/* 大运：与四柱同属 1.1 的确定性计算，故并入本页；仅展示，不含吉凶判断 */}
      <section className={`${styles.luckBlock} ${styles.rise}`} style={{ animationDelay: "480ms" }}>
        <div className={styles.sectionHead}>
          <h3>{t("大运")}</h3>
          <span>{t("推算结果展示，不含有利与否的判断")}</span>
        </div>

        <p className={styles.legendNote}>
          {onset.months > 0 ? t("起运 {years} 岁 {months} 个月", { years: onset.years, months: onset.months }) : t("起运 {years} 岁", { years: onset.years })} ·{" "}
          {t(LUCK_DIRECTION_LABEL[onset.direction])}
          {onset.rationale && `　${engineText(onset.rationale, locale, t)}`}
        </p>

        <TimelineRow
          title={t("大运")}
          items={chart.luck_cycles.map((cycle) => ({
            key: String(cycle.start_year),
            top: t("{age} 岁起", { age: cycle.start_age }),
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
          title={t("流年")}
          note={`${selectedCycle.start_year}–${selectedCycle.end_year}　${t("随所选大运变化")}`}
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

        {profileActivity ? (
          <div className={styles.collectRow}>
            <CollectionButton
              {...profileActivity}
              action="calculation"
              evidence={[
                `起运 ${onset.years} 岁${onset.months > 0 ? ` ${onset.months} 个月` : ""}，${LUCK_DIRECTION_LABEL[onset.direction]}`,
                ...chart.luck_cycles.map(
                  (cycle) =>
                    `${cycle.start_age}–${cycle.end_age} 岁（${cycle.start_year}–${cycle.end_year}）${STEM_LABEL[cycle.stem]}${BRANCH_LABEL[cycle.branch]}`,
                ),
              ]}
              itemType="bazi_luck"
              label="收藏大运流年"
              module="bazi"
              sourceId={`${chartSourceId(chart, personKey(profileActivity))}:luck`}
              step="luck-cycles"
              summary={`${displayName(profileActivity)} · 大运 ${chart.luck_cycles
                .map(
                  (cycle) =>
                    `${cycle.start_age}-${cycle.end_age} 岁 ${STEM_LABEL[cycle.stem]}${BRANCH_LABEL[cycle.branch]}`,
                )
                .join("；")}；当前 ${chart.current_period.year.year} 年 ${STEM_LABEL[chart.current_period.year.stem]}${BRANCH_LABEL[chart.current_period.year.branch]}。`}
              tags={["八字", "大运", "流年"]}
              title={`${displayName(profileActivity)} · 大运与流年`}
              snapshot={{
                luck_onset: chart.luck_onset,
                luck_cycles: chart.luck_cycles,
                annual_cycles: chart.annual_cycles,
                current_period: chart.current_period,
              }}
            />
          </div>
        ) : null}

      </section>
    </>
  );
}
