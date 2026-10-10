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

/** 旺相休囚死: how an element stands in the season set by the birth month. */
export type SeasonalState =
  | "peak"        // 旺
  | "supporting"  // 相
  | "resting"     // 休
  | "confined"    // 囚
  | "dead";       // 死

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
  gender: "female" | "male";
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
 *
 * TIME SCALE — do not "improve" this by feeding it the corrected time. A solar
 * term is one astronomical instant worldwide (the sun reaching a given ecliptic
 * longitude), so every field here compares the birth moment against the term in
 * CIVIL time, uncorrected. True solar time shifts the hour pillar, never the
 * month: applying the correction to both sides would shift them equally and
 * cancel, and applying it to only the birth moment is simply wrong — a tool
 * observed in our market survey did exactly that and pushed a birth 20 minutes
 * before 立冬 into the following month pillar.
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

/** Which way the luck cycles run from the month pillar. */
export type LuckDirection = "forward" | "reverse";

/**
 * When the luck cycles begin, and which way they run.
 *
 * Display-only like the cycles themselves, but it is the part of 1.1 with real
 * calculation in it: the onset is the distance from the birth moment to the
 * neighbouring solar term converted at three days to the year, and the
 * direction follows the year stem's polarity together with the gender.
 */
export interface LuckOnset {
  years: number;
  months: number;
  direction: LuckDirection;
  /** Plain-language account of how the two were derived. */
  rationale: string;
}

/**
 * Display-only. Carries no interpretation.
 *
 * Elements and ten gods travel with the cycle rather than being worked out in
 * the browser: they are the same structural relations the engine already
 * computes for the natal pillars, and the frontend does no inference of its own.
 */
export interface LuckCycle {
  start_age: number;
  end_age: number;
  start_year: number;
  end_year: number;
  stem: HeavenlyStem;
  branch: EarthlyBranch;
  stem_element: ElementKey;
  branch_element: ElementKey;
  stem_ten_god: TenGod;
  /** Ten god of the branch's primary hidden stem. */
  branch_ten_god: TenGod;
}

export interface PeriodPillar {
  stem: HeavenlyStem;
  branch: EarthlyBranch;
  stem_element: ElementKey;
  branch_element: ElementKey;
}

/** A pillar on one of the timelines, with the ten gods the engine derived. */
export interface TimelinePillar extends PeriodPillar {
  stem_ten_god: TenGod;
  branch_ten_god: TenGod;
}

export interface AnnualPillar extends TimelinePillar {
  year: number;
}

/** Display-only. Computed in the birth place's timezone. */
export interface CurrentPeriod {
  year: PeriodPillar & { year: number };
  month: PeriodPillar;
  day: PeriodPillar;
}

/* ------------------------------------------------------------------ */
/* 1.2 Pattern diagnosis                                                */
/* ------------------------------------------------------------------ */

/** Where in the chart a piece of evidence sits. */
export type EvidencePosition =
  | "stem"    // a heavenly stem of a pillar
  | "hidden"  // a stem hidden in a pillar's branch
  | "branch"; // the earthly branch itself (e.g. 月令)

/**
 * A pointer to a place in the natal chart. The reader (and the UI) can go to
 * the character itself instead of parsing a sentence.
 *
 * pillar + position + branch always locate the spot. `stem` is set for a stem
 * or a hidden stem; `qi` only for a hidden stem. `description` is the one-line
 * account of why the character matters — the only free text. Every reference
 * must name a character the chart really has; the Python model rejects a result
 * that does not.
 */
export interface EvidenceRef {
  pillar: PillarLabel;
  position: EvidencePosition;
  /** The pillar's own branch; for a hidden stem, the branch that hides it. */
  branch: EarthlyBranch;
  stem: HeavenlyStem | null;
  qi: HiddenStem["qi"] | null;
  description: string;
}

/** The tiers a factor is scored on, best first, and the rule that fixed their values. */
export interface FactorScale {
  labels: string[];
  scores: number[];
  rule_id: string;
  /** True: the spacing between tiers is this project's choice, not the text's. */
  derived: boolean;
}

