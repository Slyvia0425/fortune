/**
 * BaZi module contract (covers 1.1 chart calculation, 1.2 pattern diagnosis, 1.4 advisory).
 *
 * Scope boundaries enforced by this contract:
 *  - Luck cycle / annual / monthly / daily pillars are DISPLAY ONLY. They carry no
 *    favourable / unfavourable judgement and are not consumed by the advisory layer.
 *  - The advisory layer is non-predictive. Scores express structural fit with the chart,
 *    never probability or likelihood of a real-world outcome.
 *  - Every advisory claim must be traceable to a ten-god / five-element basis via citations.
 *
 * Naming: closed sets use romanised keys for consistency with ElementKey. Chinese
 * display names are mapped in the frontend, not carried in the contract.
 */

import type { SourceReference } from "./api";

/* ------------------------------------------------------------------ */
/* Closed sets                                                          */
/* ------------------------------------------------------------------ */

export type ElementKey = "wood" | "fire" | "earth" | "metal" | "water";

/** Ten heavenly stems 天干: 甲乙丙丁戊己庚辛壬癸 */
export type HeavenlyStem =
  | "jia"   // 甲
  | "yi"    // 乙
  | "bing"  // 丙
  | "ding"  // 丁
  | "wu"    // 戊
  | "ji"    // 己
  | "geng"  // 庚
  | "xin"   // 辛
  | "ren"   // 壬
  | "gui";  // 癸

/** Twelve earthly branches 地支: 子丑寅卯辰巳午未申酉戌亥 */
export type EarthlyBranch =
  | "zi"    // 子
  | "chou"  // 丑
  | "yin"   // 寅
  | "mao"   // 卯
  | "chen"  // 辰
  | "si"    // 巳
  | "wu_branch" // 午 — suffixed to avoid collision with the 戊 stem
  | "wei"   // 未
  | "shen"  // 申
  | "you"   // 酉
  | "xu"    // 戌
  | "hai";  // 亥

/** Ten gods 十神, relative to the day master. */
export type TenGod =
  | "friend"            // 比肩
  | "rob_wealth"        // 劫财
  | "eating_god"        // 食神
  | "hurting_officer"   // 伤官
  | "indirect_wealth"   // 偏财
  | "direct_wealth"     // 正财
  | "seven_killings"    // 七杀
  | "direct_officer"    // 正官
  | "indirect_resource" // 偏印
  | "direct_resource";  // 正印

/** Five-level day-master strength. */
export type DayMasterStrength =
  | "very_strong"
  | "somewhat_strong"
  | "balanced"
  | "somewhat_weak"
  | "very_weak";

/**
 * Special structures handled by the override layer. Extend deliberately —
 * each addition needs a classical basis and test coverage.
 */
export type SpecialPattern =
  | "following_wealth"     // 从财格
  | "following_officer"    // 从官杀格
  | "dominant_element"     // 专旺格
  | "dual_qi_formation";   // 两气成象

/**
 * The twenty-four solar terms, in calendar order.
 *
 * Twelve of them are 节 (lichun, jingzhe, qingming, lixia, mangzhong, xiaoshu,
 * liqiu, bailu, hanlu, lidong, daxue, xiaohan) and open a month pillar; the
 * other twelve are 中气 and fall mid-month. The distinction matters because
 * some rules split a month at its 中气 — Qiong Tong Bao Jian, for instance,
 * treats a wood day master born before and after 秋分 differently.
 */
export type SolarTerm =
  | "lichun"      // 立春 · 节
  | "yushui"      // 雨水
  | "jingzhe"     // 惊蛰 · 节
  | "chunfen"     // 春分
  | "qingming"    // 清明 · 节
  | "guyu"        // 谷雨
  | "lixia"       // 立夏 · 节
  | "xiaoman"     // 小满
  | "mangzhong"   // 芒种 · 节
  | "xiazhi"      // 夏至
  | "xiaoshu"     // 小暑 · 节
  | "dashu"       // 大暑
  | "liqiu"       // 立秋 · 节
  | "chushu"      // 处暑
  | "bailu"       // 白露 · 节
  | "qiufen"      // 秋分
  | "hanlu"       // 寒露 · 节
  | "shuangjiang" // 霜降
  | "lidong"      // 立冬 · 节
  | "xiaoxue"     // 小雪
  | "daxue"       // 大雪 · 节
  | "dongzhi"     // 冬至
  | "xiaohan"     // 小寒 · 节
  | "dahan";      // 大寒

export type PillarLabel = "year" | "month" | "day" | "hour";

export type LocationSource = "dropdown" | "manual_coordinates";

/* ------------------------------------------------------------------ */
/* Request                                                              */
/* ------------------------------------------------------------------ */

export interface BirthPlace {
  /** ISO 3166-1 alpha-2, e.g. "SG". Present for dropdown selections. */
  country_code?: string;
  country?: string;
  city?: string;
  /** Required. Drives true-solar-time correction. */
  latitude: number;
  longitude: number;
  source: LocationSource;
}

