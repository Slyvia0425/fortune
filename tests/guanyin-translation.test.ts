import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import chinese from "../sticks/guanyin.json";
import english from "../sticks/guanyin.en.json";
import { getGuanyinStick } from "../lib/guanyin/library";
import { getLocalizedGuanyinStick, guanyinEnglishCatalog, validateGuanyinTranslationCatalog } from "../lib/guanyin/translation";
import { questionDomains } from "../lib/guanyin/types";
import { POST as draw } from "../app/api/guanyin-lot/draw/route";

describe("独立英文百签", () => {
  it("完整覆盖相同 100 签、四句签诗和六类事项", () => {
    expect(guanyinEnglishCatalog.translations.map(s => s.id)).toEqual(chinese.map(s => s.id));
    for (const original of chinese) {
      const translated = getLocalizedGuanyinStick(original.id, "en");
      expect(translated.id).toBe(original.id);
      expect(translated.poem).toHaveLength(4);
      expect(Object.keys(translated.traditional.topics).sort()).toEqual([...questionDomains].sort());
      expect(translated.title).not.toBe(original.title);
      expect(/\p{Script=Han}/u.test(JSON.stringify(translated))).toBe(false);
    }
  });

  it("保持中文源对象和签号，语言切换可逆且无抽签副作用", () => {
    const before = JSON.stringify(chinese);
    for (let id = 1; id <= 100; id++) {
      const original = getGuanyinStick(id);
      expect(getLocalizedGuanyinStick(id, "zh")).toBe(original);
      const translated = getLocalizedGuanyinStick(id, "en");
      expect(Object.isFrozen(translated.traditional.topics)).toBe(true);
      expect(getLocalizedGuanyinStick(id, "zh")).toBe(original);
      expect(getLocalizedGuanyinStick(id, "en")).toBe(translated);
    }
    expect(JSON.stringify(chinese)).toBe(before);
  });

  it("中文底本改变时检测过期译文", () => {
    expect(english.sourceSha256).toBe(createHash("sha256").update(JSON.stringify(chinese)).digest("hex"));
    expect(execFileSync(process.execPath, ["scripts/build-guanyin-en.mjs", "--check"], { encoding: "utf8" })).toContain("100");
  });

  it("抽签 API 继续返回相同编号的中文证据，英文仅用于显示", async () => {
    const response = await draw(new Request("http://localhost/api/guanyin-lot/draw", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "career", question: "现在适合换工作吗？", locale: "en" }),
    }));
    const { result } = await response.json();
    expect(result.stick).toEqual(getGuanyinStick(result.stick.id));
    expect(getLocalizedGuanyinStick(result.stick.id, "en").id).toBe(result.reasoning.signId);
  });

  it.each([0, 101, -1, 1.5, "1", null, Number.NaN])("拒绝无效签号 %s", id => {
    expect(() => getLocalizedGuanyinStick(id, "en")).toThrow();
  });

  it.each([
    ["缺签", (value: typeof english) => value.translations.pop()],
    ["重号", (value: typeof english) => { value.translations[1].id = 1; }],
    ["越界", (value: typeof english) => { value.translations[0].id = 101; }],
    ["缺诗句", (value: typeof english) => value.translations[0].poem.pop()],
    ["空事项", (value: typeof english) => { value.translations[0].traditional.topics.health = " "; }],
    ["空典故", (value: typeof english) => { value.translations[0].traditional.diangu = ""; }],
    ["未翻译", (value: typeof english) => { value.translations[0].title = "中文"; }],
    ["错误语言", (value: typeof english) => { value.locale = "zh"; }],
    ["错误底本", (value: typeof english) => { value.sourceVersion = "other"; }],
  ] as const)("拒绝不完整或错误英译：%s", (_name, corrupt) => {
    const value = structuredClone(english);
    corrupt(value);
    expect(() => validateGuanyinTranslationCatalog(value)).toThrow();
  });

  it("保留疑难底本的说明，避免虚构缺失典故或隐去历史错误", () => {
    expect(getLocalizedGuanyinStick(63, "en").traditional.diangu).toContain("only the allusion's title");
    expect(getLocalizedGuanyinStick(95, "en").traditional.diangu).toContain("Cao Huan");
    expect(getLocalizedGuanyinStick(1, "en").traditional.jieyue).toContain("unclear");
    expect(getLocalizedGuanyinStick(97, "en").traditional.jieyue).toContain("traditional text");
  });
});
