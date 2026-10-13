import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { chartSourceId, personKey, type BaziProfileActivity } from "../app/bazi/profile-activity";

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

const CHART = {
  pillars: [
    { stem: "甲", branch: "子" },
    { stem: "乙", branch: "丑" },
    { stem: "丙", branch: "寅" },
    { stem: "丁", branch: "卯" },
  ],
};

/**
 * Every step of the bazi pages writes into the personal knowledge base, so the
 * agent can read a person's charts back as one history rather than only the
 * pages the user happened to bookmark.
 */
describe("八字各环节收藏接入", () => {
  const steps = [
    ["app/bazi/bazi-workspace.tsx", "bazi_input"],
    ["app/bazi/pillars-step.tsx", "bazi_record"],
    ["app/bazi/elements-step.tsx", "bazi_analysis"],
    ["app/bazi/advisory-step.tsx", "bazi_advisory"],
    ["app/bazi/chain-step.tsx", "bazi_reasoning"],
  ] as const;

  it.each(steps)("%s 提供 %s 收藏入口", (file, itemType) => {
    const source = read(file);
    expect(source).toContain("CollectionButton");
    expect(source).toContain(itemType);
  });

  it("大运流年单独成一条记录", () => {
    expect(read("app/bazi/pillars-step.tsx")).toContain("bazi_luck");
  });

  it("出生信息可归档到具体人物", () => {
    expect(existsSync(resolve(root, "app/bazi/person-archive.tsx"))).toBe(true);
    const workspace = read("app/bazi/bazi-workspace.tsx");
    expect(workspace).toContain("PersonArchive");
    expect(workspace).toContain("savePersonProfile");
  });

  it("四柱记录随排盘自动写入，无需用户再点一次", () => {
    expect(read("app/bazi/pillars-step.tsx")).toContain("autoRecord");
  });
});

describe("人物档案与记录来源标识", () => {
  it("同一命盘属于不同人物时来源标识不同", () => {
    const first: BaziProfileActivity = { profileId: "p-1", personName: "张三", personRelation: "本人" };
    const second: BaziProfileActivity = { profileId: "p-2", personName: "李四", personRelation: "家人" };

    expect(chartSourceId(CHART, personKey(first))).not.toBe(chartSourceId(CHART, personKey(second)));
  });

  it("相同人物与相同的四柱重复收藏时指向同一条记录", () => {
    const person: BaziProfileActivity = { profileId: "p-1", personName: "张三", personRelation: "本人" };

    expect(chartSourceId(CHART, personKey(person))).toBe(chartSourceId(CHART, personKey(person)));
  });

  it("来源标识长度在接口上限之内", () => {
    const long: BaziProfileActivity = { personName: "名".repeat(120), personRelation: "其他" };
    const id = `${chartSourceId(CHART, personKey(long))}:advisory`;

    expect(personKey(long).length).toBeLessThanOrEqual(60);
    expect(id.length).toBeLessThan(255);
  });
});
