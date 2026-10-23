import type { Translate } from "@/lib/i18n";

/**
 * The engine writes its explanations in Chinese. A few of them are put together from a handful of fixed sentence patterns around
 * names that the English interface already knows (elements, ten-god groups, stems); those are put into English here, pattern by
 * pattern. Anything that does not match a pattern is returned as the engine wrote it, so a new sentence in the engine shows up in
 * Chinese rather than wrongly translated.
 */

const ELEMENT: Record<string, string> = { 木: "Wood", 火: "Fire", 土: "Earth", 金: "Metal", 水: "Water" };
const GROUP: Record<string, string> = { 比劫: "Peers", 食伤: "Output", 财: "Wealth", 官杀: "Authority", 印: "Resource" };
const DOMAIN: Record<string, string> = { 职业方向: "career", 学业方向: "study", 财运: "wealth" };
const TEN_GOD: Record<string, string> = {
  比肩: "Friend", 劫财: "Rob Wealth", 食神: "Eating God", 伤官: "Hurting Officer", 偏财: "Indirect Wealth",
  正财: "Direct Wealth", 七杀: "Seven Killings", 正官: "Direct Officer", 偏印: "Indirect Resource", 正印: "Direct Resource",
};
const PILLAR: Record<string, string> = { 年: "Year", 月: "Month", 日: "Day", 时: "Hour" };
const QI: Record<string, string> = { 本气: "primary", 中气: "middle", 余气: "residual" };
const POLARITY: Record<string, string> = { 阳: "yang", 阴: "yin" };

function elements(list: string): string {
  return list.split("、").map((item) => ELEMENT[item] ?? item).join(", ");
}

function groups(list: string): string {
  return list.split("、").map((item) => GROUP[item] ?? item).join(", ");
}

/** "庚金" → "庚 metal" */
function stemElement(text: string): string {
  const match = /^(.)([木火土金水])$/.exec(text);
  return match ? `${match[1]} ${ELEMENT[match[2]].toLowerCase()}` : text;
}

const FUYI = /^日主偏(弱|强)，取(扶|抑)：用([^（]+)（([^）]+)），忌([^（]+)（([^）]+)）$/;
const TIAOHOU = /^(.)日主生(.)月(（中气后）)?：《穷通宝鉴》先用([^，；]+)((?:，次用[^，；]+)*)；即(.+)$/;

function fuyi(text: string): string | null {
  const match = FUYI.exec(text);
  if (!match) return null;
  const [, side, mode, use, useEl, avoid, avoidEl] = match;
  return `Day master ${side === "弱" ? "somewhat weak" : "somewhat strong"}, so ${mode === "扶" ? "support it" : "suppress it"}: use ${groups(use)} (${elements(useEl)}); avoid ${groups(avoid)} (${elements(avoidEl)})`;
}

function tiaohou(text: string): string | null {
  const match = TIAOHOU.exec(text);
  if (!match) return null;
  const [, stem, branch, late, first, rest, kinds] = match;
  const order = [first, ...rest.split("，次用").filter(Boolean)].map(stemElement);
  return `${stem} day master born in the ${branch} month${late ? " (after the mid-term qi)" : ""}: the 《穷通宝鉴》 first uses ${order[0]}${order.slice(1).map((item) => `, then ${item}`).join("")}; that is, ${groups(kinds)}`;
}

