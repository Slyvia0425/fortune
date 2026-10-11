import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BaziChartRequest, BaziChartResult, TraceStep, TraceUse } from "@/lib/contracts/bazi";
import { booksOf, drawnEdges, layerSteps } from "@/lib/bazi/chain";
import { chainJson, chartMarkdown, exportName } from "@/lib/bazi/export";
import { ExportPreview, type ExportFile } from "./export-preview";
import styles from "./bazi-chart.module.css";

/**
 * 推导链路: the calculation trace the engine returns, drawn as a flow from the input down to the conclusions. Each box is one
 * calculation: it says in a line what it found and which books it drew on; opened, it shows the figures and every rule, table and
 * method it relied on, with the book, the chapter and the passage. The arrows are the engine's own: a box is joined to the boxes it
 * read from. The page draws what the engine wrote down; it adds no knowledge of its own, only where to look in the other steps.
 */

export type Navigate = (step: number, section?: string) => void;

/** Where a calculation can be seen in full on the other steps' pages. */
const SEE: Record<string, { step: number; section?: string; label: string }> = {
  timezone: { step: 2, label: "在排盘页查看" },
  solar_time: { step: 2, label: "在排盘页查看" },
  solar_term: { step: 2, label: "在排盘页查看" },
  pillars: { step: 2, label: "在排盘页查看" },
  luck: { step: 2, label: "在排盘页查看大运" },
  structure: { step: 3, section: "sec-relations", label: "在五行十神页查看" },
  elements: { step: 3, section: "sec-distribution", label: "在五行十神页查看" },
  factors: { step: 3, section: "sec-strength", label: "在判断依据查看" },
  strength: { step: 3, section: "sec-strength", label: "在判断依据查看" },
  pattern: { step: 3, section: "sec-strength", label: "在判断依据查看" },
  fuyi: { step: 3, section: "sec-yongshen", label: "在用神推导查看" },
  tiaohou: { step: 3, section: "sec-yongshen", label: "在用神推导查看" },
  pattern_yongshen: { step: 3, section: "sec-yongshen", label: "在用神推导查看" },
  arbitration: { step: 3, section: "sec-yongshen", label: "在用神推导查看" },
  result: { step: 3, section: "sec-yongshen", label: "在用神推导查看" },
  advisory: { step: 4, label: "在倾向对照页查看" },
};

const KIND_LABEL: Record<TraceUse["kind"], string> = { rule: "规则", table: "知识表", convention: "约定", method: "方法" };

function tagsOf(step: TraceStep): string[] {
  const kinds = new Set(step.uses.filter((use) => !use.source).map((use) => use.kind));
  return [...booksOf(step).map((book) => `《${book}》`), ...(kinds.has("method") ? ["计算方法"] : []), ...(kinds.has("convention") ? ["项目约定"] : []), ...(kinds.has("rule") && step.uses.some((u) => u.kind === "rule" && u.derived && !u.source) ? ["本项目形式化的规则"] : [])];
}

function UseBlock({ use }: { use: TraceUse }) {
  const source = use.source;
  return (
    <li className={styles.useBlock}>
      <div className={styles.useHead}>
        <span className={styles.useKind} data-kind={use.kind}>{KIND_LABEL[use.kind]}</span>
        {use.id && <code>{use.id}</code>}
        <strong>{use.title}</strong>
        {use.derived && <span className={styles.derivedMark}>本项目形式化</span>}
      </div>
      {use.detail && <p>{use.detail}</p>}
      {source && (
        <p className={styles.useSource}>
          《{source.book}》{source.chapter ? ` ${source.chapter}` : ""}
          {source.quotation && `　「${source.quotation}」`}
          {source.kb_url?.startsWith("http") && (
            <a href={source.kb_url} target="_blank" rel="noreferrer">查看原文 ↗</a>
          )}
        </p>
      )}
    </li>
  );
}

