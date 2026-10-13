import type { ArbitrationOutcome, BaziChartResult } from "@/lib/contracts/bazi";
import {
  BRANCH_LABEL,
  DOMAIN_LABEL,
  ELEMENT_LABEL,
  PILLAR_LABEL,
  STEM_LABEL,
  TEN_GOD_GROUP_LABEL,
} from "@/lib/bazi/display";

/**
 * Who the chart on screen belongs to.
 *
 * Every collection made from the bazi pages carries this, so the personal
 * knowledge base can keep two people's charts apart instead of merging them
 * into one anonymous pile.
 */
export interface BaziProfileActivity {
  profileId?: string;
  personName?: string;
  personRelation: string;
}

/** The person's display name, or a placeholder when none was given. */
export function displayName(activity: BaziProfileActivity): string {
  return activity.personName?.trim() || "未命名人物";
}

/**
 * The person a record is filed under, as a short key for source ids.
 *
 * Truncated: the collections API caps source_id at 255 characters, and a name
 * is free text.
 */
export function personKey(activity: BaziProfileActivity): string {
  return (activity.profileId || activity.personName?.trim() || "unassigned").slice(0, 60);
}

/**
 * A stable id for the chart on screen.
 *
 * Built from the four pillars, so re-collecting the same chart replaces the
 * earlier record instead of stacking duplicates. The person key is part of it
 * because two people born at the same moment have the same four pillars and
 * must still be filed apart.
 */
export function chartSourceId(
  chart: { pillars: ReadonlyArray<{ stem: string; branch: string }> },
  scope?: string,
): string {
  const pillars = chart.pillars.map((pillar) => `${pillar.stem}${pillar.branch}`).join("-");
  return scope ? `bazi-chart:${scope}:${pillars}` : `bazi-chart:${pillars}`;
}

/** Where a piece of evidence sits in the chart, written the way the page writes it. */
function positionOf(ref: BaziChartResult["reasoning_trace"]["factors"][number]["evidence"][number]): string {
  const pillar = PILLAR_LABEL[ref.pillar];
  if (ref.position === "hidden") return `${pillar}藏干${ref.stem ? STEM_LABEL[ref.stem] : ""}`;
  if (ref.position === "stem") return `${pillar}干${ref.stem ? STEM_LABEL[ref.stem] : ""}`;
  return `${pillar}支${BRANCH_LABEL[ref.branch]}`;
}

/**
 * One line per place the day-master strength arbitration read from.
 *
 * This is the evidence the 五行十神 step shows on screen, in the same shape:
 * where in the chart, and why that character matters.
 */
export function factorEvidence(chart: BaziChartResult): string[] {
  return chart.reasoning_trace.factors.flatMap((factor) =>
    factor.evidence.map((ref) => `${positionOf(ref)}：${ref.description}`),
  );
}

/** The rules and books the strength arbitration cited. */
export function arbitrationEvidence(chart: BaziChartResult): string[] {
  const trace = chart.reasoning_trace;
  return [
    ...trace.factors
      .filter((factor) => factor.rule_id)
      .map((factor) =>
        `${factor.rule_id}　${factor.rule_text}${factor.quotation ? `　「${factor.quotation}」` : ""}`,
      ),
    ...trace.sources.map((source) => [source.title, source.edition, source.chapter].filter(Boolean).join(" · ")),
  ];
}

/**
 * One line per ten-god group the 倾向对照 step lists, with the passage behind it.
 *
 * Groups the chart does not hold are left out: absence is informative on the
 * page, but as evidence for a question about this person it is noise.
 */
export function tallyEvidence(chart: BaziChartResult): string[] {
  return chart.domain_tallies.flatMap((tally) =>
    tally.groups
      .filter((group) => group.count > 0)
      .map((group) => {
        const where = group.occurrences
          .map((occurrence) =>
            `${PILLAR_LABEL[occurrence.pillar]}${occurrence.position === "hidden" ? "藏干" : ""}${STEM_LABEL[occurrence.stem]}`,
          )
          .join("、");
        const passage = group.quotation ? `「${group.quotation}」` : "典籍未见相应的性情描述";
        return `${DOMAIN_LABEL[tally.domain]} · ${group.category}（${TEN_GOD_GROUP_LABEL[group.group]} ${group.count} 处：${where}）：${passage}`;
      }),
  );
}

/** Every book cited anywhere in the chart, one line each, in the page's own order. */
export function sourceEvidence(chart: BaziChartResult): string[] {
  return chart.source_refs.map((ref) => [ref.title, ref.edition, ref.chapter].filter(Boolean).join(" · "));
}

/**
 * The four pillars as one string, e.g. 甲子 乙丑 丙寅 丁卯.
 *
 * The contract carries romanised keys (`jia`, `zi`); the label maps turn them
 * back into the characters a reader expects to see.
 */
export function pillarText(chart: BaziChartResult): string {
  return chart.pillars.map((pillar) => `${STEM_LABEL[pillar.stem]}${BRANCH_LABEL[pillar.branch]}`).join(" ");
}

/** The day master and its element, e.g. 丙火. */
export function dayMasterText(chart: BaziChartResult): string {
  return `${STEM_LABEL[chart.day_master.stem]}${ELEMENT_LABEL[chart.day_master.element]}`;
}

const ARBITRATION_LABEL: Record<ArbitrationOutcome, string> = {
  agree: "两法结论一致",
  supporting: "采纳扶抑",
  climatic: "采纳调候",
  both: "扶抑与调候兼用",
  other: "按裁决说明取用",
};

/** How the useful god was settled on, e.g. 采纳扶抑（扶抑取水、木；调候取火）. */
export function yongshenText(chart: BaziChartResult): string {
  const methods = chart.derivation.methods
    .map(
      (method) =>
        `${method.method === "supporting" ? "扶抑" : "调候"}取${method.useful
          .map((element) => ELEMENT_LABEL[element])
          .join("、")}`,
    )
    .join("；");
  return `${ARBITRATION_LABEL[chart.derivation.arbitration.outcome]}（${methods}）`;
}
