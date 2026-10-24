"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiEnvelope } from "@/lib/contracts/api";
import type { DivinationCastResult, HexagramView } from "@/lib/contracts/divination";
import type { HexagramEvidenceResult } from "@/lib/contracts/knowledge";
import styles from "./hexagram-evolution.module.css";
import { divinationText } from "@/lib/divination/language";
import { useI18n } from "@/lib/i18n";

type NodeKey = "primary" | "mutual" | "transformed";
type Selection = { node: NodeKey; line?: number };
type ElementKey = "wood" | "fire" | "earth" | "metal" | "water";
type EvidenceState = {
  status: "loading" | "ready" | "missing";
  data: HexagramEvidenceResult | null;
  message?: string;
};

const TRIGRAMS: Record<string, { symbol: string; element: ElementKey; image: string }> = {
  乾: { symbol: "☰", element: "metal", image: "天" },
  兑: { symbol: "☱", element: "metal", image: "泽" },
  离: { symbol: "☲", element: "fire", image: "火" },
  震: { symbol: "☳", element: "wood", image: "雷" },
  巽: { symbol: "☴", element: "wood", image: "风" },
  坎: { symbol: "☵", element: "water", image: "水" },
  艮: { symbol: "☶", element: "earth", image: "山" },
  坤: { symbol: "☷", element: "earth", image: "地" },
};

const ELEMENT_LABEL: Record<ElementKey, string> = {
  wood: "木",
  fire: "火",
  earth: "土",
  metal: "金",
  water: "水",
};

const NODE_META: Record<NodeKey, { label: string; index: string; description: string }> = {
  primary: { label: "本卦", index: "01", description: "起卦所得的原始卦象，代表当前问题的基本结构。" },
  mutual: { label: "互卦", index: "02", description: "取本卦二三四爻为下卦、三四五爻为上卦，观察内在过程。" },
  transformed: { label: "变卦", index: "03", description: "将本卦动爻阴阳翻转后所得，呈现变化后的结构。" },
};

const LINE_NAME: Record<6 | 7 | 8 | 9, string> = {
  6: "老阴",
  7: "少阳",
  8: "少阴",
  9: "老阳",
};

function trigram(name: string) {
  return TRIGRAMS[name] ?? { symbol: "◇", element: "earth" as const, image: name };
}

function elementRelation(first: ElementKey, second: ElementKey) {
  if (first === second) return `${ELEMENT_LABEL[first]}气相承`;
  const generates: Record<ElementKey, ElementKey> = {
    wood: "fire",
    fire: "earth",
    earth: "metal",
    metal: "water",
    water: "wood",
  };
  const controls: Record<ElementKey, ElementKey> = {
    wood: "earth",
    earth: "water",
    water: "fire",
    fire: "metal",
    metal: "wood",
  };
  if (generates[first] === second) return `${ELEMENT_LABEL[first]}生${ELEMENT_LABEL[second]}`;
  if (generates[second] === first) return `${ELEMENT_LABEL[second]}生${ELEMENT_LABEL[first]}`;
  if (controls[first] === second) return `${ELEMENT_LABEL[first]}克${ELEMENT_LABEL[second]}`;
  return `${ELEMENT_LABEL[second]}克${ELEMENT_LABEL[first]}`;
}

