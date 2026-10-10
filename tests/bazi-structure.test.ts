import { describe, expect, it } from "vitest";

import type { BaziPillar } from "../lib/contracts/bazi";
import {
  BRANCH_ELEMENT,
  cellNote,
  chartCells,
  cycleFromDayMaster,
  groupForElement,
  STEM_POLARITY,
  TEN_GOD_GROUP,
  tenGodPositions,
} from "../lib/bazi/structure";

// 癸酉 辛酉 乙卯 丙子 — 日主乙木。每个值都按规则人工核对过。
const SAMPLE: BaziPillar[] = [
  {
    label: "year",
    stem: "gui",
    branch: "you",
    element: "water",
    ten_god: "indirect_resource",
    hidden_stems: [{ stem: "xin", element: "metal", qi: "primary", ten_god: "seven_killings" }],
  },
  {
    label: "month",
    stem: "xin",
    branch: "you",
    element: "metal",
    ten_god: "seven_killings",
    hidden_stems: [{ stem: "xin", element: "metal", qi: "primary", ten_god: "seven_killings" }],
  },
  {
    label: "day",
    stem: "yi",
    branch: "mao",
    element: "wood",
    ten_god: null,
    hidden_stems: [{ stem: "yi", element: "wood", qi: "primary", ten_god: "friend" }],
  },
  {
    label: "hour",
    stem: "bing",
    branch: "zi",
    element: "fire",
    ten_god: "hurting_officer",
    hidden_stems: [{ stem: "gui", element: "water", qi: "primary", ten_god: "indirect_resource" }],
  },
];

describe("五行与十神的对应", () => {
  it("以木为日主时，五行各自对应的十神分组正确", () => {
    expect(groupForElement("wood", "wood")).toBe("companion");
    expect(groupForElement("fire", "wood")).toBe("output");
    expect(groupForElement("earth", "wood")).toBe("wealth");
    expect(groupForElement("metal", "wood")).toBe("officer");
    expect(groupForElement("water", "wood")).toBe("resource");
  });

  it("换一个日主也成立（以金为日主）", () => {
    expect(groupForElement("fire", "metal")).toBe("officer");
    expect(groupForElement("earth", "metal")).toBe("resource");
    expect(groupForElement("wood", "metal")).toBe("wealth");
  });

  it("相生顺序从日主开始排列", () => {
    expect(cycleFromDayMaster("metal")).toEqual(["metal", "water", "wood", "fire", "earth"]);
  });

  it("每个十神都归入五组之一，每组恰好两个", () => {
    const counts = Object.values(TEN_GOD_GROUP).reduce<Record<string, number>>((acc, group) => {
      acc[group] = (acc[group] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ companion: 2, output: 2, wealth: 2, officer: 2, resource: 2 });
  });
});

describe("命盘八字", () => {
  const cells = chartCells(SAMPLE);
  const dayMaster = cells.find((cell) => cell.isDayMaster)!;

  it("拆成八个字，只有日干是日主，只有月支是月令", () => {
    expect(cells).toHaveLength(8);
    expect(cells.filter((cell) => cell.isDayMaster).map((cell) => cell.id)).toEqual(["day-stem"]);
    expect(cells.filter((cell) => cell.isMonthBranch).map((cell) => cell.id)).toEqual(["month-branch"]);
  });

  it("地支的五行取自地支本身，十神取自本气藏干", () => {
    const hourBranch = cells.find((cell) => cell.id === "hour-branch")!;
    expect(hourBranch.char).toBe("子");
    expect(hourBranch.element).toBe("water");
    expect(hourBranch.tenGod).toBe("indirect_resource");
  });

  it("天干注释说明阴阳异同", () => {
    const hourStem = cells.find((cell) => cell.id === "hour-stem")!;
    const note = cellNote(hourStem, dayMaster);
    expect(note.title).toBe("丙 · 阳火");
    expect(note.relation).toBe("相对日主：伤官");
    expect(note.body).toContain("阴阳相异");
  });

  it("日支本气与日主同五行时，注释指出这是日主的根", () => {
    const dayBranch = cells.find((cell) => cell.id === "day-branch")!;
    expect(cellNote(dayBranch, dayMaster).body).toContain("日主在地支中的根");
  });

  it("地支注释只写本支的作用和藏干，不重复通用说明，也不再单列一行藏干关系", () => {
    for (const id of ["year-branch", "month-branch", "day-branch", "hour-branch"]) {
      const note = cellNote(cells.find((cell) => cell.id === id)!, dayMaster);
      expect(note.relation, id).toBe("");
      expect(note.body, id).not.toContain("称为藏干");
      expect(note.body, id).toMatch(/中藏/);
    }
    expect(cellNote(cells.find((cell) => cell.id === "year-branch")!, dayMaster).body).toContain("得地");
    expect(cellNote(cells.find((cell) => cell.id === "hour-branch")!, dayMaster).body).toContain("时辰");
  });

  it("月支注释提到月令", () => {
    const monthBranch = cells.find((cell) => cell.id === "month-branch")!;
    const note = cellNote(monthBranch, dayMaster);
    expect(note.place).toBe("月支（月令）");
    expect(note.body).toContain("月令");
  });
});

describe("十神出现位置", () => {
  const positions = tenGodPositions(SAMPLE);

  it("统计天干与所有藏干，不计日主本身", () => {
    expect(positions.officer).toHaveLength(3);
    expect(positions.resource).toHaveLength(2);
    expect(positions.companion).toHaveLength(1);
    expect(positions.output).toHaveLength(1);
    expect(positions.wealth).toHaveLength(0);
  });

  it("位置描述可读", () => {
    expect(positions.officer).toContain("月干 辛 · 七杀");
    expect(positions.resource).toContain("时支 子 · 藏癸 · 偏印");
  });
});

describe("基础表", () => {
  it("十天干阴阳交替", () => {
    expect(Object.values(STEM_POLARITY)).toEqual([
      "yang", "yin", "yang", "yin", "yang", "yin", "yang", "yin", "yang", "yin",
    ]);
  });

  it("十二地支五行分布为 木2 火2 土4 金2 水2", () => {
    const counts = Object.values(BRANCH_ELEMENT).reduce<Record<string, number>>((acc, element) => {
      acc[element] = (acc[element] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ wood: 2, fire: 2, earth: 4, metal: 2, water: 2 });
  });
});
