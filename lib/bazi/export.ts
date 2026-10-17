import type { BaziChartRequest, BaziChartResult, StrengthFactor } from "@/lib/contracts/bazi";
import {
  BRANCH_LABEL,
  ELEMENT_LABEL,
  LUCK_DIRECTION_LABEL,
  PILLAR_LABEL,
  QI_LABEL,
  SOLAR_TERM_LABEL,
  STEM_LABEL,
  TEN_GOD_GROUP_LABEL,
  TEN_GOD_LABEL,
} from "@/lib/bazi/display";
import { GENERATING_ORDER, STEM_POLARITY, type TenGodGroup, tenGodPositions } from "@/lib/bazi/structure";

/**
 * What a reader can take away: the calculation trace as data, and the chart as a document of facts. Both are built from the response
 * alone; nothing is computed again.
 */

/** The calculation trace with the input it answers. */
export function chainJson(chart: BaziChartResult, request: BaziChartRequest): string {
  return JSON.stringify(
    {
      request,
      steps: chart.calculation_trace,
    },
    null,
    2,
  );
}

export function exportName(chart: BaziChartResult, what: "chain" | "chart", extension: "json" | "md"): string {
  return `bazi-${what}-${chart.resolved_time.solar_date}.${extension}`;
}

const cell = (text: string) => text.replace(/\|/g, "／").replace(/\n/g, " ");
const table = (header: string[], rows: string[][]) =>
  [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)].join("\n");

const GROUP_ORDER: TenGodGroup[] = ["resource", "companion", "output", "wealth", "officer"];

/**
 * The four things the books look at for the help the day master gets, each in plain words with the facts of this chart and how far it
 * is met (0 to 1). The engine's own sentence for each carries its score and sometimes its arithmetic; those are cut so that what is left
 * is the fact. 克泄耗 is not listed: it is the opposite reading of the same elements the ten-god section already counts.
 */
const HELP: Record<string, string> = {
  seasonal_command: "得令：日主在出生月份的状态",
  rootedness: "得地：日主在地支里有没有根",
  revealed_support: "得势：天干里有没有生助日主的字",
  assisting_support: "得助：地支藏干里生助日主的字有多少",
};

function helpLine(factor: StrengthFactor): string | null {
  const label = HELP[factor.key];
  if (!label) return null;
  const facts = factor.calculation
    .replace(/，?\s*得 ?[\d.]+$/, "")
    .replace(/，?\s*[\d.]+ ÷ [\d.]+ = [\d.]+/, "")
    .replace(/（[^）]*权重[^）]*）/g, "");
  const tier = factor.scale && factor.level !== null ? `，属于「${factor.scale.labels[factor.level]}」（可能的情形：${factor.scale.labels.join("、")}）` : "";
  return `- **${label}**：${facts}${tier}。程度 ${factor.score}（0 到 1，越高越有帮助）`;
}

/**
 * The chart as a document of facts, for handing to another application to interpret: the birth input and its corrections, the four
 * pillars with their hidden stems and ten gods, the elements, the help the day master gets in four respects, and the luck and annual
 * pillars. It states what was computed and judges nothing: no strength verdict, no useful or unfavourable elements, no weights, no
 * reading of the ten gods by domain, and no account of how the engine reasoned. `exportedAt` is given by the caller so that the same
 * chart gives the same text.
 */
