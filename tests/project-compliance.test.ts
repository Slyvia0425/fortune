import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { BaziChartResult } from "../lib/contracts/bazi";

const root = process.cwd();

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8")) as T;
}

function readText(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function envValue(source: string, key: string): string | undefined {
  const match = source.match(new RegExp(`^${key}=(.+)$`, "m"));
  return match?.[1]?.trim();
}

function portOf(value: string): number {
  return new URL(value).port === "" ? 80 : Number(new URL(value).port);
}

describe("数据资产合规", () => {
  it("知识库包含 764 条可追溯且字段完整的数据", () => {
    type Page = {
      url?: string;
      title?: string;
      source?: string;
      catalog?: string;
      category?: string[];
      content?: string;
    };
    const pages = readJson<Page[]>("data/knowledge_sources_complete/knowledge_sources_pages.json");

    expect(pages).toHaveLength(764);
    expect(new Set(pages.map((page) => page.url)).size).toBe(764);
    for (const page of pages) {
      expect(page.url).toBeTruthy();
      expect(page.title).toBeTruthy();
      expect(page.source).toBeTruthy();
      expect(page.catalog).toBeTruthy();
      expect(Array.isArray(page.category)).toBe(true);
      expect(page.content?.trim()).toBeTruthy();
    }
  });

  it("观音签库包含完整且无重复的 100 签", () => {
    type Stick = {
      id?: number;
      title?: string;
      level?: string;
      poem?: string[];
      traditional?: {
        jieyue?: string;
        xianji?: string;
        topics?: Record<string, string>;
      };
    };
    const sticks = readJson<Stick[]>("sticks/guanyin.json");

    expect(sticks).toHaveLength(100);
    expect(new Set(sticks.map((stick) => stick.id)).size).toBe(100);
    for (const stick of sticks) {
      expect(Number.isInteger(stick.id)).toBe(true);
      expect(stick.title).toBeTruthy();
      expect(stick.level).toBeTruthy();
      expect(stick.poem).toHaveLength(4);
      expect(stick.traditional?.jieyue).toBeTruthy();
      expect(stick.traditional?.xianji).toBeTruthy();
      expect(Object.keys(stick.traditional?.topics ?? {})).toHaveLength(6);
    }
  });
});

describe("运行协议合规", () => {
  it("组合算法服务与 Module 4 使用独立地址", () => {
    const envExample = readText(".env.example");
    const algorithmBaseUrl = envValue(envExample, "PYTHON_ALGORITHM_BASE_URL");
    const module4BaseUrl = envValue(envExample, "MODULE4_API_BASE_URL");

    expect(algorithmBaseUrl).toBeTruthy();
    expect(module4BaseUrl).toBeTruthy();

    const ports = [algorithmBaseUrl!, module4BaseUrl!].map(portOf);
    expect(new Set(ports).size).toBe(2);
  });

  it("前端适配层显式区分八字和易卦后端", () => {
    const client = readText("lib/server/python-client.ts");
    const baziService = readText("lib/bazi/service.ts");
    const divinationService = readText("lib/divination/service.ts");

    expect(client).toContain("PYTHON_BAZI_BASE_URL");
    expect(client).toContain("PYTHON_DIVINATION_BASE_URL");
    expect(baziService).toMatch(/callPython<[^>]+>\("bazi"/);
    expect(divinationService).toMatch(/callPython<[^>]+>\("divination"/);
  });

  it("本地目录包含自动启动和全栈验收脚本", () => {
    expect(existsSync(resolve(root, "scripts/start-local.sh"))).toBe(true);
    expect(existsSync(resolve(root, "scripts/verify-stack.mjs"))).toBe(true);
  });

  it("典籍结果先进入本地详情页，原始来源作为外链保留", () => {
    expect(existsSync(resolve(root, "app/knowledge/[id]/page.tsx"))).toBe(true);
    const search = readText("app/knowledge/search.tsx");
    const detail = readText("app/knowledge/[id]/page.tsx");
    expect(search).toContain("/knowledge/${x.id}");
    expect(detail).toContain("getKnowledgePageById");
    expect(detail).toContain('target="_blank"');
  });

  it("智库跨模块检索同时覆盖公开资料与个人资料", () => {
    expect(existsSync(resolve(root, "lib/agent/catalog.ts"))).toBe(true);
    expect(existsSync(resolve(root, "app/api/agent/search/route.ts"))).toBe(true);
    const catalog = readText("lib/agent/catalog.ts");
    expect(catalog).toContain('kind: "guanyin"');
    expect(catalog).toContain('kind: "bazi"');
    expect(catalog).toContain('kind: "divination"');
  });
});

describe("Bazi 前后端契约合规", () => {
  it("内置降级数据完全符合 TypeScript 协议并可渲染", async () => {
    const { createMockBaziChart } = await import("../lib/bazi/mock");
    const chart: BaziChartResult = createMockBaziChart({
      birth_date: "2000-01-01",
      birth_time: "12:30",
      birth_place: {
        country_code: "SG",
        country: "新加坡",
        city: "新加坡",
        latitude: 1.3521,
        longitude: 103.8198,
        source: "dropdown",
      },
      gender: "unspecified",
      calendar: "solar",
    });

    const stems = new Set([
      "jia",
      "yi",
      "bing",
      "ding",
      "wu",
      "ji",
      "geng",
      "xin",
      "ren",
      "gui",
    ]);
    const branches = new Set([
      "zi",
      "chou",
      "yin",
      "mao",
      "chen",
      "si",
      "wu_branch",
      "wei",
      "shen",
      "you",
      "xu",
      "hai",
    ]);
    const elements = new Set(["wood", "fire", "earth", "metal", "water"]);
    const labels = new Set(["year", "month", "day", "hour"]);

    expect(chart.resolved_time.solar_date).toBe("2000-01-01");
    expect(chart.pillars.map((pillar) => pillar.label).sort()).toEqual([...labels].sort());
    for (const pillar of chart.pillars) {
      expect(stems.has(pillar.stem)).toBe(true);
      expect(branches.has(pillar.branch)).toBe(true);
      expect(elements.has(pillar.element)).toBe(true);
      for (const hidden of pillar.hidden_stems) {
        expect(stems.has(hidden.stem)).toBe(true);
        expect(elements.has(hidden.element)).toBe(true);
      }
    }
    expect(Object.keys(chart.elements).sort()).toEqual([...elements].sort());
    expect(chart.day_master.stem).toBe("jia");
    expect(chart.day_master.element).toBe("wood");
    expect(chart.meta?.mock).toBe(true);
    expect(chart.advisory.map((entry) => entry.domain).sort()).toEqual([
      "career",
      "study",
      "wealth",
    ]);
  });

  it("适配层向上传播 Python 返回的真实 Mock 状态", () => {
    const service = readText("lib/bazi/service.ts");
    expect(service).toMatch(/mock\s*:\s*data\.meta\?\.mock\s*\?\?\s*false/);
  });
});
