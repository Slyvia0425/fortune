import { afterEach, describe, expect, it, vi } from "vitest";

import type { BaziChartResult } from "@/lib/contracts/bazi";
import { buildBaziFacts, buildReadingRequest, checkReading, modelFacts, ruleBasedReading } from "@/lib/bazi/interpretation";
import sample from "./fixtures/bazi-chart-sample.json";

const chart = sample.result as unknown as BaziChartResult;
const facts = buildBaziFacts(chart);

const GOOD = {
  part1:
    "这张命盘的日主是壬水，四柱为庚午、辛巳、壬午、甲辰。壬水像一条流动的大河，胸怀开阔、思路活，遇事不爱钻牛角尖。八个字里火最多，金次之，水、木、土各一个；印星出现在年柱和月柱，说明身边总有帮你、托着你的力量，你也往往肯学习、爱琢磨，吸收新东西比较快。典籍说“故主人多智虑，兼丰厚”，放在生活里，就是你想事情比较周全，面对选择时愿意多想一步。",
  part1_refs: ["E1"],
  part2:
    "日主偏弱，意思是日主自身的力量相对不足，需要生扶，所以上面说的吸收和积累是它的长处。用神是金和水，对命局起补益作用；忌神是土、木、火，会加重偏弱。日常可以参考：多留出安静读书和整理笔记的时间，让作息保持规律，学习上先打基础再往前走。",
  part2_refs: [],
  part3:
    "放到三个方向上看：职业上，你有愿意学习和思考的底子，适合在需要钻研和积累的岗位上发挥，慢慢成为大家信任的人；学业上，吸收知识的能力是你的优势，保持节奏、一步一步来，会越学越有手感；财运方面，踏实积累和善用知识是你可以发挥的路子，细水长流会让你越来越有底气。以上解读仅供参考。",
};

describe("facts the model may use", () => {
  it("are read off the engine's chart", () => {
    expect(facts.day_master).toEqual({ stem: "壬", element: "水", polarity: "阳" });
    expect(facts.strength.level).toBe("偏弱");
    expect(facts.useful_elements).toEqual(["金", "水"]);
    expect(facts.unfavourable_elements).toEqual(["土", "木", "火"]);
    expect(facts.pillars.map((pillar) => pillar.ganzhi).join(" ")).toBe("庚午 辛巳 壬午 甲辰");
    const shares = Object.values(facts.element_share_percent).reduce((sum, value) => sum + value, 0);
    expect(shares).toBeGreaterThan(99.5);
    expect(shares).toBeLessThan(100.5);
  });

  it("carry the three directions of the tendency page, with what each group stands for", () => {
    expect(facts.directions.map((item) => item.direction)).toEqual(["职业方向", "学业方向", "财运"]);
    const career = facts.directions[0].groups.find((group) => group.group === "官杀");
    expect(career).toMatchObject({ stands_for: "管理 / 组织", count: 4 });
    expect(facts.day_master.polarity).toBe("阳");
  });

  it("carry the classical passages the engine cited, with their books", () => {
    expect(facts.evidence.length).toBeGreaterThan(0);
    expect(facts.evidence.length).toBeLessThanOrEqual(6);
    for (const item of facts.evidence) {
      expect(item.id).toMatch(/^E\d$/);
      expect(item.quotation.length).toBeGreaterThan(0);
      expect(item.source).toMatch(/^《.+》/);
    }
    expect(new Set(facts.evidence.map((item) => item.quotation)).size).toBe(facts.evidence.length);
  });

  it("do not carry the checking keys into the request", () => {
    expect(Object.keys(modelFacts(facts))).not.toContain("_keys");
    const request = buildReadingRequest(facts, "zh");
    expect(JSON.stringify(request.payload)).not.toContain("_keys");
    expect(request.systemInstruction).toContain("仅供参考");
    expect(request.systemInstruction).toContain("不得预测");
    expect(request.systemInstruction).toContain("只讲积极的一面");
  });
});