export function chartMarkdown(chart: BaziChartResult, request: BaziChartRequest, exportedAt: string): string {
  const time = chart.resolved_time;
  const term = chart.solar_term;
  const place = request.birth_place;
  const dayMaster = chart.pillars.find((p) => p.label === "day")!;
  const gz = (p: { stem: keyof typeof STEM_LABEL; branch: keyof typeof BRANCH_LABEL }) => `${STEM_LABEL[p.stem]}${BRANCH_LABEL[p.branch]}`;
  const out: string[] = [];

  out.push("# 八字命盘信息", "");
  out.push("> 以下是用规则引擎按传统方法推算出的命盘事实，只列事实，不含任何判断或解读，可整段提供给其他应用去解读。");
  out.push("> 十神都相对日主而言；藏干按本气、中气、余气排列；八字按年、月、日、时的次序。", "");
  out.push(`导出时间：${exportedAt}`, "");

  out.push("## 基本信息", "");
  out.push(`- 性别：${request.gender === "male" ? "男" : "女"}`);
  out.push(`- 出生日期：${request.calendar === "lunar" ? `农历 ${request.birth_date}${request.is_leap_month ? "（闰月）" : ""}，对应公历 ${time.solar_date}` : `公历 ${time.solar_date}`}`);
  out.push(`- 出生时间（出生地当地时间）：${request.birth_time}`);
  out.push(`- 出生地点：${place.city ?? "手动填写"}，纬度 ${place.latitude}°，经度 ${place.longitude}°`);
  out.push(`- 时区：${time.timezone}，当时偏移 ${time.utc_offset_minutes} 分钟${time.dst_applied ? "（当时实行夏令时，已扣除）" : ""}`);
  out.push(`- 真太阳时：${time.true_solar_time}（经度修正 ${time.longitude_correction_minutes} 分，均时差 ${time.equation_of_time_minutes} 分${time.crossed_pillar_boundary ? "；校正使日柱或时柱与按民用时间所定的不同" : ""}）`);
  out.push(`- 节气：「${SOLAR_TERM_LABEL[term.current_term]}」之后 ${term.days_since_term} 天，「${SOLAR_TERM_LABEL[term.next_term]}」之前 ${term.days_to_next_term} 天；月令取「${SOLAR_TERM_LABEL[term.month_term]}」${term.near_boundary ? "（接近交节，结果对出生时刻较敏感）" : ""}`, "");

  out.push("## 八字", "");
  out.push(`八字：${chart.pillars.map(gz).join(" ")}（年柱 月柱 日柱 时柱）`);
  out.push(`日主：${STEM_LABEL[dayMaster.stem]}（${STEM_POLARITY[dayMaster.stem] === "yang" ? "阳" : "阴"}${ELEMENT_LABEL[dayMaster.element]}）`, "");
  out.push(
    table(
      ["", ...chart.pillars.map((p) => PILLAR_LABEL[p.label])],
      [
        ["天干", ...chart.pillars.map((p) => `${STEM_LABEL[p.stem]}（${STEM_POLARITY[p.stem] === "yang" ? "阳" : "阴"}${ELEMENT_LABEL[p.element]}）`)],
        ["天干十神", ...chart.pillars.map((p) => (p.ten_god ? TEN_GOD_LABEL[p.ten_god] : "日主"))],
        ["地支", ...chart.pillars.map((p) => BRANCH_LABEL[p.branch])],
        ["藏干（十神）", ...chart.pillars.map((p) => p.hidden_stems.map((h) => `${STEM_LABEL[h.stem]}${ELEMENT_LABEL[h.element]}·${QI_LABEL[h.qi]}（${TEN_GOD_LABEL[h.ten_god]}）`).join("；"))],
      ],
    ),
    "",
  );

  out.push("## 五行与十神", "");
  const total = Object.values(chart.elements).reduce((sum, value) => sum + value, 0) || 1;
  out.push(`- 五行（四个天干、四个地支本气，共 ${total} 个字各记一次）：${GENERATING_ORDER.map((e) => `${ELEMENT_LABEL[e]} ${chart.elements[e] ?? 0}`).join("，")}`);
  const positions = tenGodPositions(chart.pillars);
  for (const group of GROUP_ORDER) {
    out.push(`- ${TEN_GOD_GROUP_LABEL[group]}：${positions[group].length} 处${positions[group].length ? `（${positions[group].join("；")}）` : ""}`);
  }
  out.push("");

  out.push("## 日主得到的帮助", "");
  out.push("传统上从四个方面看日主得到多少帮助（得令、得地、得势、得助）。下面是这张盘在每一方面的情况，和一个 0 到 1 的程度。", "");
  out.push(...chart.reasoning_trace.factors.map(helpLine).filter((line): line is string => line !== null), "");

  out.push("## 大运与流年", "");
  out.push(`- 起运：${chart.luck_onset.years} 岁 ${chart.luck_onset.months} 个月，${LUCK_DIRECTION_LABEL[chart.luck_onset.direction]}。${chart.luck_onset.rationale}`);
  const now = chart.current_period;
  out.push(`- 命盘计算当日所在：${now.year.year} 年 ${gz(now.year)}，月 ${gz(now.month)}，日 ${gz(now.day)}`, "");
  out.push(
    table(
      ["年龄", "年份", "大运干支", "天干十神", "地支（本气）十神"],
      chart.luck_cycles.map((c) => [`${c.start_age}–${c.end_age} 岁`, `${c.start_year}–${c.end_year}`, gz(c), TEN_GOD_LABEL[c.stem_ten_god], TEN_GOD_LABEL[c.branch_ten_god]]),
    ),
    "",
  );
  for (const cycle of chart.luck_cycles) {
    const years = chart.annual_cycles.filter((a) => a.year >= cycle.start_year && a.year <= cycle.end_year);
    out.push(`### ${cycle.start_year}–${cycle.end_year} 大运 ${gz(cycle)} 的流年`, "");
    out.push(years.map((a) => `${a.year} ${gz(a)}（${TEN_GOD_LABEL[a.stem_ten_god]}／${TEN_GOD_LABEL[a.branch_ten_god]}）`).join("；"), "");
  }
  return out.join("\n");
}