export function ChainStep({ chart, request, onNavigate }: { chart: BaziChartResult; request: BaziChartRequest; onNavigate: Navigate }) {
  const steps = chart.calculation_trace;
  const rows = useMemo(() => layerSteps(steps), [steps]);
  const number = new Map(rows.flat().map((id, index) => [id, index + 1]));        // numbered as they are laid out, top to bottom
  const byId = new Map(steps.map((step) => [step.id, step]));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [preview, setPreview] = useState<ExportFile | null>(null);
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // The arrows are drawn over the boxes' measured positions, from the bottom of the step read from to the top of the step that reads.
  const box = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<{ from: string; to: string; d: string }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    const measure = () => {
      const origin = root.getBoundingClientRect();
      const rect = (id: string) => root.querySelector<HTMLElement>(`[data-step="${id}"]`)?.getBoundingClientRect();
      const next: { from: string; to: string; d: string }[] = [];
      const rowOf = new Map(rows.flatMap((row, index) => row.map((id) => [id, index] as const)));
      for (const { from, to: toId } of drawnEdges(steps)) {
        // Only arrows between neighbouring rows are drawn; a step that reads from something further up says so in its "读自" line.
        if (rowOf.get(toId)! - rowOf.get(from)! > 1) continue;
        const a = rect(from);
        const to = rect(toId);
        if (!a || !to) continue;
        const x1 = a.left + a.width / 2 - origin.left;
        const y1 = a.bottom - origin.top;
        const x2 = to.left + to.width / 2 - origin.left;
        const y2 = to.top - origin.top - 4;
        const k = Math.max(14, (y2 - y1) / 2);
        next.push({ from, to: toId, d: `M ${x1} ${y1} C ${x1} ${y1 + k} ${x2} ${y2 - k} ${x2} ${y2}` });
      }
      setLines(next);
      setSize({ w: origin.width, h: origin.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [steps, rows, open]);

  return (
    <>
      <h2>推导链路</h2>
      <p className="kicker">从你输入的出生信息，到每一个结论</p>
      <p className={styles.subline}>
        每个方块是一次计算：读自哪些步骤、得出什么、依据哪条规则和哪本书。点开方块看数字和出处。箭头表示数据流向，指向读取它的那一步（窄屏不画箭头，每个方块都写明「读自」哪些步骤）。
      </p>

      <div className={styles.exportRow}>
        <span className={styles.chipLabel}>导出</span>
        <button type="button" className={styles.exportButton} onClick={() => setPreview({ name: exportName(chart, "chain", "json"), mime: "application/json", text: chainJson(chart, request) })}>
          推导链路（JSON）
        </button>
        <button type="button" className={styles.exportButton} onClick={() => setPreview({ name: exportName(chart, "chart", "md"), mime: "text/markdown", text: chartMarkdown(chart, request, new Date().toLocaleString("zh-CN", { hour12: false })) })}>
          全命盘信息（Markdown）
        </button>
      </div>
      {preview && <ExportPreview file={preview} onClose={() => setPreview(null)} />}

      <div className={styles.dag} ref={box}>
        <svg className={styles.dagEdges} width={size.w} height={size.h} aria-hidden="true">
          <defs>
            <marker id="dag-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 1 1 L 9 5 L 1 9 z" fill="currentColor" />
            </marker>
          </defs>
          {lines.map((line) => (
            <path key={`${line.from}>${line.to}`} d={line.d} markerEnd="url(#dag-head)" data-hot={active === line.from || active === line.to} />
          ))}
        </svg>

        {rows.map((row, index) => (
          <div key={index} className={styles.dagRow} style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`, maxWidth: row.length * 400 }}>
            {row.map((id) => {
              const step = byId.get(id)!;
              const isOpen = open.has(id);
              const see = SEE[id];
              const tags = tagsOf(step);
              return (
                <div
                  key={id}
                  data-step={id}
                  className={`${styles.dagNode} ${isOpen ? styles.dagNodeOpen : ""} ${styles.rise}`}
                  data-stage={step.stage}
                  style={isOpen ? { gridColumn: "1 / -1" } : undefined}        // an open box takes the whole row, so its details have room
                  onMouseEnter={() => setActive(id)}
                  onMouseLeave={() => setActive(null)}
                >
                  <button type="button" className={styles.dagHead} aria-expanded={isOpen} onClick={() => toggle(id)}>
                    <span className={styles.chainNo}>{number.get(id)}</span>
                    <span className={styles.chainTitle}>{step.title}</span>
                    <span className={styles.chainCaret} aria-hidden="true" />
                    <span className={isOpen ? styles.dagSummaryFull : styles.dagSummary}>{step.summary}</span>
                    {step.inputs.length > 0 && <span className={styles.dagFrom}>读自：{step.inputs.map((input) => byId.get(input)?.title).join("、")}</span>}
                    {tags.length > 0 && (
                      <span className={styles.chainKnowledge}>
                        {tags.map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </span>
                    )}
                  </button>
                  {isOpen && (
                    <div className={`${styles.chainDetail} ${styles.fade}`}>
                      {step.facts.length > 0 && (
                        <dl className={styles.chainFacts}>
                          {step.facts.map((fact) => (
                            <div key={fact.label} className={styles.factRow}>
                              <dt>{fact.label}</dt>
                              <dd>{fact.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {step.uses.length > 0 && (
                        <>
                          <h4 className={styles.usesTitle}>依据</h4>
                          <ul className={styles.uses}>
                            {step.uses.map((use, i) => (
                              <UseBlock key={`${use.id ?? use.title}-${i}`} use={use} />
                            ))}
                          </ul>
                        </>
                      )}
                      {see && (
                        <button type="button" className={styles.flowGo} onClick={() => onNavigate(see.step, see.section)}>
                          {see.label} →
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