/** The wording the character-by-character notes on the pillars step and the ten-god positions are built from. */
function notes(text: string): string | null {
  let match = /^(年|月|日|时)(干|支)(?:（(日主|月令)）)?$/.exec(text);
  if (match) return `${PILLAR[match[1]]} ${match[2] === "干" ? "stem" : "branch"}${match[3] ? ` (${match[3] === "日主" ? "day master" : "month branch"})` : ""}`;
  match = /^相对日主：(.+)$/.exec(text);
  if (match && TEN_GOD[match[1]]) return `Relative to the day master: ${TEN_GOD[match[1]]} (${match[1]})`;
  match = /^(.)\s·\s([阳阴])([木火土金水])$/.exec(text);
  if (match) return `${match[1]} · ${POLARITY[match[2]][0].toUpperCase()}${POLARITY[match[2]].slice(1)} ${ELEMENT[match[3]].toLowerCase()}`;
  match = /^(.)\s·\s([木火土金水])$/.exec(text);
  if (match) return `${match[1]} · ${ELEMENT[match[2]].toLowerCase()}`;
  match = /^(.+)。(.)([木火土金水])为([阳阴])、日主(.)([木火土金水])为([阳阴])，阴阳(相同|相异)，故为(.+)。$/.exec(text);
  if (match) {
    const [, , stem, el, pol, dm, dmEl, dmPol, same, god] = match;
    return `${stem} ${ELEMENT[el].toLowerCase()} is ${POLARITY[pol]} and the day master ${dm} ${ELEMENT[dmEl].toLowerCase()} is ${POLARITY[dmPol]}; the polarity is ${same === "相同" ? "the same" : "opposite"}, so it is ${TEN_GOD[god] ?? god} (${god}).`;
  }
  match = /^(.)中藏(.+)。$/.exec(text);
  if (match) {
    const hidden = match[2].split("、").map((item) => {
      const m = /^(.)([木火土金水])（(本气|中气|余气)）$/.exec(item);
      return m ? `${m[1]} ${ELEMENT[m[2]].toLowerCase()} (${QI[m[3]]} qi)` : item;
    });
    return `${match[1]} hides ${hidden.join(", ")}.`;
  }
  match = /^(年|月|日|时)(干|支) (.)(?: · 藏(.)(?:（(中气|余气)）)?)? · (.+)$/.exec(text);
  if (match) {
    const [, pillar, kind, char, hidden, qi, god] = match;
    return `${PILLAR[pillar]} ${kind === "干" ? "stem" : "branch"} ${char}${hidden ? ` · hides ${hidden}${qi ? ` (${QI[qi]} qi)` : ""}` : ""} · ${TEN_GOD[god] ?? god}`;
  }
  match = /^(阴|阳)年(男|女)命，大运(顺|逆)排；出生距(上|下)一节（(.+?)）(\d+(?:\.\d+)?) 天，按三日折一年计，起运 (\d+) 岁(?: (\d+) 个月)?。$/.exec(text);
  if (match) {
    const [, yy, sex, dir, which, term, days, years, months] = match;
    return `${POLARITY[yy][0].toUpperCase()}${POLARITY[yy].slice(1)} year, ${sex === "男" ? "male" : "female"}: the luck cycles run ${dir === "顺" ? "forward" : "in reverse"}. The birth is ${days} days from the ${which === "上" ? "previous" : "next"} term (${term}); at one year per three days the luck starts at age ${years}${months ? ` and ${months} months` : ""}.`;
  }
  return null;
}