export interface BaziChartRequest {
  /** ISO date, interpreted according to `calendar`. */
  birth_date: string;
  /** "HH:mm", local civil time at the birth place. */
  birth_time: string;
  birth_place: BirthPlace;
  gender: "female" | "male" | "unspecified";
  /**
   * Input calendar. Lunar input is converted to solar server-side before any
   * calculation; solar terms and the sexagenary day count are solar concepts.
   */
  calendar?: "solar" | "lunar";
  /** Leap month flag, only meaningful when calendar === "lunar". */
  is_leap_month?: boolean;
  /**
   * Optional IANA identifier. Normally omitted — the server resolves it from
   * the coordinates (timezonefinder) and applies historical rules (zoneinfo).
   */
  timezone?: string;
}

/* ------------------------------------------------------------------ */
/* 1.1 Chart calculation                                                */
/* ------------------------------------------------------------------ */

/** Hidden stem within an earthly branch, with its qi tier. */
export interface HiddenStem {
  stem: HeavenlyStem;
  element: ElementKey;
  /** primary / middle / residual qi — drives the weighting in 1.2. */
  qi: "primary" | "middle" | "residual";
  ten_god: TenGod;
}

export interface BaziPillar {
  label: PillarLabel;
  stem: HeavenlyStem;
  branch: EarthlyBranch;
  /** Element of the heavenly stem. */
  element: ElementKey;
  /**
   * Ten-god of the stem relative to the day master.
   * null on the day pillar — the day master has no ten-god relation to itself.
   */
  ten_god: TenGod | null;
  hidden_stems: HiddenStem[];
}

/**
 * Time-resolution audit trail. Not intended for user display; retained so that
 * an incorrect hour pillar can be traced back to the assumption that produced it.
 */
export interface ResolvedTime {
  /** Calendar actually used for calculation, after any lunar conversion. */
  solar_date: string;
  /** Civil time as entered. */
  civil_time: string;
  /** IANA zone resolved from coordinates. */
  timezone: string;
  /** UTC offset in minutes actually in force on that date (includes historical DST). */
  utc_offset_minutes: number;
  /** Whether a historical DST rule applied. */
  dst_applied: boolean;
  /** Longitude correction, in minutes. */
  longitude_correction_minutes: number;
  /** Equation-of-time correction, in minutes. */
  equation_of_time_minutes: number;
  /** Final true solar time used to derive the hour pillar, "HH:mm". */
  true_solar_time: string;
  /** True when true solar time pushed the chart across a pillar boundary. */
  crossed_pillar_boundary: boolean;
}

/**
 * Where the birth moment sits in the solar-term cycle.
 *
 * Consumed by 1.2: the climate branch of the useful-god derivation keys off the
 * term, and some of its rules turn on which side of a 中气 the birth falls.
 */
export interface SolarTermPosition {
  /** Most recent term passed, whether 节 or 中气. */
  current_term: SolarTerm;
  /** When that term began, ISO 8601 in the birth place's timezone. */
  current_term_at: string;
  /** Decimal days elapsed since it. */
  days_since_term: number;
  next_term: SolarTerm;
  next_term_at: string;
  days_to_next_term: number;
  /**
   * The 节 that opened this month pillar. Equals current_term when the birth
   * falls before the month's 中气.
   */
  month_term: SolarTerm;
  /**
   * True within a day of a term boundary, where a small error in the computed
   * birth moment could put the chart on the other side of the rule.
   */
  near_boundary: boolean;
}

/** Display-only. Carries no interpretation. */
export interface LuckCycle {
  start_age: number;
  end_age: number;
  start_year: number;
  end_year: number;
  stem: HeavenlyStem;
  branch: EarthlyBranch;
}

/** Display-only. Computed in the birth place's timezone. */
export interface CurrentPeriod {
  year: { year: number; stem: HeavenlyStem; branch: EarthlyBranch };
  month: { stem: HeavenlyStem; branch: EarthlyBranch };
  day: { stem: HeavenlyStem; branch: EarthlyBranch };
}

/* ------------------------------------------------------------------ */
/* 1.2 Pattern diagnosis                                                */
/* ------------------------------------------------------------------ */

/** One evidence factor feeding the day-master strength arbitration. */
export interface StrengthFactor {
  key: "seasonal_command" | "rootedness" | "revealed_support" | "assisting_support";
  /** Raw factor score before weighting. */
  score: number;
  /** Weight applied, from the tuned weight set. */
  weight: number;
  /** score * weight. */
  weighted_score: number;
  /** Which pillars / stems produced this score. */
  evidence: string[];
}

/**
 * Special structure detected by the override layer. Absent when the chart is
 * judged conventionally.
 */
export interface PatternOverride {
  pattern: SpecialPattern;
  triggered: boolean;
  /** Why the override fired, or why a candidate structure was ruled out. */
  rationale: string;
  /** Candidate structures considered and rejected, with reasons. */
  ruled_out: Array<{ pattern: SpecialPattern; reason: string }>;
}

