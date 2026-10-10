import { describe, expect, it } from "vitest";

import type { DivinationCastResult } from "../lib/contracts/divination";
import { enrichDivinationReading } from "../lib/divination/reading";
import {
  findHexagramKnowledgePage,
  getKnowledgePageById,
} from "../lib/knowledge/library";

const LINE_PATTERN = /^(初[九六]|[九六][二三四五]|上[九六]|用[九六])/;

describe("周易 64 卦阅读依据", () => {
  it("每一卦都能匹配到含卦辞、彖传、象传的结构化典籍页面", () => {
    const incomplete: number[] = [];
    for (let number = 1; number <= 64; number += 1) {
      const item = findHexagramKnowledgePage(number);
      const page = item ? getKnowledgePageById(item.id) : undefined;
      const blocks = page?.content_blocks ?? [];
      const hasJudgment = blocks.some(
        (block) =>
          block.type === "original" &&
          !LINE_PATTERN.test(block.text) &&
          !block.heading.includes("文言"),
      );
      const hasCommentary = blocks.some(
        (block) => block.type === "commentary" && block.heading.includes("彖"),
      );
      const hasImage = blocks.some(
        (block) => block.type === "commentary" && block.heading.includes("象"),
      );
      if (!page || !hasJudgment || !hasCommentary || !hasImage) incomplete.push(number);
    }
    expect(incomplete).toEqual([]);
  });

  it("起卦结果附上卦辞、彖传、象传与动爻原文", () => {
    const result: DivinationCastResult = {
      primary: {
        number: 1,
        name: "乾",
        upper_trigram: "乾",
        lower_trigram: "乾",
        lines: [9, 7, 7, 7, 7, 7],
      },
      moving_lines: [1],
      mutual: {
        number: 1,
        name: "乾",
        upper_trigram: "乾",
        lower_trigram: "乾",
        lines: [7, 7, 7, 7, 7, 7],
      },
      transformed: {
        number: 44,
        name: "姤",
        upper_trigram: "乾",
        lower_trigram: "巽",
        lines: [8, 7, 7, 7, 7, 7],
      },
      traditional_meaning: "乾卦原文",
      contextual_interpretation: "确定性解读",
    };

    const enriched = enrichDivinationReading(result);
    const reading = enriched.reading;
    expect(reading?.primary.source_id).toBe("zhouyi-1");
    expect(reading?.primary.judgment).toContain("元亨");
    expect(reading?.primary.commentary).toContain("大哉乾元");
    expect(reading?.primary.image).toContain("天行健");
    expect(reading?.primary.moving_lines[0]?.text).toContain("潛龍");
    expect(reading?.source_refs.length).toBeGreaterThan(0);
  });
});