/** One evidence factor feeding the day-master strength arbitration. */
export interface StrengthFactor {
  key: "seasonal_command" | "rootedness" | "revealed_support" | "assisting_support";
  /**
   * Identifier of the rule that produced this score, e.g. "R-DELING-05".
   * What makes the trace auditable: a reader can look the rule up rather than
   * take the number on trust.
   */
  rule_id?: string;
  /** source_id of the entry in source_refs this rule was read from. */
  source_id?: string;
  /** Raw factor score before weighting. */
  score: number;
  /** Weight applied, from the tuned weight set. */
  weight: number;
  /** score * weight. */
  weighted_score: number;
  /** Which pillars / stems produced this score. */
  /** Places in the chart this score was computed from; empty when none applies. */
  evidence: EvidenceRef[];
  /** The tier ladder; null for a continuous factor (得助 is a ratio). */
  scale: FactorScale | null;
  /** Index into scale.labels where this chart sits (0 = best); null when continuous. */
  level: number | null;
  /** One-line account of how the score was reached. */
  calculation: string;
  /** Where the rule that produced the score is cited, and whether it is the
   *  project's own formalisation rather than something the text states. */
  chapter: string | null;
  quotation: string | null;
  /** The knowledge-base page the quotation comes from (its unique key; a URL for web sources). */
  kb_url: string | null;
  derived: boolean;
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

/** The two derivation methods this module runs in parallel. */
export type DerivationMethod =
  | "supporting"  // 扶抑：按日主强弱取生扶或克泄之神
  | "climatic";   // 调候：按出生季节的寒暖燥湿取用

export type ArbitrationOutcome =
  | "agree"       // 两法结论一致，无需裁决
  | "supporting"  // 采纳扶抑
  | "climatic"    // 采纳调候
  | "both"        // 两者兼用：一为主用神，另一为不可缺少之辅
  | "other";      // 其余情形，须在 rationale 中说明

/** What one method concluded, and what it keyed off. */
export interface MethodConclusion {
  method: DerivationMethod;
  /** The input this method used, e.g. "日主偏旺" or "正月甲木，木嫩气寒". */
  basis: string;
  rule_id?: string;
  source_id?: string;
  useful: ElementKey[];
  /** Only the supporting method yields unfavourable elements. */
  unfavourable?: ElementKey[];
}

/**
 * How the two conclusions were reconciled.
 *
 * The climatic chain does not depend on the strength judgement, so the two run
 * in parallel and meet here; this record is what makes the choice auditable
 * rather than silent, which is precisely what existing tools leave out.
 */
export interface Arbitration {
  conflict: boolean;
  outcome: ArbitrationOutcome;
  /** The priority rule that decided it; absent when the two agree. */
  rule_id?: string;
  source_id?: string;
  rationale: string;
}

export interface UsefulGodDerivation {
  methods: MethodConclusion[];
  arbitration: Arbitration;
}

export interface TenGodRelation {
  pillar: PillarLabel;
  /** "stem" for the visible stem, "hidden" for a hidden stem in the branch. */
  position: "stem" | "hidden";
  ten_god: TenGod;
  element: ElementKey;
  /** Whether this ten-god is currently useful or unfavourable. */
  disposition: Disposition;
}

/* ------------------------------------------------------------------ */
/* 1.4 Domain tallies                                                   */
/* ------------------------------------------------------------------ */

/** Whether an element or ten god supports or burdens the chart, per 1.2. */
export type Disposition = "useful" | "unfavourable" | "neutral";

/** The five groups the ten gods fall into, relative to the day master. */
export type TenGodGroup =
  | "companion"  // 比劫：同我者
  | "output"     // 食伤：我生者
  | "wealth"     // 财：我克者
  | "officer"    // 官杀：克我者
  | "resource";  // 印：生我者

/** Where a ten god actually sits in the chart. */
export interface TenGodOccurrence {
  pillar: PillarLabel;
  position: "stem" | "hidden";
  /** The character itself, e.g. the stem 癸. */
  stem: HeavenlyStem;
  element: ElementKey;
  ten_god: TenGod;
  /** Useful or unfavourable, as judged in 1.2 — not a fresh judgement. */
  disposition: Disposition;
}

export type AdvisoryDomain = "career" | "study" | "wealth";

/**
 * One ten-god group as it relates to one domain.
 *
 * Nothing here is weighted or ranked. Earlier drafts scored the groups (core
 * +3, secondary +2) and ordered the domains by the total, but the texts supply
 * no such hierarchy and the scores were not comparable across domains — a 2 in
 * 职业 and a 2 in 学业 measured different things while sharing one label. What
 * is left is what can be checked: how many of the group appear, whether 1.2
 * judged them useful or unfavourable, what the texts say the group concerns,
 * and where each one sits in the chart.
 */
export interface DomainGroupTally {
  group: TenGodGroup;
  /**
   * Thedomain-facing name of what this group is associated with, e.g. 管理 / 组织.
   * A label for the association the texts state, not a new claim: the evidence
   * for it is the gloss and quotation below.
   */
  category: string;
  /** Occurrences in this chart, counting stems and hidden stems. */
  count: number;
  /** From 1.2; neutral when the group is absent or its occurrences differ. */
  disposition: Disposition;
  /** What the texts say this group concerns, in their own vocabulary. */
  gloss: string;
  /** The passage the gloss rests on; absent when the texts carry none. */
  quotation?: string;
  source_id?: string;
  chapter?: string;
  occurrences: TenGodOccurrence[];
  /**
   * Plain-language restatement of this row: the count, the disposition, the
   * gloss and where they sit. Classical quotations alone are hard to read, so
   * the row is also said in modern Chinese — a restatement, never an addition.
   */
  narrative: string;
}

export interface DomainTally {
  domain: AdvisoryDomain;
  /**
   * The groups the texts associate with this domain, in fixed order and
   * including those with a count of zero — absence is as informative as
   * presence, and a variable order would read as a ranking.
   */
  groups: DomainGroupTally[];
  /** Constrained verbalisation of the rows above; no new claims, no ordering. */
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
  /** 1.2: each element's 旺相休囚死 in the birth month's season. */
  element_states: Record<ElementKey, SeasonalState>;
  /** Display only — no interpretation attached. */
  luck_onset: LuckOnset;
  /**
   * Annual pillars covering the span of luck_cycles, so the year row can follow
   * whichever cycle the reader selects. Months and days are deliberately absent:
   * expanding them across eighty years runs to tens of thousands of rows, and
   * the page does not show them.
   */
  annual_cycles: AnnualPillar[];
  /** Display only — no interpretation attached. */
  luck_cycles: LuckCycle[];
  /** Display only — no interpretation attached. */
  current_period: CurrentPeriod;

  /* --- 1.2 --- */
  day_master: DayMaster;
  ten_gods: TenGodRelation[];
  disposition: ElementDisposition;
  /** The two parallel derivations and their reconciliation. */
  derivation: UsefulGodDerivation;
  reasoning_trace: ReasoningTrace;

  /* --- 1.4 --- */
  /** One tally per domain; counts and citations only, no score and no ranking. */
  domain_tallies: DomainTally[];

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
    /** Version of the rule base used; with weight_set, enough to reproduce a result. */
    rule_base?: string;
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