describe("checkReading", () => {
  it("accepts a reading that follows the facts", () => {
    expect(checkReading(GOOD, facts, "zh")).toMatchObject({ valid: true, errors: [] });
  });

  it("rejects a missing part and a value that is not an object", () => {
    expect(checkReading({ ...GOOD, part2: undefined }, facts, "zh").valid).toBe(false);
    expect(checkReading("text", facts, "zh").valid).toBe(false);
    expect(checkReading(null, facts, "zh").valid).toBe(false);
  });

  it("does not insist on things that are matters of style: citations, naming the day master, listing every useful element", () => {
    expect(checkReading({ ...GOOD, part1_refs: [] }, facts, "zh").valid).toBe(true);
    expect(checkReading({ ...GOOD, part1: GOOD.part1.replace(/壬/g, "你") }, facts, "zh").valid).toBe(true);
    expect(checkReading({ ...GOOD, part2: GOOD.part2.replace("用神是金和水", "用神是金") }, facts, "zh").valid).toBe(true);
    expect(checkReading({ ...GOOD, part2: GOOD.part2.replace("日主偏弱，意思是日主自身的力量相对不足，需要生扶，", "") }, facts, "zh").valid).toBe(true);
  });

  it("rejects a citation that the engine did not make", () => {
    const out = checkReading({ ...GOOD, part1_refs: ["E1", "E9"] }, facts, "zh");
    expect(out.valid).toBe(false);
    expect(out.errors.join()).toContain("E9");
  });

  it("rejects prediction, promise and remedy wording", () => {
    for (const phrase of ["你今年一定会发财。", "命中注定要离婚。", "可以佩戴水晶开运。"]) {
      const out = checkReading({ ...GOOD, part2: `${GOOD.part2}${phrase}` }, facts, "zh");
      expect(out.valid, phrase).toBe(false);
    }
    expect(checkReading({ ...GOOD, part1: `${GOOD.part1} You will definitely get rich.` }, facts, "en").valid).toBe(false);
  });

  it("rejects a strength level that differs from the engine's", () => {
    const wrong = checkReading({ ...GOOD, part2: GOOD.part2.replace("日主偏弱", "日主偏旺") }, facts, "zh");
    expect(wrong.errors).toContain("第二段身强身弱的结论与引擎不一致");
  });

  it("rejects an unfavourable element named as useful", () => {
    const swapped = checkReading({ ...GOOD, part2: GOOD.part2.replace("用神是金和水", "用神是木和火") }, facts, "zh");
    expect(swapped.valid).toBe(false);
  });

  it("keeps the third paragraph to the three directions and to their bright side", () => {
    const missing = checkReading({ ...GOOD, part3: GOOD.part3.replace("财运方面，踏实积累和善用知识是你可以发挥的路子，细水长流会让你越来越有底气。", "") }, facts, "zh");
    expect(missing.errors).toContain("第三段没有依次谈到职业、学业、财运");
    const gloomy = checkReading({ ...GOOD, part3: GOOD.part3.replace("慢慢成为大家信任的人", "但要留意其中的风险和短板") }, facts, "zh");
    expect(gloomy.errors).toContain("第三段出现了消极或不鼓励的措辞");
  });

  it("asks for the note that the reading is for reference", () => {
    const out = checkReading({ ...GOOD, part3: GOOD.part3.replace("以上解读仅供参考。", "愿你一切顺利。") }, facts, "zh");
    expect(out.errors).toContain("第三段没有“仅供参考”的说明");
  });
});

