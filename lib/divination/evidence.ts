import type {
  DivinationCastResult,
  DivinationEvidenceItem,
  DivinationEvidencePack,
  HexagramView,
} from "@/lib/contracts/divination";
import type { SourceReference } from "@/lib/contracts/api";
import type { HexagramEvidenceResult, HexagramLineEvidence } from "@/lib/contracts/knowledge";
import { getHexagramEvidence } from "../knowledge/hexagram";

function sourceIds(evidence: HexagramEvidenceResult) {
  return evidence.sources.map((source) => source.source_id);
}

function judgmentItem(
  role: "primary_judgment" | "transformed_judgment",
  hexagram: HexagramView,
  evidence: HexagramEvidenceResult,
  priority: number,
): DivinationEvidenceItem {
  return {
    evidence_id: `hexagram-${hexagram.number}-judgment`,
    role,
    hexagram_number: hexagram.number,
    hexagram_name: hexagram.name,
    priority,
    original: evidence.judgment.original,
    commentary: evidence.judgment.commentary,
    translation_en: evidence.judgment.translation_en,
    source_ids: sourceIds(evidence),
  };
}

function lineItem(
  role: "primary_moving_line" | "transformed_static_line",
  hexagram: HexagramView,
  evidence: HexagramEvidenceResult,
  line: HexagramLineEvidence,
  priority: number,
): DivinationEvidenceItem {
  return {
    evidence_id: `hexagram-${hexagram.number}-line-${line.position}`,
    role,
    hexagram_number: hexagram.number,
    hexagram_name: hexagram.name,
    line_position: line.position,
    priority,
    original: line.original,
    commentary: line.commentary,
    translation_en: line.translation_en,
    source_ids: sourceIds(evidence),
  };
}

function uniqueSources(groups: SourceReference[][]) {
  const sources = new Map<string, SourceReference>();
  for (const group of groups) for (const source of group) sources.set(source.source_id, source);
  return [...sources.values()];
}

export function buildDivinationEvidencePack(input: {
  question: string;
  time_range?: string;
  cast: DivinationCastResult;
}): DivinationEvidencePack {
  const { cast } = input;
  const primary = getHexagramEvidence({ number: cast.primary.number });
  const transformed = getHexagramEvidence({ number: cast.transformed.number });
  if (!primary || !transformed || !primary.coverage.complete || !transformed.coverage.complete) {
    throw new Error("HEXAGRAM_EVIDENCE_INCOMPLETE");
  }

  const moving = [...new Set(cast.moving_lines)].filter((line) => line >= 1 && line <= 6).sort((a, b) => a - b);
  const items: DivinationEvidenceItem[] = [];
  let selectionRule = "";

  if (moving.length === 0) {
    selectionRule = "0 动爻：采用本卦卦辞。";
    items.push(judgmentItem("primary_judgment", cast.primary, primary, 1));
  } else if (moving.length === 1) {
    selectionRule = "1 动爻：采用本卦该动爻爻辞。";
    const line = primary.lines[moving[0] - 1];
    if (line) items.push(lineItem("primary_moving_line", cast.primary, primary, line, 1));
  } else if (moving.length === 2) {
    selectionRule = "2 动爻：采用本卦两条动爻爻辞，以上爻为主。";
    moving.slice().sort((a, b) => b - a).forEach((position, index) => {
      const line = primary.lines[position - 1];
      if (line) items.push(lineItem("primary_moving_line", cast.primary, primary, line, index + 1));
    });
  } else if (moving.length === 3) {
    selectionRule = "3 动爻：采用本卦卦辞与变卦卦辞。";
    items.push(judgmentItem("primary_judgment", cast.primary, primary, 1));
    items.push(judgmentItem("transformed_judgment", cast.transformed, transformed, 2));
  } else if (moving.length === 4) {
    selectionRule = "4 动爻：采用变卦两条静爻爻辞，以下爻为主。";
    [1, 2, 3, 4, 5, 6].filter((position) => !moving.includes(position)).forEach((position, index) => {
      const line = transformed.lines[position - 1];
      if (line) items.push(lineItem("transformed_static_line", cast.transformed, transformed, line, index + 1));
    });
  } else if (moving.length === 5) {
    selectionRule = "5 动爻：采用变卦唯一静爻爻辞。";
    const position = [1, 2, 3, 4, 5, 6].find((candidate) => !moving.includes(candidate));
    const line = position ? transformed.lines[position - 1] : undefined;
    if (line) items.push(lineItem("transformed_static_line", cast.transformed, transformed, line, 1));
  } else if (primary.special_line) {
    selectionRule = `6 动爻：${primary.name}卦采用${primary.special_line.label}。`;
    items.push({
      evidence_id: `hexagram-${cast.primary.number}-special-${primary.special_line.label}`,
      role: "special_line",
      hexagram_number: cast.primary.number,
      hexagram_name: cast.primary.name,
      priority: 1,
      original: primary.special_line.original,
      commentary: primary.special_line.commentary,
      translation_en: primary.special_line.translation_en,
      source_ids: sourceIds(primary),
    });
  } else {
    selectionRule = "6 动爻：采用变卦卦辞。";
    items.push(judgmentItem("transformed_judgment", cast.transformed, transformed, 1));
  }

  if (!items.length || items.some((item) => !item.original)) throw new Error("SELECTED_EVIDENCE_MISSING");
  const selectedSourceIds = new Set(items.flatMap((item) => item.source_ids));
  return {
    rule_version: "changing-lines-v1",
    selection_rule: selectionRule,
    question: input.question.trim().slice(0, 500),
    time_range: input.time_range?.trim().slice(0, 80) || undefined,
    primary: { number: cast.primary.number, name: cast.primary.name },
    transformed: { number: cast.transformed.number, name: cast.transformed.name },
    moving_lines: moving,
    evidence: items,
    sources: uniqueSources([primary.sources, transformed.sources]).filter((source) => selectedSourceIds.has(source.source_id)),
  };
}
