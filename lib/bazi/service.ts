import type { BaziChartRequest, BaziChartResult } from "@/lib/contracts/bazi";
import { callPython, pythonServiceConfigured } from "@/lib/server/python-client";

export async function calculateBazi(
  input: BaziChartRequest,
): Promise<{ data: BaziChartResult; mock: boolean; warnings: string[] }> {
  if (pythonServiceConfigured()) {
    const data = await callPython<BaziChartResult>("/bazi/chart", input);
    return { data, mock: false, warnings: [] };
  }

  const currentYear = new Date().getFullYear();
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
    luck_cycles: [
      { start_age: 3, end_age: 12, start_year: 2003, end_year: 2012, stem: "ji", branch: "mao" },
      { start_age: 13, end_age: 22, start_year: 2013, end_year: 2022, stem: "geng", branch: "chen" },
      { start_age: 23, end_age: 32, start_year: 2023, end_year: 2032, stem: "xin", branch: "si" },
    ],
    current_period: {
      year: { year: currentYear, stem: "bing", branch: "wu_branch" },
      month: { stem: "ding", branch: "you" },
      day: { stem: "ren", branch: "xu" },
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
    reasoning_trace: {
      // Four factors so the page shows the whole arbitration shape even when
      // the Python service isn't running; the weights sum to 1 as they will.
      factors: [
        { key: "seasonal_command", score: 0.6, weight: 0.4, weighted_score: 0.24, evidence: ["模拟：月令因素"] },
        { key: "rootedness", score: 0.5, weight: 0.3, weighted_score: 0.15, evidence: ["模拟：地支通根"] },
        { key: "revealed_support", score: 0.4, weight: 0.2, weighted_score: 0.08, evidence: ["模拟：天干透出"] },
        { key: "assisting_support", score: 0.3, weight: 0.1, weighted_score: 0.03, evidence: ["模拟：生扶力量"] },
      ],
      fused_score: 0.5,
      threshold_band: "mock",
      provisional_strength: "somewhat_strong",
      override: null,
      final_strength: "somewhat_strong",
      near_threshold: false,
      sources: [],
    },
    advisory: [
      { domain: "career", categories: [], narrative: "方向推荐等待正式规则引擎和知识依据接入。" },
      { domain: "study", categories: [], narrative: "学业建议等待正式规则引擎和知识依据接入。" },
      { domain: "wealth", categories: [], narrative: "财运建议等待正式规则引擎和知识依据接入。" },
    ],
    overview: "这是接口联调用的模拟命盘，不代表真实排盘结果。",
    source_refs: [],
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
