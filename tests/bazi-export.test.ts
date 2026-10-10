import { describe, expect, it } from "vitest";

import type { BaziChartRequest, BaziChartResult } from "../lib/contracts/bazi";
import { chainJson, chartMarkdown, exportName } from "../lib/bazi/export";
import sample from "./fixtures/bazi-chart-sample.json";

const CHART = sample.result as unknown as BaziChartResult;
const REQUEST = sample.request as unknown as BaziChartRequest;

describe("exports", () => {
  it("give the trace back as data, with the request it answers", () => {
    const chain = JSON.parse(chainJson(CHART, REQUEST));
    expect(chain.request).toEqual(REQUEST);
    expect(chain.steps).toEqual(CHART.calculation_trace);
  });

  it("write the chart as a document of facts: the input, the pillars, the elements, the help the day master gets, the luck and annual pillars", () => {
    const report = chartMarkdown(CHART, REQUEST, "2026-10-10 12:00");
    for (const heading of ["## 基本信息", "## 八字", "## 五行与十神", "## 日主得到的帮助", "## 大运与流年"]) expect(report).toContain(heading);
    expect(report).toContain("八字：庚午 辛巳 壬午 甲辰");
    expect(report).toContain("日主：壬（阳水）");
    expect(report).toContain("真太阳时：07:39");
    for (const factor of CHART.reasoning_trace.factors.filter((f) => f.key !== "opposition")) expect(report).toContain(`程度 ${factor.score}`);
    for (const cycle of CHART.luck_cycles) expect(report).toContain(`${cycle.start_year}–${cycle.end_year}`);
    for (const year of CHART.annual_cycles) expect(report).toContain(`${year.year} `);
  });

  it("states no judgement and no reasoning: no strength, no useful or unfavourable elements, no weights, no reading by domain, no trace", () => {
    const report = chartMarkdown(CHART, REQUEST, "2026-10-10 12:00");
    for (const word of ["用神", "忌神", "太弱", "偏弱", "偏旺", "太旺", "权重", "加权", "特殊格局", "倾向", "职业方向", "学业方向", "财运", "推导链路", "R-", "规则库", "因子", "满足度", "克泄耗", "÷", "="]) {
      expect(report, word).not.toContain(word);
    }
  });

  it("is the same text every time, with a name for every key and no gaps", () => {
    const report = chartMarkdown(CHART, REQUEST, "2026-10-10 12:00");
    expect(chartMarkdown(CHART, REQUEST, "2026-10-10 12:00")).toBe(report);
    expect(report).not.toContain("undefined");
    expect(report).not.toMatch(/\b(lixia|lidong|jia|yin|wood|fire|primary|middle)\b/);
  });

  it("name the files by what they hold and the birth date", () => {
    expect(exportName(CHART, "chain", "json")).toBe(`bazi-chain-${CHART.resolved_time.solar_date}.json`);
    expect(exportName(CHART, "chart", "md")).toMatch(/^bazi-chart-\d{4}-\d{2}-\d{2}\.md$/);
  });
});
