import type {
  DivinationCastResult,
  HexagramReading,
  HexagramView,
  MovingLineReading,
} from "../contracts/divination";
import {
  findHexagramKnowledgePage,
  getKnowledgePageById,
  type KnowledgeContentBlock,
} from "../knowledge/library";

const LINE_PATTERN = /^(初[九六]|[九六][二三四五]|上[九六]|用[九六])/;

function fallbackReading(hexagram: HexagramView, reason: string): HexagramReading {
  return {
    number: hexagram.number,
    name: hexagram.name,
    source_id: `zhouyi-${hexagram.number}`,
    source_title: `周易 · 第${hexagram.number}卦 ${hexagram.name}`,
    source_url: "/knowledge",
    judgment: reason,
    commentary: "未找到与卦号唯一匹配的彖传文本，请以典籍原文页复核。",
    image: "未找到与卦号唯一匹配的象传文本，请以典籍原文页复核。",
    moving_lines: [],
  };
}

function firstBlock(
  blocks: KnowledgeContentBlock[],
  predicate: (block: KnowledgeContentBlock) => boolean,
): KnowledgeContentBlock | undefined {
  return blocks.find(predicate);
}

function movingLineReadings(
  blocks: KnowledgeContentBlock[],
  movingLines: number[],
): MovingLineReading[] {
  const lineEntries: Array<{ line: number; text: string; commentary: string }> = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.type !== "original" || !LINE_PATTERN.test(block.text)) continue;
    const next = blocks[index + 1];
    lineEntries.push({
      line: lineEntries.length + 1,
      text: block.text,
      commentary:
        next && next.type === "commentary" && next.heading.includes("象")
          ? next.text
          : "",
    });
  }
  return movingLines
    .map((line) => lineEntries[line - 1])
    .filter((entry): entry is MovingLineReading => Boolean(entry));
}

function readHexagram(
  hexagram: HexagramView,
  movingLines: number[],
): HexagramReading {
  const item = findHexagramKnowledgePage(hexagram.number);
  const page = item ? getKnowledgePageById(item.id) : undefined;
  if (!item || !page) {
    return fallbackReading(
      hexagram,
      "《周易》结构化原文尚未与本卦号建立匹配，暂不生成释义。",
    );
  }

  const blocks = page.content_blocks ?? [];
  const judgment = firstBlock(
    blocks,
    (block) =>
      block.type === "original" &&
      !LINE_PATTERN.test(block.text) &&
      !block.heading.includes("文言"),
  );
  const commentary = firstBlock(
    blocks,
    (block) => block.type === "commentary" && block.heading.includes("彖"),
  );
  const image = firstBlock(
    blocks,
    (block) => block.type === "commentary" && block.heading.includes("象"),
  );

  return {
    number: hexagram.number,
    name: hexagram.name,
    source_id: `zhouyi-${hexagram.number}`,
    source_title: `周易 · 第${hexagram.number}卦 ${hexagram.name}`,
    source_url: `/knowledge/${item.id}`,
    judgment: judgment?.text || item.excerpt,
    commentary: commentary?.text || "本卦页面尚未提取到彖传文字。",
    image: image?.text || "本卦页面尚未提取到象传文字。",
    moving_lines: movingLineReadings(blocks, movingLines),
  };
}

export function enrichDivinationReading(
  result: DivinationCastResult,
): DivinationCastResult {
  const primary = readHexagram(result.primary, result.moving_lines);
  const mutual = readHexagram(result.mutual, []);
  const transformed = readHexagram(result.transformed, []);
  const sourceRefs = [primary, mutual, transformed]
    .map((reading) => ({
      source_id: reading.source_id,
      title: reading.source_title,
      url: reading.source_url,
    }))
    .filter(
      (source, index, all) =>
        all.findIndex((item) => item.source_id === source.source_id) === index,
    );

  return {
    ...result,
    reading: {
      primary,
      mutual,
      transformed,
      method_note:
        "起卦、动爻、互卦和变卦由确定性规则计算；卦辞、彖传、象传与动爻原文按卦号从《周易》结构化典籍中检索，算法不修改古籍文字。",
      source_refs: sourceRefs,
    },
  };
}