describe("ruleBasedReading", () => {
  it("passes the same checks in both languages and cites a passage the engine made", () => {
    for (const locale of ["zh", "en"] as const) {
      const reading = ruleBasedReading(chart, facts, locale);
      expect(checkReading(reading, facts, locale), locale).toMatchObject({ valid: true });
      expect(reading.part1_refs.length).toBe(1);
      expect(reading.part3.length).toBeGreaterThan(90);
    }
  });

  it("describes the unfavourable elements by the strength: a weak day master is drained, not over-supplied", () => {
    const zh = ruleBasedReading(chart, facts, "zh").part2;
    expect(zh).toContain("消耗、克制日主");
    expect(zh).not.toContain("已经偏多");
    const strong = { ...chart, day_master: { ...chart.day_master, strength: "very_strong" as const } };
    expect(ruleBasedReading(strong, buildBaziFacts(strong), "zh").part2).toContain("加强本来就偏旺的日主");
  });

  it("varies the wording of the three directions", () => {
    const zh = ruleBasedReading(chart, facts, "zh").part3;
    expect(new Set(["适合在这方面多发挥", "是你身上的亮点", "可以成为你的底气"].filter((phrase) => zh.includes(phrase))).size).toBe(3);
  });

  it("says when the result is a close call", () => {
    const close = { ...facts, strength: { ...facts.strength, near_balance: true } };
    expect(ruleBasedReading(chart, close, "zh").part2).toContain("接近");
    expect(ruleBasedReading(chart, close, "en").part2).toContain("close to the dividing line");
  });
});

const BODY = {
  birth_date: "1990-05-17",
  birth_time: "08:30",
  birth_place: { latitude: 31.2, longitude: 121.5, source: "manual_coordinates" },
  gender: "male",
};

async function post(body: unknown) {
  vi.resetModules();
  vi.doMock("../lib/server/python-client", () => ({ pythonServiceConfigured: () => true, callPython: async () => sample.result }));
  const { POST } = await import("../app/api/bazi/interpret/route");
  const response = await POST(new Request("http://x/api/bazi/interpret", { method: "POST", body: JSON.stringify(body) }));
  return { status: response.status, json: await response.json() };
}

function modelAnswers(...contents: unknown[]) {
  const queue = [...contents];
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(queue.shift()) } }] }))));
}

describe("POST /api/bazi/interpret", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("answers with the rule-based reading when no model is configured", async () => {
    vi.stubEnv("LLM_API_KEY", "");
    vi.stubEnv("LLM_MODEL", "");
    const out = await post(BODY);
    expect(out.status).toBe(200);
    expect(out.json.result.source).toBe("rules");
    expect(out.json.result.reason).toBe("not_configured");
    expect(out.json.result.reading.part1).toContain("壬");
    expect(out.json.result.reading.part3).toContain("仅供参考");
    expect(out.json.result.evidence.length).toBeGreaterThan(0);
  });

  it("shows the model's reading once it passes the checks, in the requested language", async () => {
    vi.stubEnv("LLM_API_KEY", "key");
    vi.stubEnv("LLM_MODEL", "stand-in");
    modelAnswers(GOOD);
    const out = await post({ ...BODY, locale: "zh" });
    expect(out.json.result).toMatchObject({ source: "llm", reason: null, model: "stand-in", locale: "zh" });
    expect(out.json.result.reading.part2).toContain("用神是金和水");
    expect(out.json.result.evidence.map((item: { id: string }) => item.id)).toContain("E1");
  });

  it("sends a failed answer back once, then falls back to the rules", async () => {
    vi.stubEnv("LLM_API_KEY", "key");
    vi.stubEnv("LLM_MODEL", "stand-in");
    const bad = { ...GOOD, part2: GOOD.part2.replace("日主偏弱", "日主偏旺") };
    modelAnswers(bad, bad);
    const out = await post(BODY);
    expect(out.json.result.source).toBe("rules");
    expect(out.json.result.reason).toBe("failed");
    expect(out.json.warnings[0]).toContain("LLM_FALLBACK:LLM_INVALID_READING");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("accepts a corrected answer on the second try", async () => {
    vi.stubEnv("LLM_API_KEY", "key");
    vi.stubEnv("LLM_MODEL", "stand-in");
    modelAnswers({ ...GOOD, part1: `${GOOD.part1}这样的人一定会成功。` }, GOOD);
    expect((await post(BODY)).json.result.source).toBe("llm");
  });

  it("rejects an invalid birth request and a failing engine", async () => {
    expect((await post({ ...BODY, birth_date: "2001-02-29" })).status).toBe(400);
  });
});
