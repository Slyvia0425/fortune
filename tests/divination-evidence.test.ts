import { describe, expect, it } from "vitest";
import type { DivinationCastResult, HexagramView } from "../lib/contracts/divination";
import { buildDivinationEvidencePack } from "../lib/divination/evidence";

const hexagram = (number: number, name: string): HexagramView => ({
  number,
  name,
  upper_trigram: "兑",
  lower_trigram: "离",
  lines: [7, 8, 7, 8, 7, 8],
});

function cast(moving: number[], primary = hexagram(49, "泽火革"), transformed = hexagram(17, "泽雷随")): DivinationCastResult {
  return {
    primary,
    moving_lines: moving,
    mutual: hexagram(44, "天风姤"),
    transformed,
    traditional_meaning: "",
    contextual_interpretation: "",
  };
}

const pack = (result: DivinationCastResult) => buildDivinationEvidencePack({ question: "测试问题", cast: result });

describe("变爻规则 Evidence Pack", () => {
  it("0 动爻选择本卦卦辞", () => expect(pack(cast([])).evidence.map((item) => item.role)).toEqual(["primary_judgment"]));
  it("1 动爻选择本卦对应爻辞", () => expect(pack(cast([3])).evidence[0]).toMatchObject({ role: "primary_moving_line", line_position: 3 }));
  it("2 动爻以上爻优先", () => expect(pack(cast([1, 5])).evidence.map((item) => item.line_position)).toEqual([5, 1]));
  it("3 动爻选择本卦和变卦卦辞", () => expect(pack(cast([1, 3, 5])).evidence.map((item) => item.role)).toEqual(["primary_judgment", "transformed_judgment"]));
  it("4 动爻选择变卦两条静爻并以下爻优先", () => expect(pack(cast([1, 3, 4, 6])).evidence.map((item) => item.line_position)).toEqual([2, 5]));
  it("5 动爻选择变卦唯一静爻", () => expect(pack(cast([1, 2, 3, 5, 6])).evidence[0]).toMatchObject({ role: "transformed_static_line", line_position: 4 }));
  it("乾卦六爻皆变选择数据库中的用九", () => {
    const result = pack(cast([1, 2, 3, 4, 5, 6], hexagram(1, "乾为天"), hexagram(2, "坤为地")));
    expect(result.evidence[0]).toMatchObject({ role: "special_line", original: "用九:見群龍无首,吉。" });
  });
  it("非乾坤六爻皆变选择变卦卦辞", () => expect(pack(cast([1, 2, 3, 4, 5, 6])).evidence[0].role).toBe("transformed_judgment"));
  it("每项证据都携带本次来源白名单", () => {
    const result = pack(cast([3]));
    expect(result.evidence[0].source_ids.length).toBeGreaterThan(0);
    expect(result.sources.map((source) => source.source_id)).toEqual(expect.arrayContaining(result.evidence[0].source_ids));
  });
});
