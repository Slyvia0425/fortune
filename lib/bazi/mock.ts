import type {
  BaziChartRequest,
  BaziChartResult,
  BaziPillar,
  HiddenStem,
} from "@/lib/contracts/bazi";

const MOCK_WARNING =
  "Python 八字服务未配置或不可用，当前返回完整的协议兼容占位数据，不代表真实排盘结果。";

function hiddenStem(
  stem: HiddenStem["stem"],
  element: HiddenStem["element"],
  qi: HiddenStem["qi"],
  tenGod: HiddenStem["ten_god"],
): HiddenStem {
  return { stem, element, qi, ten_god: tenGod };
}

function pillars(): BaziPillar[] {
  return [
    {
      label: "year",
      stem: "geng",
      branch: "chen",
      element: "metal",
      ten_god: "seven_killings",
      hidden_stems: [
        hiddenStem("wu", "earth", "primary", "direct_wealth"),
        hiddenStem("yi", "wood", "middle", "rob_wealth"),
        hiddenStem("gui", "water", "residual", "direct_resource"),
      ],
    },
    {
      label: "month",
      stem: "wu",
      branch: "yin",
      element: "earth",
      ten_god: "direct_wealth",
      hidden_stems: [
        hiddenStem("jia", "wood", "primary", "friend"),
        hiddenStem("bing", "fire", "middle", "eating_god"),
        hiddenStem("wu", "earth", "residual", "direct_wealth"),
      ],
    },
    {
      label: "day",
      stem: "jia",
      branch: "zi",
      element: "wood",
      ten_god: null,
      hidden_stems: [hiddenStem("gui", "water", "primary", "direct_resource")],
    },
    {
      label: "hour",
      stem: "bing",
      branch: "yin",
      element: "fire",
      ten_god: "eating_god",
      hidden_stems: [
        hiddenStem("jia", "wood", "primary", "friend"),
        hiddenStem("bing", "fire", "middle", "eating_god"),
        hiddenStem("wu", "earth", "residual", "direct_wealth"),
      ],
    },
  ];
}

export function createMockBaziChart(input: BaziChartRequest): BaziChartResult {
  const currentYear = new Date().getFullYear();

  return {
    resolved_time: {
      solar_date: input.birth_date,
      civil_time: input.birth_time,
      timezone: input.timezone || "Asia/Singapore",
      utc_offset_minutes: 480,
      dst_applied: false,
      longitude_correction_minutes: 0,
      equation_of_time_minutes: 0,
      true_solar_time: input.birth_time,
      crossed_pillar_boundary: false,
    },
    pillars: pillars(),
    elements: {
      wood: 24,
      fire: 16,
      earth: 22,
      metal: 25,
      water: 13,
    },
    luck_cycles: [
      {
        start_age: 8,
        end_age: 17,
        start_year: 2008,
        end_year: 2017,
        stem: "ding",
        branch: "mao",
      },
      {
        start_age: 18,
        end_age: 27,
        start_year: 2018,
        end_year: 2027,
        stem: "wu",
        branch: "chen",
      },
    ],
    current_period: {
      year: { year: currentYear, stem: "geng", branch: "wu_branch" },
      month: { stem: "bing", branch: "yin" },
      day: { stem: "jia", branch: "zi" },
    },
    day_master: {
      stem: "jia",
      element: "wood",
      strength: "somewhat_strong",
    },
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
        disposition: "neutral",
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
      useful: ["water", "wood"],
      unfavourable: ["metal"],
      rationale: "占位数据，仅用于验证接口结构与前端渲染。",
    },
    reasoning_trace: {
      factors: [
        {
          key: "seasonal_command",
          score: 1,
          weight: 0.4,
          weighted_score: 0.4,
          evidence: ["占位：月支寅木支持日主"],
        },
        {
          key: "rootedness",
          score: 0.6,
          weight: 0.3,
          weighted_score: 0.18,
          evidence: ["占位：甲木通根时支寅"],
        },
        {
          key: "revealed_support",
          score: 0.2,
          weight: 0.2,
          weighted_score: 0.04,
          evidence: ["占位：天干未见直接生扶"],
        },
        {
          key: "assisting_support",
          score: 0.5,
          weight: 0.1,
          weighted_score: 0.05,
          evidence: ["占位：日支子水滋养日主"],
        },
      ],
      fused_score: 0.67,
      threshold_band: "0.60 - 0.80",
      provisional_strength: "somewhat_strong",
      override: null,
      final_strength: "somewhat_strong",
      near_threshold: false,
      sources: [
        {
          source_id: "ziping-zhenquan",
          title: "子平真诠",
          edition: "徐乐吾评注本",
          chapter: "占位",
        },
      ],
    },
    advisory: [
      {
        domain: "career",
        categories: [
          {
            category: "management",
            display_name: "管理 / 组织",
            rank: 1,
            fit_score: 3,
            strengths: ["结构化判断"],
            considerations: ["仍需结合真实经历"],
            citations: [
              {
                ten_god: "seven_killings",
                disposition: "useful",
                points: 3,
                evidence: ["占位：年干七杀"],
              },
            ],
          },
        ],
        narrative: "占位内容，仅用于验证职业方向渲染。",
      },
      {
        domain: "study",
        categories: [
          {
            category: "research",
            display_name: "研究 / 分析",
            rank: 1,
            fit_score: 3,
            strengths: ["持续学习"],
            considerations: ["避免只停留在理论"],
            citations: [
              {
                ten_god: "direct_resource",
                disposition: "useful",
                points: 3,
                evidence: ["占位：日支正印"],
              },
            ],
          },
        ],
        narrative: "占位内容，仅用于验证学业方向渲染。",
      },
      {
        domain: "wealth",
        categories: [
          {
            category: "commerce",
            display_name: "经营 / 商业",
            rank: 1,
            fit_score: 2,
            strengths: ["资源整合"],
            considerations: ["重视风险管理"],
            citations: [
              {
                ten_god: "direct_wealth",
                disposition: "useful",
                points: 2,
                evidence: ["占位：月干正财"],
              },
            ],
          },
        ],
        narrative: "占位内容，仅用于验证财富方向渲染。",
      },
    ],
    overview: "这是接口联调用的占位命盘，不代表真实排盘结果。",
    source_refs: [
      {
        source_id: "ziping-zhenquan",
        title: "子平真诠",
        edition: "徐乐吾评注本",
        chapter: "占位",
      },
    ],
    meta: {
      mock: true,
      engine_version: "frontend-mock-v1",
      weight_set: "mock-v1",
      warnings: [MOCK_WARNING],
    },
  };
}
