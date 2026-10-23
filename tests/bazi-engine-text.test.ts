import { describe, expect, it } from "vitest";

import type { BaziChartResult } from "@/lib/contracts/bazi";
import { engineText } from "@/lib/bazi/engine-text";
import { translate } from "@/lib/i18n/translate";
import sample from "./fixtures/bazi-chart-sample.json";

const chart = sample.result as unknown as BaziChartResult;
const en = (text: string) => engineText(text, "en", (zh) => translate("en", zh));
const CJK = /[一-鿿]/;

describe("engineText", () => {
  it("leaves the text alone in the Chinese interface", () => {
    const basis = chart.derivation.methods[0].basis;
    expect(engineText(basis, "zh", (zh) => translate("zh", zh))).toBe(basis);
  });

  it("puts the support-suppress and climatic sentences into English", () => {
    const [supporting, climatic] = chart.derivation.methods;
    expect(en(supporting.basis)).toMatch(/^Day master somewhat weak, so support it: use Resource, Peers \(Metal, Water\); avoid Authority, Output, Wealth \(Earth, Wood, Fire\)$/);
    expect(en(climatic.basis)).toContain("born in the");
    expect(en(climatic.basis)).not.toMatch(/日主|取用|先用/);
  });

  it("puts the arbitration rationale into English", () => {
    const text = en(chart.derivation.arbitration.rationale);
    expect(text).toContain("the two methods agree");
    expect(text).not.toMatch(/调候|扶抑/);
  });

  it("translates the tendency texts the rule base writes", () => {
    for (const tally of chart.domain_tallies) {
      expect(en(tally.narrative)).toMatch(/^The classics link /);
      for (const group of tally.groups) {
        expect(en(group.narrative)).toMatch(/^In (career|study|wealth), /);
        expect(CJK.test(en(group.category)), group.category).toBe(false);
        if (group.quotation_plain) expect(CJK.test(en(group.quotation_plain)), group.quotation_plain).toBe(false);
      }
    }
  });

  it("translates the position strings and the notes on the pillars step", () => {
    expect(en("年干 甲 · 比肩")).toBe("Year stem 甲 · Friend");
    expect(en("月支 亥 · 藏甲（中气） · 劫财")).toBe("Month branch 亥 · hides 甲 (middle qi) · Rob Wealth");
    expect(en("日干（日主）")).toBe("Day stem (day master)");
    expect(en("相对日主：正官")).toBe("Relative to the day master: Direct Officer (正官)");
    expect(en("庚 · 阳金")).toBe("庚 · Yang metal");
  });

  it("returns a sentence it does not know as the engine wrote it", () => {
    expect(en("这是一句没有登记过的新句子")).toBe("这是一句没有登记过的新句子");
  });
});
