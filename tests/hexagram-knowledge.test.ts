import { describe, expect, it } from "vitest";
import { getHexagramEvidence, hexagramKnowledgeStats } from "../lib/knowledge/hexagram";

describe("周易卦爻知识索引", () => {
  it("完整索引 64 卦与 384 爻", () => {
    expect(hexagramKnowledgeStats).toEqual({
      indexed_hexagrams: 64,
      complete_hexagrams: 64,
      indexed_lines: 384,
    });
  });

  it("可以通过卦序、完整卦名和爻位稳定查询", () => {
    const byNumber = getHexagramEvidence({ number: 3, line: 1 });
    const byName = getHexagramEvidence({ name: "水雷屯", line: 1 });
    expect(byNumber?.name).toBe("屯");
    expect(byName?.number).toBe(3);
    expect(byNumber?.selected_line?.original).toContain("初九");
    expect(byNumber?.sources).toHaveLength(2);
  });

  it("资料不存在时返回 null，不生成替代原文", () => {
    expect(getHexagramEvidence({ number: 65 })).toBeNull();
    expect(getHexagramEvidence({ name: "不存在的卦" })).toBeNull();
  });

  it("从 Module 3 数据库返回乾坤的用九与用六，不补写原文", () => {
    expect(getHexagramEvidence({ number: 1 })?.special_line).toMatchObject({
      label: "用九",
      original: "用九:見群龍无首,吉。",
    });
    expect(getHexagramEvidence({ number: 2 })?.special_line).toMatchObject({
      label: "用六",
      original: "用六:利永貞。",
    });
    expect(getHexagramEvidence({ number: 3 })?.special_line).toBeUndefined();
  });
});
