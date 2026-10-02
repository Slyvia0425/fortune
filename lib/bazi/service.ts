import type { BaziChartRequest, BaziChartResult } from "@/lib/contracts/bazi";
import { callPython, pythonServiceConfigured } from "@/lib/server/python-client";

export async function calculateBazi(
  input: BaziChartRequest,
): Promise<{ data: BaziChartResult; mock: boolean; warnings: string[] }> {
  if (pythonServiceConfigured()) {
    const data = await callPython<BaziChartResult>("/bazi/chart", input);
    return { data, mock: false, warnings: [] };
  }

  const data: BaziChartResult = {
    resolved_time: {
      solar_date: input.birth_date,
      civil_time: input.birth_time,
      timezone: input.timezone ?? "UTC",
      utc_offset_minutes: 0,
      dst_applied: false,
      longitude_correction_minutes: 0,
      equation_of_time_minutes: 0,
      true_solar_time: input.birth_time,
      crossed_pillar_boundary: false,
    },
    // Placeholder like the rest of this fallback; 1.2's climate rules read
    // month_term and the position within the term.
    solar_term: {
      current_term: "bailu",
      current_term_at: `${input.birth_date}T00:00:00`,
      days_since_term: 5,
      next_term: "qiufen",
      next_term_at: `${input.birth_date}T00:00:00`,
      days_to_next_term: 10,
      month_term: "bailu",
      near_boundary: false,
    },
    pillars: [
      {
        label: "year",
        stem: "geng",
        branch: "chen",
        element: "metal",
        ten_god: "seven_killings",
        hidden_stems: [
          { stem: "wu", element: "earth", qi: "primary", ten_god: "direct_wealth" },
        ],
      },
      {
        label: "month",
        stem: "wu",
        branch: "yin",
        element: "earth",
        ten_god: "direct_wealth",
        hidden_stems: [
          { stem: "jia", element: "wood", qi: "primary", ten_god: "friend" },
        ],
      },
      {
        label: "day",
        stem: "jia",
        branch: "zi",
        element: "wood",
        ten_god: null,
        hidden_stems: [
          { stem: "gui", element: "water", qi: "primary", ten_god: "direct_resource" },
        ],
      },
      {
        label: "hour",
        stem: "bing",
        branch: "yin",
        element: "fire",
        ten_god: "eating_god",
        hidden_stems: [
          { stem: "jia", element: "wood", qi: "primary", ten_god: "friend" },
        ],
      },
    ],
    elements: { wood: 3, fire: 2, earth: 2.5, metal: 1, water: 1.5 },
    luck_onset: {
      years: 3,
      months: 4,
      direction: "forward",
      rationale:
        "阳年男命，大运顺排；出生距下一节气 10 天，按三日折一年计，起运 3 岁 4 个月。",
    },
    annual_cycles: [
      { year: 2003, stem: "gui", branch: "wei", stem_element: "water", branch_element: "earth", stem_ten_god: "direct_resource", branch_ten_god: "direct_wealth" },
      { year: 2004, stem: "jia", branch: "shen", stem_element: "wood", branch_element: "metal", stem_ten_god: "friend", branch_ten_god: "seven_killings" },
      { year: 2005, stem: "yi", branch: "you", stem_element: "wood", branch_element: "metal", stem_ten_god: "rob_wealth", branch_ten_god: "direct_officer" },
      { year: 2006, stem: "bing", branch: "xu", stem_element: "fire", branch_element: "earth", stem_ten_god: "eating_god", branch_ten_god: "indirect_wealth" },
      { year: 2007, stem: "ding", branch: "hai", stem_element: "fire", branch_element: "water", stem_ten_god: "hurting_officer", branch_ten_god: "direct_resource" },
      { year: 2008, stem: "wu", branch: "zi", stem_element: "earth", branch_element: "water", stem_ten_god: "indirect_wealth", branch_ten_god: "indirect_resource" },
      { year: 2009, stem: "ji", branch: "chou", stem_element: "earth", branch_element: "earth", stem_ten_god: "direct_wealth", branch_ten_god: "direct_wealth" },
      { year: 2010, stem: "geng", branch: "yin", stem_element: "metal", branch_element: "wood", stem_ten_god: "seven_killings", branch_ten_god: "friend" },
      { year: 2011, stem: "xin", branch: "mao", stem_element: "metal", branch_element: "wood", stem_ten_god: "direct_officer", branch_ten_god: "rob_wealth" },
      { year: 2012, stem: "ren", branch: "chen", stem_element: "water", branch_element: "earth", stem_ten_god: "indirect_resource", branch_ten_god: "indirect_wealth" },
      { year: 2013, stem: "gui", branch: "si", stem_element: "water", branch_element: "fire", stem_ten_god: "direct_resource", branch_ten_god: "hurting_officer" },
      { year: 2014, stem: "jia", branch: "wu_branch", stem_element: "wood", branch_element: "fire", stem_ten_god: "friend", branch_ten_god: "eating_god" },
      { year: 2015, stem: "yi", branch: "wei", stem_element: "wood", branch_element: "earth", stem_ten_god: "rob_wealth", branch_ten_god: "direct_wealth" },
      { year: 2016, stem: "bing", branch: "shen", stem_element: "fire", branch_element: "metal", stem_ten_god: "eating_god", branch_ten_god: "seven_killings" },
      { year: 2017, stem: "ding", branch: "you", stem_element: "fire", branch_element: "metal", stem_ten_god: "hurting_officer", branch_ten_god: "direct_officer" },
      { year: 2018, stem: "wu", branch: "xu", stem_element: "earth", branch_element: "earth", stem_ten_god: "indirect_wealth", branch_ten_god: "indirect_wealth" },
      { year: 2019, stem: "ji", branch: "hai", stem_element: "earth", branch_element: "water", stem_ten_god: "direct_wealth", branch_ten_god: "direct_resource" },
      { year: 2020, stem: "geng", branch: "zi", stem_element: "metal", branch_element: "water", stem_ten_god: "seven_killings", branch_ten_god: "indirect_resource" },
      { year: 2021, stem: "xin", branch: "chou", stem_element: "metal", branch_element: "earth", stem_ten_god: "direct_officer", branch_ten_god: "direct_wealth" },
      { year: 2022, stem: "ren", branch: "yin", stem_element: "water", branch_element: "wood", stem_ten_god: "indirect_resource", branch_ten_god: "friend" },
      { year: 2023, stem: "gui", branch: "mao", stem_element: "water", branch_element: "wood", stem_ten_god: "direct_resource", branch_ten_god: "rob_wealth" },
      { year: 2024, stem: "jia", branch: "chen", stem_element: "wood", branch_element: "earth", stem_ten_god: "friend", branch_ten_god: "indirect_wealth" },
      { year: 2025, stem: "yi", branch: "si", stem_element: "wood", branch_element: "fire", stem_ten_god: "rob_wealth", branch_ten_god: "hurting_officer" },
      { year: 2026, stem: "bing", branch: "wu_branch", stem_element: "fire", branch_element: "fire", stem_ten_god: "eating_god", branch_ten_god: "eating_god" },
      { year: 2027, stem: "ding", branch: "wei", stem_element: "fire", branch_element: "earth", stem_ten_god: "hurting_officer", branch_ten_god: "direct_wealth" },
      { year: 2028, stem: "wu", branch: "shen", stem_element: "earth", branch_element: "metal", stem_ten_god: "indirect_wealth", branch_ten_god: "seven_killings" },
      { year: 2029, stem: "ji", branch: "you", stem_element: "earth", branch_element: "metal", stem_ten_god: "direct_wealth", branch_ten_god: "direct_officer" },
      { year: 2030, stem: "geng", branch: "xu", stem_element: "metal", branch_element: "earth", stem_ten_god: "seven_killings", branch_ten_god: "indirect_wealth" },
      { year: 2031, stem: "xin", branch: "hai", stem_element: "metal", branch_element: "water", stem_ten_god: "direct_officer", branch_ten_god: "direct_resource" },
      { year: 2032, stem: "ren", branch: "zi", stem_element: "water", branch_element: "water", stem_ten_god: "indirect_resource", branch_ten_god: "indirect_resource" },
      { year: 2033, stem: "gui", branch: "chou", stem_element: "water", branch_element: "earth", stem_ten_god: "direct_resource", branch_ten_god: "direct_wealth" },
      { year: 2034, stem: "jia", branch: "yin", stem_element: "wood", branch_element: "wood", stem_ten_god: "friend", branch_ten_god: "friend" },
      { year: 2035, stem: "yi", branch: "mao", stem_element: "wood", branch_element: "wood", stem_ten_god: "rob_wealth", branch_ten_god: "rob_wealth" },
      { year: 2036, stem: "bing", branch: "chen", stem_element: "fire", branch_element: "earth", stem_ten_god: "eating_god", branch_ten_god: "indirect_wealth" },
      { year: 2037, stem: "ding", branch: "si", stem_element: "fire", branch_element: "fire", stem_ten_god: "hurting_officer", branch_ten_god: "hurting_officer" },
      { year: 2038, stem: "wu", branch: "wu_branch", stem_element: "earth", branch_element: "fire", stem_ten_god: "indirect_wealth", branch_ten_god: "eating_god" },
      { year: 2039, stem: "ji", branch: "wei", stem_element: "earth", branch_element: "earth", stem_ten_god: "direct_wealth", branch_ten_god: "direct_wealth" },
      { year: 2040, stem: "geng", branch: "shen", stem_element: "metal", branch_element: "metal", stem_ten_god: "seven_killings", branch_ten_god: "seven_killings" },
      { year: 2041, stem: "xin", branch: "you", stem_element: "metal", branch_element: "metal", stem_ten_god: "direct_officer", branch_ten_god: "direct_officer" },
      { year: 2042, stem: "ren", branch: "xu", stem_element: "water", branch_element: "earth", stem_ten_god: "indirect_resource", branch_ten_god: "indirect_wealth" },
      { year: 2043, stem: "gui", branch: "hai", stem_element: "water", branch_element: "water", stem_ten_god: "direct_resource", branch_ten_god: "direct_resource" },
      { year: 2044, stem: "jia", branch: "zi", stem_element: "wood", branch_element: "water", stem_ten_god: "friend", branch_ten_god: "indirect_resource" },
      { year: 2045, stem: "yi", branch: "chou", stem_element: "wood", branch_element: "earth", stem_ten_god: "rob_wealth", branch_ten_god: "direct_wealth" },
      { year: 2046, stem: "bing", branch: "yin", stem_element: "fire", branch_element: "wood", stem_ten_god: "eating_god", branch_ten_god: "friend" },
      { year: 2047, stem: "ding", branch: "mao", stem_element: "fire", branch_element: "wood", stem_ten_god: "hurting_officer", branch_ten_god: "rob_wealth" },
      { year: 2048, stem: "wu", branch: "chen", stem_element: "earth", branch_element: "earth", stem_ten_god: "indirect_wealth", branch_ten_god: "indirect_wealth" },
      { year: 2049, stem: "ji", branch: "si", stem_element: "earth", branch_element: "fire", stem_ten_god: "direct_wealth", branch_ten_god: "hurting_officer" },
      { year: 2050, stem: "geng", branch: "wu_branch", stem_element: "metal", branch_element: "fire", stem_ten_god: "seven_killings", branch_ten_god: "eating_god" },
      { year: 2051, stem: "xin", branch: "wei", stem_element: "metal", branch_element: "earth", stem_ten_god: "direct_officer", branch_ten_god: "direct_wealth" },
      { year: 2052, stem: "ren", branch: "shen", stem_element: "water", branch_element: "metal", stem_ten_god: "indirect_resource", branch_ten_god: "seven_killings" },
      { year: 2053, stem: "gui", branch: "you", stem_element: "water", branch_element: "metal", stem_ten_god: "direct_resource", branch_ten_god: "direct_officer" },
      { year: 2054, stem: "jia", branch: "xu", stem_element: "wood", branch_element: "earth", stem_ten_god: "friend", branch_ten_god: "indirect_wealth" },
      { year: 2055, stem: "yi", branch: "hai", stem_element: "wood", branch_element: "water", stem_ten_god: "rob_wealth", branch_ten_god: "direct_resource" },
      { year: 2056, stem: "bing", branch: "zi", stem_element: "fire", branch_element: "water", stem_ten_god: "eating_god", branch_ten_god: "indirect_resource" },
      { year: 2057, stem: "ding", branch: "chou", stem_element: "fire", branch_element: "earth", stem_ten_god: "hurting_officer", branch_ten_god: "direct_wealth" },
      { year: 2058, stem: "wu", branch: "yin", stem_element: "earth", branch_element: "wood", stem_ten_god: "indirect_wealth", branch_ten_god: "friend" },
      { year: 2059, stem: "ji", branch: "mao", stem_element: "earth", branch_element: "wood", stem_ten_god: "direct_wealth", branch_ten_god: "rob_wealth" },
      { year: 2060, stem: "geng", branch: "chen", stem_element: "metal", branch_element: "earth", stem_ten_god: "seven_killings", branch_ten_god: "indirect_wealth" },
      { year: 2061, stem: "xin", branch: "si", stem_element: "metal", branch_element: "fire", stem_ten_god: "direct_officer", branch_ten_god: "hurting_officer" },
      { year: 2062, stem: "ren", branch: "wu_branch", stem_element: "water", branch_element: "fire", stem_ten_god: "indirect_resource", branch_ten_god: "eating_god" },
      { year: 2063, stem: "gui", branch: "wei", stem_element: "water", branch_element: "earth", stem_ten_god: "direct_resource", branch_ten_god: "direct_wealth" },
      { year: 2064, stem: "jia", branch: "shen", stem_element: "wood", branch_element: "metal", stem_ten_god: "friend", branch_ten_god: "seven_killings" },
      { year: 2065, stem: "yi", branch: "you", stem_element: "wood", branch_element: "metal", stem_ten_god: "rob_wealth", branch_ten_god: "direct_officer" },
      { year: 2066, stem: "bing", branch: "xu", stem_element: "fire", branch_element: "earth", stem_ten_god: "eating_god", branch_ten_god: "indirect_wealth" },
      { year: 2067, stem: "ding", branch: "hai", stem_element: "fire", branch_element: "water", stem_ten_god: "hurting_officer", branch_ten_god: "direct_resource" },
      { year: 2068, stem: "wu", branch: "zi", stem_element: "earth", branch_element: "water", stem_ten_god: "indirect_wealth", branch_ten_god: "indirect_resource" },
      { year: 2069, stem: "ji", branch: "chou", stem_element: "earth", branch_element: "earth", stem_ten_god: "direct_wealth", branch_ten_god: "direct_wealth" },
      { year: 2070, stem: "geng", branch: "yin", stem_element: "metal", branch_element: "wood", stem_ten_god: "seven_killings", branch_ten_god: "friend" },
      { year: 2071, stem: "xin", branch: "mao", stem_element: "metal", branch_element: "wood", stem_ten_god: "direct_officer", branch_ten_god: "rob_wealth" },
      { year: 2072, stem: "ren", branch: "chen", stem_element: "water", branch_element: "earth", stem_ten_god: "indirect_resource", branch_ten_god: "indirect_wealth" },
      { year: 2073, stem: "gui", branch: "si", stem_element: "water", branch_element: "fire", stem_ten_god: "direct_resource", branch_ten_god: "hurting_officer" },
      { year: 2074, stem: "jia", branch: "wu_branch", stem_element: "wood", branch_element: "fire", stem_ten_god: "friend", branch_ten_god: "eating_god" },
      { year: 2075, stem: "yi", branch: "wei", stem_element: "wood", branch_element: "earth", stem_ten_god: "rob_wealth", branch_ten_god: "direct_wealth" },
      { year: 2076, stem: "bing", branch: "shen", stem_element: "fire", branch_element: "metal", stem_ten_god: "eating_god", branch_ten_god: "seven_killings" },
      { year: 2077, stem: "ding", branch: "you", stem_element: "fire", branch_element: "metal", stem_ten_god: "hurting_officer", branch_ten_god: "direct_officer" },
      { year: 2078, stem: "wu", branch: "xu", stem_element: "earth", branch_element: "earth", stem_ten_god: "indirect_wealth", branch_ten_god: "indirect_wealth" },
      { year: 2079, stem: "ji", branch: "hai", stem_element: "earth", branch_element: "water", stem_ten_god: "direct_wealth", branch_ten_god: "direct_resource" },
      { year: 2080, stem: "geng", branch: "zi", stem_element: "metal", branch_element: "water", stem_ten_god: "seven_killings", branch_ten_god: "indirect_resource" },
      { year: 2081, stem: "xin", branch: "chou", stem_element: "metal", branch_element: "earth", stem_ten_god: "direct_officer", branch_ten_god: "direct_wealth" },
      { year: 2082, stem: "ren", branch: "yin", stem_element: "water", branch_element: "wood", stem_ten_god: "indirect_resource", branch_ten_god: "friend" },
    ],
    luck_cycles: [
      { start_age: 3, end_age: 12, start_year: 2003, end_year: 2012, stem: "ji", branch: "mao", stem_element: "earth", branch_element: "wood", stem_ten_god: "direct_wealth", branch_ten_god: "rob_wealth" },
      { start_age: 13, end_age: 22, start_year: 2013, end_year: 2022, stem: "geng", branch: "chen", stem_element: "metal", branch_element: "earth", stem_ten_god: "seven_killings", branch_ten_god: "indirect_wealth" },
      { start_age: 23, end_age: 32, start_year: 2023, end_year: 2032, stem: "xin", branch: "si", stem_element: "metal", branch_element: "fire", stem_ten_god: "direct_officer", branch_ten_god: "hurting_officer" },
      { start_age: 33, end_age: 42, start_year: 2033, end_year: 2042, stem: "ren", branch: "wu_branch", stem_element: "water", branch_element: "fire", stem_ten_god: "indirect_resource", branch_ten_god: "eating_god" },
      { start_age: 43, end_age: 52, start_year: 2043, end_year: 2052, stem: "gui", branch: "wei", stem_element: "water", branch_element: "earth", stem_ten_god: "direct_resource", branch_ten_god: "direct_wealth" },
      { start_age: 53, end_age: 62, start_year: 2053, end_year: 2062, stem: "jia", branch: "shen", stem_element: "wood", branch_element: "metal", stem_ten_god: "friend", branch_ten_god: "seven_killings" },
      { start_age: 63, end_age: 72, start_year: 2063, end_year: 2072, stem: "yi", branch: "you", stem_element: "wood", branch_element: "metal", stem_ten_god: "rob_wealth", branch_ten_god: "direct_officer" },
      { start_age: 73, end_age: 82, start_year: 2073, end_year: 2082, stem: "bing", branch: "xu", stem_element: "fire", branch_element: "earth", stem_ten_god: "eating_god", branch_ten_god: "indirect_wealth" },
    ],
    current_period: {
      year: { year: 2026, stem: "bing", branch: "wu_branch", stem_element: "fire", branch_element: "fire" },
      month: { stem: "ding", branch: "you", stem_element: "fire", branch_element: "metal" },
      day: { stem: "ren", branch: "xu", stem_element: "water", branch_element: "earth" },
    },
    day_master: { stem: "jia", element: "wood", strength: "somewhat_strong" },
    ten_gods: [
      {
        pillar: "year",
        position: "stem",
        ten_god: "seven_killings",
        element: "metal",
        disposition: "unfavourable",
      },
      {
        pillar: "month",
        position: "stem",
        ten_god: "direct_wealth",
        element: "earth",
        disposition: "useful",
      },
      {
        pillar: "hour",
        position: "stem",
        ten_god: "eating_god",
        element: "fire",
        disposition: "useful",
      },
    ],
    disposition: {
      useful: ["fire", "earth"],
      unfavourable: ["wood", "water"],
      rationale: "模拟数据仅用于验证接口和页面结构。",
    },
    // Same shape as the Python mock: a real conflict, resolved by the priority
    // rule, so the page shows the whole arbitration even without the service.
    derivation: {
      methods: [
        {
          method: "supporting",
          basis: "日主偏旺，取克泄之神",
          rule_id: "R-YONGSHEN-01",
          source_id: "ziping-zhenquan",
          useful: ["fire", "earth"],
          unfavourable: ["wood", "water"],
        },
        {
          method: "climatic",
          basis: "正月甲木，木嫩气寒，先丙后癸",
          rule_id: "R-TIAOHOU-0101",
          source_id: "qiongtong-baojian",
          useful: ["fire", "water"],
        },
      ],
      arbitration: {
        conflict: true,
        outcome: "supporting",
        rule_id: "R-ZHONGCAI-01",
        source_id: "ziping-zhenquan",
        rationale:
          "日主属木而生于春季，不属「金水生于冬令、木火生于夏令」之调候为急，故以扶抑为主。",
      },
    },
    reasoning_trace: {
      // Four factors so the page shows the whole arbitration shape even when
      // the Python service isn't running; the weights sum to 1 as they will.
      factors: [
        { key: "seasonal_command", rule_id: "R-DELING-01", source_id: "ziping-zhenquan", score: 0.6, weight: 0.4, weighted_score: 0.24, evidence: ["模拟：月令因素"] },
        { key: "rootedness", rule_id: "R-DEDI-02", source_id: "ziping-zhenquan", score: 0.5, weight: 0.3, weighted_score: 0.15, evidence: ["模拟：地支通根"] },
        { key: "revealed_support", rule_id: "R-DESHI-03", source_id: "ziping-zhenquan", score: 0.4, weight: 0.2, weighted_score: 0.08, evidence: ["模拟：天干透出"] },
        { key: "assisting_support", rule_id: "R-DEZHU-01", source_id: "ziping-zhenquan", score: 0.3, weight: 0.1, weighted_score: 0.03, evidence: ["模拟：生扶力量"] },
      ],
      fused_score: 0.5,
      threshold_band: "mock",
      provisional_strength: "somewhat_strong",
      override: null,
      final_strength: "somewhat_strong",
      near_threshold: false,
      sources: [],
    },
    domain_tallies: [
      {
        domain: "career",
        groups: [
          { group: "officer", category: "管理 / 组织", count: 1, disposition: "unfavourable", gloss: "主管理、权威、约束", quotation: "正官者分所当尊，如在国有君，在家有亲", source_id: "ziping-zhenquan", chapter: "论正官", occurrences: [{ pillar: "year", position: "stem", stem: "geng", element: "metal", ten_god: "seven_killings", disposition: "unfavourable" }], narrative: "本命局中官杀出现 1 处，见于年柱庚（七杀），命局诊断判为忌神。典籍称官杀主管理、权威、约束。" },
          { group: "wealth", category: "经营 / 资源调配", count: 1, disposition: "useful", gloss: "主经营、资源调配", quotation: "故财要得时，不要财多", source_id: "yuanhai-ziping", chapter: "论正财", occurrences: [{ pillar: "month", position: "stem", stem: "wu", element: "earth", ten_god: "direct_wealth", disposition: "useful" }], narrative: "本命局中财出现 1 处，见于月柱戊（正财），命局诊断判为用神。典籍称财主经营、资源调配。" },
          { group: "output", category: "表达 / 才艺", count: 1, disposition: "useful", gloss: "主表达、才华外显", quotation: "伤官主人多才艺、傲物气高", source_id: "yuanhai-ziping", chapter: "论伤官", occurrences: [{ pillar: "hour", position: "stem", stem: "bing", element: "fire", ten_god: "eating_god", disposition: "useful" }], narrative: "本命局中食伤出现 1 处，见于时柱丙（食神），命局诊断判为用神。典籍称食伤主表达、才华外显。" },
          { group: "companion", category: "自主 / 协作", count: 0, disposition: "neutral", gloss: "主自主、同侪", occurrences: [], narrative: "本命局中未见比劫。典籍称比劫主自主、同侪。" },
        ],
        narrative: "这是接口联调用的模拟文本，正式实现后由 LLM 依上列条目转述。",
      },
      {
        domain: "study",
        groups: [
          { group: "resource", category: "学问 / 受教", count: 1, disposition: "neutral", gloss: "主学问、受教", quotation: "大抵人生得物以相助相生相养，故主人多智虑，兼丰厚", source_id: "yuanhai-ziping", chapter: "论印绶", occurrences: [{ pillar: "day", position: "hidden", stem: "gui", element: "water", ten_god: "direct_resource", disposition: "neutral" }], narrative: "本命局中印出现 1 处，见于日柱藏干癸（正印）。典籍称印主学问、受教。" },
          { group: "output", category: "才艺 / 创作", count: 1, disposition: "useful", gloss: "主才华表达", quotation: "伤官主人多才艺、傲物气高", source_id: "yuanhai-ziping", chapter: "论伤官", occurrences: [{ pillar: "hour", position: "stem", stem: "bing", element: "fire", ten_god: "eating_god", disposition: "useful" }], narrative: "本命局中食伤出现 1 处，见于时柱丙（食神），命局诊断判为用神。典籍称食伤主才华表达。" },
        ],
        narrative: "这是接口联调用的模拟文本，正式实现后由 LLM 依上列条目转述。",
      },
      {
        domain: "wealth",
        groups: [
          { group: "wealth", category: "财之本体", count: 1, disposition: "useful", gloss: "财星为财运本体", quotation: "故财要得时，不要财多", source_id: "yuanhai-ziping", chapter: "论正财", occurrences: [{ pillar: "month", position: "stem", stem: "wu", element: "earth", ten_god: "direct_wealth", disposition: "useful" }], narrative: "本命局中财出现 1 处，见于月柱戊（正财），命局诊断判为用神。典籍称财财星为财运本体。" },
          { group: "output", category: "以才艺生财", count: 1, disposition: "useful", gloss: "食伤生财，为财的来源通道", quotation: "食神者，生我财神之谓也", source_id: "yuanhai-ziping", chapter: "论食神", occurrences: [{ pillar: "hour", position: "stem", stem: "bing", element: "fire", ten_god: "eating_god", disposition: "useful" }], narrative: "本命局中食伤出现 1 处，见于时柱丙（食神），命局诊断判为用神。典籍称食伤食伤生财，为财的来源通道。" },
          { group: "companion", category: "协作与分担", count: 0, disposition: "neutral", gloss: "比劫克财", occurrences: [], narrative: "本命局中未见比劫。典籍称比劫比劫克财。" },
        ],
        narrative: "这是接口联调用的模拟文本，正式实现后由 LLM 依上列条目转述。",
      },
    ],
    overview: "这是接口联调用的模拟命盘，不代表真实排盘结果。",
    source_refs: [
      // Must exist for the factor rows' source_id to resolve; otherwise the
      // expanded row shows a rule with no citation behind it.
      {
        source_id: "ziping-zhenquan",
        title: "子平真诠评注",
        edition: "徐乐吾注",
        chapter: "论用神",
      },
      {
        source_id: "yuanhai-ziping",
        title: "渊海子平",
        edition: "明刻本",
        chapter: "论十神各篇",
      },
      {
        source_id: "qiongtong-baojian",
        title: "穷通宝鉴",
        edition: "徐乐吾评注",
        chapter: "正月甲木",
      },
    ],
    meta: {
      mock: true,
      engine_version: "next-fallback-v1",
      warnings: ["Python 八字算法服务尚未配置，当前返回契约兼容的模拟结果。"],
    },
  };

  return {
    data,
    mock: true,
    warnings: ["Python 八字算法服务尚未配置，当前返回契约兼容的模拟结果。"],
  };
}