/** The sentence patterns of the engine's useful-god reasoning and of the tendency page. */
function patterns(text: string, t: Translate): string | null {
  const direct = fuyi(text) ?? tiaohou(text) ?? notes(text);
  if (direct) return direct;

  let match = /^调候用神（([^）]+)）都在扶抑用神之内，两法一致：(.+)$/.exec(text);
  if (match) {
    const rest = fuyi(match[2]);
    if (rest) return `Every climatic useful god (${elements(match[1])}) is among the support-suppress ones, so the two methods agree. ${rest}`;
  }
  match = /^扶抑与调候相悖，不属([木火土金水]{2})冬、([木火土金水]{2})夏，采扶抑：(.+)$/.exec(text);
  if (match) {
    const rest = fuyi(match[3]);
    if (rest) return `The two methods conflict, and this is not a ${[...match[1]].map((e) => ELEMENT[e].toLowerCase()).join("-")} chart in winter or a ${[...match[2]].map((e) => ELEMENT[e].toLowerCase()).join("-")} chart in summer, so support-suppress is adopted. ${rest}`;
  }
  match = /^扶抑与调候相悖，日主([木火土金水])生于(冬|夏)月，调候优先：(.+)$/.exec(text);
  if (match) {
    const rest = tiaohou(match[3]);
    if (rest) return `The two methods conflict. The day master (${ELEMENT[match[1]].toLowerCase()}) is born in ${match[2] === "冬" ? "winter" : "summer"}, so the climatic method comes first. ${rest}`;
  }
  match = /^在(职业方向|学业方向|财运)里，(比劫|食伤|财|官杀|印)对应「([^」]+)」，([^。]+)。(?:本命局中(?:未见([^。]+)|([^。]+?)出现 (\d+) 处))。$/.exec(text);
  if (match) {
    const [, domain, group, category, gloss, absent, , count] = match;
    return `In ${DOMAIN[domain]}, ${GROUP[group]} stands for "${t(category)}" (${t(gloss).replace(/^Stands for /, "")}). ${absent ? `This chart holds no ${GROUP[group]}.` : `This chart holds ${GROUP[group]} in ${count} place${count === "1" ? "" : "s"}.`}`;
  }
  match = /^典籍把(.+?)与(职业方向|学业方向|财运)联系在一起。(学业方向的对应是现代适配，不是典籍原文直接对应。)?$/.exec(text);
  if (match) {
    return `The classics link ${groups(match[1])} with ${DOMAIN[match[2]]}.${match[3] ? " The link to study is a modern adaptation, not something the original text says directly." : ""}`;
  }
  match = /^特殊格局(?:成立，改按格局自己的取法|优先：特殊格局成立，改按格局自己的取法)（(.+)）$/.exec(text);
  if (match) {
    const inner = match[1].split("；").map((part) => t(part)).join("; ");
    return `The special structure holds, so the chart is read by the structure's own method (${inner})`;
  }
  match = /^成(专旺格|两气成象)：(.+)$/.exec(text);
  if (match) {
    const inner = patterns(match[2], t) ?? match[2];
    return `${match[1] === "专旺格" ? "Dominant-element structure" : "Dual-qi formation"}: ${inner}`;
  }
  match = /^([木火土金水])占 (\d+\/\d+)，不低于 5\/8，且四支(.+?)(三合局|三会方)（(\w+)），成专旺格$/.exec(text);
  if (match) return `${ELEMENT[match[1]]} holds ${match[2]}, not below 5/8, and the four branches ${match[3]} form a ${match[4] === "三合局" ? "three-harmony combination" : "directional combination"} (${match[5]}), making a dominant-element structure`;
  match = /^(.+)占 (\d+\/\d+)、(.+)占 (\d+\/\d+)，其余五行缺，成两气成象$/.exec(text);
  if (match) return `${ELEMENT[match[1]] ?? match[1]} holds ${match[2]} and ${ELEMENT[match[3]] ?? match[3]} holds ${match[4]}; the other elements are absent, forming the dual-qi structure`;
  return null;
}

/** The text in English when the interface is English and the sentence is one the engine builds from a known pattern or one we have translated. */
export function engineText(text: string, locale: "zh" | "en", t: Translate): string {
  if (locale !== "en" || !text) return text;
  const exact = t(text);
  if (exact !== text) return exact;
  return patterns(text, t) ?? text;
}

/** The nine tendency categories the rule base names, in English, for texts that are built without the dictionary. */
export const CATEGORY_EN: Record<string, string> = {
  "管理 / 组织": "management and organising",
  "经营 / 资源调配": "running things and allocating resources",
  "表达 / 才艺": "expression and talent",
  "自主 / 竞争": "independence and competition",
  "学问 / 受教": "learning and being taught",
  "才艺 / 创作": "talent and creative work",
  财之本体: "wealth itself",
  以才艺生财: "earning through talent",
  协作与分担: "cooperation and sharing",
};

/** A translated label without the Chinese in brackets, for places too narrow to carry both: "Rob Wealth (劫财)" becomes "Rob Wealth". */
export function short(label: string): string {
  return label.replace(/\s*\([^)]*[\u4e00-\u9fff][^)]*\)\s*$/, "");
}