/**
 * Full arbitration trace for the day-master judgement: the two-layer mechanism
 * made inspectable. This is the module's explainability deliverable.
 */
export interface ReasoningTrace {
  /** Layer 1 — weighted fusion of conflicting factors. */
  factors: StrengthFactor[];
  fused_score: number;
  /** Threshold band the fused score fell into. */
  threshold_band: string;
  /** Strength implied by layer 1 alone, before any override. */
  provisional_strength: DayMasterStrength;
  /** Layer 2 — special-structure override, if any. */
  override: PatternOverride | null;
  /** Final judgement after arbitration. */
  final_strength: DayMasterStrength;
  /**
   * True when the fused score sat near a boundary. Callers may choose to
   * present the result as inconclusive rather than assert a category.
   */
  near_threshold: boolean;
  /**
   * Classical rules the arbitration relied on. Uses the shared SourceReference
   * shape so a citation can point at an edition, chapter and page rather than
   * a bare label.
   */
  sources: SourceReference[];
}

export interface DayMaster {
  stem: HeavenlyStem;
  element: ElementKey;
  strength: DayMasterStrength;
}

/** Elements the chart benefits from / is burdened by. Drives 1.4 scoring. */
export interface ElementDisposition {
  /** Useful gods — elements that support the chart. */
  useful: ElementKey[];
  /** Unfavourable gods — elements that burden it. */
  unfavourable: ElementKey[];
  rationale: string;
}

export interface TenGodRelation {
  pillar: PillarLabel;
  /** "stem" for the visible stem, "hidden" for a hidden stem in the branch. */
  position: "stem" | "hidden";
  ten_god: TenGod;
  element: ElementKey;
  /** Whether this ten-god is currently useful or unfavourable. */
  disposition: "useful" | "unfavourable" | "neutral";
}

/* ------------------------------------------------------------------ */
/* 1.4 Advisory                                                         */
/* ------------------------------------------------------------------ */

export type AdvisoryDomain = "career" | "study" | "wealth";

/** Traceability record: which ten-god evidence produced a given claim. */
export interface Citation {
  ten_god: TenGod;
  /** Whether it contributed as a useful or unfavourable god. */
  disposition: "useful" | "unfavourable";
  /** Points contributed to this category's score. */
  points: number;
  /** Where in the chart the evidence sits. */
  evidence: string[];
}

export interface AdvisoryCategory {
  /** Candidate category key, e.g. "management", "creative_expression". */
  category: string;
  display_name: string;
  /** Rank within the domain, 1 = best structural fit. */
  rank: number;
  /**
   * Structural fit score. Expresses alignment with the chart's composition —
   * never a probability or a likelihood of real-world success.
   */
  fit_score: number;
  /** Strengths, derived from useful-god contributions. */
  strengths: string[];
  /**
   * Points to note, derived from unfavourable-god contributions. Positively
   * framed, but must remain traceable to the underlying signal — framing may
   * not remove or dilute what the scoring found.
   */
  considerations: string[];
  /** Every strength / consideration above traces back through these. */
  citations: Citation[];
}

export interface AdvisoryDomainResult {
  domain: AdvisoryDomain;
  /** Top-ranked categories, highest structural fit first. */
  categories: AdvisoryCategory[];
  /** Natural-language rendering of the above. Verbalisation only. */
  narrative: string;
}

/* ------------------------------------------------------------------ */
/* Result                                                               */
/* ------------------------------------------------------------------ */

export interface BaziChartResult {
  /* --- 1.1 --- */
  resolved_time: ResolvedTime;
  /** Consumed by 1.2's climate branch; see SolarTermPosition. */
  solar_term: SolarTermPosition;
  pillars: BaziPillar[];
  elements: Record<ElementKey, number>;
  /** Display only — no interpretation attached. */
  luck_cycles: LuckCycle[];
  /** Display only — no interpretation attached. */
  current_period: CurrentPeriod;

  /* --- 1.2 --- */
  day_master: DayMaster;
  ten_gods: TenGodRelation[];
  disposition: ElementDisposition;
  reasoning_trace: ReasoningTrace;

  /* --- 1.4 --- */
  advisory: AdvisoryDomainResult[];

  /** Plain-language summary of the chart's composition. */
  overview: string;

  /**
   * Every classical source cited anywhere in this result, de-duplicated.
   * The API route forwards this into ApiEnvelope.source_refs.
   */
  source_refs: SourceReference[];

  meta?: {
    mock?: boolean;
    engine_version?: string;
    /** Identifier of the weight set used, for reproducing a given result. */
    weight_set?: string;
    warnings?: string[];
  };
}

/**
 * Legacy shape retained only to ease migration of existing mock data and
 * frontend code. New code should target BaziChartResult.
 * @deprecated
 */
export interface LegacyBaziReferences {
  career: string;
  study: string;
  wealth: string;
}
