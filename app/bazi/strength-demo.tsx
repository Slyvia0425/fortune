import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BaziChartResult, EvidenceRef, StrengthFactor } from "@/lib/contracts/bazi";
import { FACTOR_LABEL, PILLAR_LABEL, QI_LABEL, STEM_LABEL, TEN_GOD_LABEL } from "@/lib/bazi/display";
import { chartCells, groupForElement } from "@/lib/bazi/structure";
import styles from "./bazi-chart.module.css";

/**
 * 命盘演示: the chart in a dialog, with the characters that one factor rests on lit up and joined to the day master by
 * dashed arrows. The five factors are the buttons on the right; the first one (得令) is shown on opening. The references
 * come from the engine's own evidence for each factor, so the dialog can only point at characters the chart has.
 */

/** The id of the element on the demo chart that a reference points at. */
function anchorId(ref: EvidenceRef): string {
  if (ref.position === "stem") return `${ref.pillar}-stem`;
  if (ref.position === "branch") return `${ref.pillar}-branch`;
  return `${ref.pillar}-hidden-${ref.qi}`;
}

type Box = { x: number; y: number; w: number; h: number };

/** Where the line from the centre of a box toward a point leaves the box. */
function edge(box: Box, toward: { x: number; y: number }, gap = 3): { x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  const scale = Math.min(
    dx === 0 ? Infinity : (box.w / 2 + gap) / Math.abs(dx),
    dy === 0 ? Infinity : (box.h / 2 + gap) / Math.abs(dy),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

interface Arrow {
  key: string;
  d: string;
}

/** Whether the day master is the one acting on what this reference names: 我生 (食伤) or 我克 (财). */
function dayMasterActsOn(chart: BaziChartResult, ref: EvidenceRef): boolean {
  const pillar = chart.pillars.find((p) => p.label === ref.pillar)!;
  const element =
    ref.position === "stem"
      ? pillar.element
      : ref.position === "hidden"
        ? pillar.hidden_stems.find((h) => h.qi === ref.qi)!.element
        : chartCells(chart.pillars).find((c) => c.id === `${ref.pillar}-branch`)!.element;
  const group = groupForElement(element, chart.day_master.element);
  return group === "output" || group === "wealth";
}

export function StrengthDemo({ chart, onClose }: { chart: BaziChartResult; onClose: () => void }) {
  const factors = chart.reasoning_trace.factors;
  const [activeKey, setActiveKey] = useState<string>(factors[0]?.key ?? "");
  const active: StrengthFactor | undefined = factors.find((f) => f.key === activeKey) ?? factors[0];
  const cells = chartCells(chart.pillars);
  const dayMasterId = cells.find((cell) => cell.isDayMaster)?.id ?? "day-stem";

  const board = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const targets = new Set((active?.evidence ?? []).map(anchorId));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const root = board.current;
    if (!root || !active) return;
    const measure = () => {
      const origin = root.getBoundingClientRect();
      const box = (id: string): Box | null => {
        const el = root.querySelector<HTMLElement>(`[data-anchor="${id}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
      };
      const to = box(dayMasterId);
      setSize({ w: origin.width, h: origin.height });
      if (!to) return setArrows([]);

      const next: Arrow[] = [];
      const evidence = active.evidence.filter((ref) => anchorId(ref) !== dayMasterId);
      const stemCount = evidence.filter((ref) => ref.position === "stem").length;
      let stemIndex = 0;
      for (const ref of evidence) {
        const id = anchorId(ref);
        const from = box(id);
        if (!from) continue;
        // The arrow runs the way the force runs: what the day master generates or overcomes (食伤、财) is acted on by it, so the arrow leaves
        // the day master; what generates, matches or overcomes the day master (印、比劫、官杀) points at it.
        const outward = dayMasterActsOn(chart, ref);

        if (ref.position === "stem") {
          // Two stems side by side leave a flat line with nowhere to go, so the arrow arches over the top of the row, between the
          // pillar names and the tiles, and drops in from above. Several arches meet the day master at slightly different points.
          const spread = (stemIndex++ - (stemCount - 1) / 2) * 24;
          const a = { x: from.x + from.w / 2, y: from.y };
          const b = { x: to.x + to.w / 2 + spread, y: to.y };
          const rise = 13 + Math.min(4, Math.abs(b.x - a.x) * 0.015);
          const [source, target] = outward ? [b, a] : [a, b];
          next.push({
            key: id,
            d: `M ${source.x} ${source.y - 3} C ${source.x} ${source.y - rise} ${target.x} ${target.y - rise} ${target.x} ${target.y - 6}`,
          });
          continue;
        }

        const a = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
        const b = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
        // Bow the line upward by how far it runs sideways (a line straight above or below needs none, and a bow there would put the
        // control point past the end of the line and turn the arrowhead around), so it does not run across the tiles between.
        const bow = Math.min(70, Math.abs(b.x - a.x) * 0.28);
        const control = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - bow };
        const [source, target, sourceGap, targetGap] = outward ? [to, from, 5, 3] : [from, to, 3, 5];
        const start = edge(source, control, sourceGap);
        const end = edge(target, control, targetGap);
        next.push({ key: id, d: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}` });
      }
      setArrows(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [active, chart, dayMasterId]);

  if (typeof document === "undefined" || !active) return null;

  return createPortal(
    <div className={styles.demoBackdrop} onClick={onClose}>
      <div
        className={`${styles.demoModal} ${styles.fade}`}
        role="dialog"
        aria-modal="true"
        aria-label="命盘演示"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.demoHead}>
          <h3>命盘演示</h3>
          <button type="button" className={styles.demoClose} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className={styles.demoBody}>
          <div className={styles.demoMain}>
            <div className={styles.demoBoard} ref={board}>
              {chart.pillars.map((pillar) => {
                const stem = cells.find((c) => c.id === `${pillar.label}-stem`)!;
                const branch = cells.find((c) => c.id === `${pillar.label}-branch`)!;
                const tile = (cell: typeof stem) => (
                  <div
                    className={`${styles.demoTile} ${styles.el}`}
                    data-element={cell.element}
                    data-anchor={cell.id}
                    data-lit={targets.has(cell.id)}
                    data-self={cell.id === dayMasterId}
                  >
                    <b>{cell.char}</b>
                    <small>{cell.isDayMaster ? "日主" : cell.tenGod ? TEN_GOD_LABEL[cell.tenGod] : ""}</small>
                  </div>
                );
                return (
                  <div key={pillar.label} className={styles.demoColumn}>
                    <span className={styles.demoLabel}>{PILLAR_LABEL[pillar.label]}</span>
                    {tile(stem)}
                    {tile(branch)}
                    <div className={styles.demoHidden}>
                      {pillar.hidden_stems.map((hidden) => (
                        <span
                          key={`${hidden.stem}-${hidden.qi}`}
                          className={styles.el}
                          data-element={hidden.element}
                          data-anchor={`${pillar.label}-hidden-${hidden.qi}`}
                          data-lit={targets.has(`${pillar.label}-hidden-${hidden.qi}`)}
                        >
                          {STEM_LABEL[hidden.stem]}
                          <small>{QI_LABEL[hidden.qi]}</small>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
              <svg className={styles.demoArrows} width={size.w} height={size.h} aria-hidden="true">
                <defs>
                  <marker id="demo-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 1 1 L 9 5 L 1 9 z" fill="var(--glow)" />
                  </marker>
                </defs>
                {arrows.map((arrow) => (
                  <path key={`${active.key}-${arrow.key}`} d={arrow.d} className={styles.demoArrow} markerEnd="url(#demo-head)" />
                ))}
              </svg>
            </div>

            <div className={styles.demoCaption} key={active.key}>
              <p>
                <b>{FACTOR_LABEL[active.key] ?? active.key}</b>
                {active.rule_text}
              </p>
              {active.evidence.length > 0 ? (
                <ul>
                  {active.evidence.map((ref, index) => (
                    <li key={`${anchorId(ref)}-${index}`}>{ref.description}</li>
                  ))}
                </ul>
              ) : (
                <p className={styles.demoNone}>本盘中没有符合的字，所以这一项没有箭头。</p>
              )}
            </div>
          </div>

          <div className={styles.demoTabs} role="tablist" aria-orientation="vertical">
            {factors.map((factor) => (
              <button
                key={factor.key}
                type="button"
                role="tab"
                aria-selected={factor.key === active.key}
                className={styles.demoTab}
                onClick={() => setActiveKey(factor.key)}
              >
                {FACTOR_LABEL[factor.key] ?? factor.key}
                <small>{factor.evidence.length > 0 ? `${factor.evidence.length} 处` : "无"}</small>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