function HexagramNode({
  kind,
  hexagram,
  movingLines,
  selection,
  onSelect,
}: {
  kind: NodeKey;
  hexagram: HexagramView;
  movingLines: number[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const {locale}=useI18n();
  const t=(text:string)=>divinationText(locale,text);
  const meta = NODE_META[kind];
  const upper = trigram(hexagram.upper_trigram);
  const lower = trigram(hexagram.lower_trigram);
  const displayLines = hexagram.lines
    .map((value, index) => ({ value, position: index + 1 }))
    .reverse();

  return (
    <article
      className={`${styles.node} ${selection.node === kind ? styles.nodeActive : ""}`}
      data-node={kind}
    >
      <button className={styles.nodeHeader} type="button" onClick={() => onSelect({ node: kind })}>
        <span className={styles.nodeIndex}>{meta.index}</span>
        <span>{t(meta.label)}</span>
        <span className={styles.hexNumber}>{locale==="en"?`No. ${hexagram.number}`:`第 ${hexagram.number} 卦`}</span>
      </button>

      <div className={styles.hexBody} aria-label={`${t(meta.label)} ${hexagram.name}`}>
        {displayLines.map(({ value, position }) => {
          const moving = kind !== "mutual" && movingLines.includes(position);
          const selected = selection.node === kind && selection.line === position;
          return (
            <button
              className={`${styles.yaoRow} ${moving ? styles.moving : ""} ${selected ? styles.yaoSelected : ""}`}
              type="button"
              key={position}
              aria-label={locale==="en"?`Line ${position}, ${t(LINE_NAME[value])}${moving?", moving":""}`:`第 ${position} 爻，${LINE_NAME[value]}${moving ? "，动爻" : ""}`}
              onClick={() => onSelect({ node: kind, line: position })}
            >
              <span className={styles.lineNumber}>{position}</span>
              <span className={value % 2 ? styles.solidLine : styles.brokenLine} aria-hidden="true">
                <i />
                {value % 2 === 0 && <i />}
              </span>
              <span className={styles.lineState}>{moving ? t("变") : ""}</span>
            </button>
          );
        })}
      </div>

      <button className={styles.nodeFooter} type="button" onClick={() => onSelect({ node: kind })}>
        <span className={styles.hexName}>{hexagram.name}</span>
        <span className={styles.trigramPair}>
          <span data-element={upper.element}>{upper.symbol} {t(upper.image)} · {t(ELEMENT_LABEL[upper.element])}</span>
          <i />
          <span data-element={lower.element}>{lower.symbol} {t(lower.image)} · {t(ELEMENT_LABEL[lower.element])}</span>
        </span>
      </button>
    </article>
  );
}

function Connector({ label, detail }: { label: string; detail: string }) {
  return (
    <div className={styles.connector} aria-label={`${label}：${detail}`}>
      <span>{label}</span>
      <i />
      <small>{detail}</small>
    </div>
  );
}

async function requestEvidence(number: number, line?: number, signal?: AbortSignal) {
  const params = new URLSearchParams({ number: String(number) });
  if (line) params.set("line", String(line));
  const response = await fetch(`/api/knowledge/hexagram?${params}`, { signal });
  const payload = await response.json() as ApiEnvelope<HexagramEvidenceResult>;
  if (!response.ok || !payload.result) {
    throw new Error(payload.error?.message ?? "古籍资料请求失败，请稍后重试。");
  }
  return payload.result;
}

function EvidencePanel({ state, line }: { state: EvidenceState; line?: number }) {
  const { locale } = useI18n();
  const t=(text:string)=>divinationText(locale,text);
  if (state.status === "loading") {
    return <div className={styles.evidenceNotice}>{t("正在核对知识库原文与出处…")}</div>;
  }
  if (state.status === "missing" || !state.data) {
    return (
      <div className={styles.evidenceMissing} role="status">
        <strong>{t("资料缺失")}</strong>
        <p>{state.message ?? "现有知识库未提供对应资料，系统不会生成替代原文。"}</p>
      </div>
    );
  }

  const lineEvidence = line ? state.data.selected_line : undefined;
  const evidence = line ? lineEvidence : state.data.judgment;
  if (!evidence) {
    return (
      <div className={styles.evidenceMissing} role="status">
        <strong>{t("资料缺失")}</strong>
        <p>{t("现有知识库未收录该爻资料，系统不会生成替代原文。")}</p>
      </div>
    );
  }

  return (
    <div className={styles.evidencePanel}>
      <div className={styles.evidenceHeading}>
        <span>{t("古籍依据")}</span>
        <strong>{lineEvidence?.label ?? `${state.data.symbol} ${state.data.name}卦辞`}</strong>
      </div>
      <section>
        <h4>{t("原文")}</h4>
        <p className={styles.originalText}>{evidence.original}</p>
      </section>
      <section>
        <h4>{locale==="en"?"Original Chinese commentary":t("译注")}</h4>
        {evidence.commentary.length ? evidence.commentary.map((item, index) => <p key={index}>{item}</p>) : <p>{t("现有资料未提供可核验注释。")}</p>}
        {evidence.translation_en ? (
          <details open={locale==="en"}>
            <summary>{t("查看资料所附英文译文")}</summary>
            <p lang="en">{evidence.translation_en}</p>
          </details>
        ) : null}
      </section>
      <section>
        <h4>{t("来源")}</h4>
        <ul className={styles.sourceList}>
          {state.data.sources.map((source) => (
            <li key={source.source_id}>
              {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : source.title}
              <small>{[source.edition, source.chapter].filter(Boolean).join(" · ")}</small>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function HexagramEvolution({ result }: { result: DivinationCastResult }) {
  const { locale } = useI18n();
  const t=(text:string)=>divinationText(locale,text);
  const [selection, setSelection] = useState<Selection>({ node: "primary" });
  const [evidence, setEvidence] = useState<EvidenceState>({ status: "loading", data: null });
  const requestId = useRef(0);
  const selectedHexagram = result[selection.node];
  const selectedMeta = NODE_META[selection.node];
  const selectedLine = selection.line ? selectedHexagram.lines[selection.line - 1] : undefined;
  const upper = trigram(selectedHexagram.upper_trigram);
  const lower = trigram(selectedHexagram.lower_trigram);
  const movingLabel = result.moving_lines.length
    ? `第 ${result.moving_lines.join("、")} 爻`
    : "无动爻";

  useEffect(() => {
    const controller = new AbortController();
    const id = ++requestId.current;
    requestEvidence(result.primary.number, undefined, controller.signal)
      .then((data) => {
        if (id === requestId.current) setEvidence({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (id === requestId.current && !controller.signal.aborted) {
          setEvidence({ status: "missing", data: null, message: error instanceof Error ? error.message : undefined });
        }
      });
    return () => controller.abort();
  }, [result.primary.number]);

  function selectEvidence(next: Selection) {
    setSelection(next);
    setEvidence({ status: "loading", data: null });
    const id = ++requestId.current;
    const hexagram = result[next.node];
    requestEvidence(hexagram.number, next.line)
      .then((data) => {
        if (id === requestId.current) setEvidence({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (id === requestId.current) {
          setEvidence({ status: "missing", data: null, message: error instanceof Error ? error.message : undefined });
        }
      });
  }

  return (
    <section className={styles.visualization} aria-labelledby="hexagram-evolution-title">
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>DETERMINISTIC EVOLUTION</p>
          <h3 id="hexagram-evolution-title">{t("卦象演化")}</h3>
          <p>{t("点击卦象或任意一爻，查看推演结构与变化依据。")}</p>
        </div>
        <span className={styles.ruleBadge}><i /> {t("固定规则计算")}</span>
      </header>

      <div className={styles.stage}>
        <HexagramNode
          kind="primary"
          hexagram={result.primary}
          movingLines={result.moving_lines}
          selection={selection}
          onSelect={selectEvidence}
        />
        <Connector label={t("取互")} detail={t("二三四 · 三四五")} />
        <HexagramNode
          kind="mutual"
          hexagram={result.mutual}
          movingLines={[]}
          selection={selection}
          onSelect={selectEvidence}
        />
        <Connector label={t("爻变")} detail={locale==="en"?result.moving_lines.join(", ")||"None":movingLabel} />
        <HexagramNode
          kind="transformed"
          hexagram={result.transformed}
          movingLines={result.moving_lines}
          selection={selection}
          onSelect={selectEvidence}
        />
      </div>

      <div className={styles.insightGrid}>
        <div className={styles.detailPanel}>
          <div className={styles.detailHeading}>
            <span>{t(selectedMeta.label)}</span>
            <strong>{selectedHexagram.name}</strong>
            <small>{locale==="en"?`No. ${selectedHexagram.number}`:`第 ${selectedHexagram.number} 卦`}</small>
          </div>

          {selectedLine && selection.line ? (
            <div className={styles.lineDetail}>
              <span className={styles.detailOrdinal}>{locale==="en"?`Line ${selection.line}`:`第 ${selection.line} 爻`}</span>
              <strong>{t(LINE_NAME[selectedLine])}</strong>
              <p>
                {result.moving_lines.includes(selection.line)
                  ? t("此爻为动爻，在变卦中阴阳翻转，是本次卦变的直接节点。")
                  : t("此爻在本次推演中保持不变。")}
              </p>
            </div>
          ) : (
            <p className={styles.description}>{t(selectedMeta.description)}</p>
          )}

          <dl className={styles.trigramDetails}>
            <div>
              <dt>{t("上卦")}</dt>
              <dd>{upper.symbol} {t(upper.image)} · {t(ELEMENT_LABEL[upper.element])}</dd>
            </div>
            <div>
              <dt>{t("下卦")}</dt>
              <dd>{lower.symbol} {t(lower.image)} · {t(ELEMENT_LABEL[lower.element])}</dd>
            </div>
            <div>
              <dt>{t("五行关系")}</dt>
              <dd>{t(elementRelation(upper.element, lower.element))}</dd>
            </div>
          </dl>
        </div>

        <div className={styles.interpretationPanel}>
          <p className={styles.panelLabel}>{t("解释分层")}</p>
          <div>
            <span>{t("规则结果")}</span>
            <p>{t(result.traditional_meaning)}</p>
          </div>
          <div>
            <span>{t("情境说明")}</span>
            <p>{t(result.contextual_interpretation)}</p>
          </div>
          <EvidencePanel state={evidence} line={selection.line} />
        </div>
      </div>
    </section>
  );
}
