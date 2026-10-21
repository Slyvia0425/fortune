import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { EN } from "../lib/i18n/dictionary";
import { translate } from "../lib/i18n/translate";

const root = process.cwd();

describe("界面语言切换", () => {
  it("中文返回原文，英文返回译文", () => {
    expect(translate("zh", "八字")).toBe("八字");
    expect(translate("en", "八字")).toBe("BaZi");
  });

  it("没有词条时回落到原文，而不是空白", () => {
    expect(translate("en", "尚未收录的一句界面文案")).toBe("尚未收录的一句界面文案");
  });

  it("就地传入的英文优先于词条", () => {
    expect(translate("en", "度", undefined, "°")).toBe("°");
    expect(translate("zh", "度", undefined, "°")).toBe("度");
  });

  it("占位符在两种语言下都替换", () => {
    const params = { count: 7 };
    expect(translate("zh", "找到 {count} 条", params)).toBe("找到 7 条");
    expect(translate("en", "找到 {count} 条", params)).toBe("7 found");
    expect(translate("en", "找到 {count} 条", params, "{count} records found")).toBe(
      "7 records found",
    );
  });

  it("词条本身是干净的界面文案", () => {
    for (const [key, value] of Object.entries(EN)) {
      expect(key.trim(), `empty key: ${JSON.stringify(key)}`).not.toBe("");
      expect(value.trim(), `empty translation for ${key}`).not.toBe("");
      // A key that looks like code means the wiring script matched markup
      // instead of a rendered string.
      expect(/=>|useState|;\s*\n/.test(key), `code-like key: ${key}`).toBe(false);
      const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      // A translation that drops a placeholder would silently lose a number.
      expect(placeholders(value), `placeholders of ${key} -> ${value}`).toEqual(
        placeholders(key),
      );
    }
  });

  it("大部分已接入的界面文案都有译文", () => {
    const files = execFileSync("rg", ["--files", "app", "-g", "*.tsx"], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      .map((file) => resolve(root, file));

    const keys = new Set<string>();
    for (const file of files) {
      // `(?<![\w$.])` keeps helpers such as `split("line")` out of the list.
      for (const match of readFileSync(file, "utf8").matchAll(/(?<![\w$.])t\(\s*"([^"]+)"/g)) {
        keys.add(match[1]);
      }
    }

    const missing = [...keys].filter((key) => !(key in EN));
    expect(keys.size).toBeGreaterThan(100);
    expect(missing.length / keys.size, `untranslated: ${missing.join(" | ")}`).toBeLessThan(0.1);
  });
});
