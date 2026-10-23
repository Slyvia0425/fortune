import type { BaziChartResult, DayMasterStrength, ElementKey } from "@/lib/contracts/bazi";
import {
  BRANCH_LABEL,
  DOMAIN_LABEL,
  ELEMENT_LABEL,
  PATTERN_LABEL,
  PILLAR_LABEL,
  STEM_LABEL,
  STRENGTH_LABEL,
  TEN_GOD_GROUP_LABEL,
  TEN_GOD_LABEL,
} from "@/lib/bazi/display";
import { GROUP_INFO, STEM_POLARITY, tenGodPositions, type TenGodGroup } from "@/lib/bazi/structure";

/**
 * 现代解读: a three-paragraph reading of a chart in everyday words, written by a language model from the engine's conclusions and checked
 * against them. The first paragraph reads the pillars, the elements and the ten gods (character, abilities, strengths); the second refines
 * it with the strength and the useful and unfavourable elements and adds some everyday suggestions; the third turns the three directions of
 * the tendency page (career, study, wealth) into an encouraging reading and ends with a note that it is for reference only.
 *
 * The model is a narrator. Every fact and every classical passage it may use is in `BaziFacts`, read off the chart the engine computed;
 * nothing here lets it change a pillar, a strength level or a useful god, or quote a book the engine did not cite. The checks below reject
 * an answer that predicts, advises beyond everyday habits, contradicts the facts or cites something that is not there, and the caller then
 * falls back to `ruleBasedReading`, so the page never depends on a model being reachable.
 */

export type ReadingLocale = "zh" | "en";

export interface Reading {
  part1: string;
  part1_refs: string[];
  part2: string;
  part2_refs: string[];
  part3: string;
}

export interface EvidenceItem {
  id: string;
  topic: string;
  quotation: string;
  plain: string | null;
  source: string;
}

const ELEMENT_EN: Record<ElementKey, string> = { wood: "wood", fire: "fire", earth: "earth", metal: "metal", water: "water" };
const STRENGTH_EN: Record<DayMasterStrength, string> = {
  very_strong: "very strong",
  somewhat_strong: "somewhat strong",
  balanced: "balanced",
  somewhat_weak: "somewhat weak",
  very_weak: "very weak",
};
const GROUP_EN: Record<TenGodGroup, string> = {
  companion: "peers (比劫)",
  output: "output (食伤)",
  wealth: "wealth (财)",
  officer: "authority (官杀)",
  resource: "resource (印)",
};
const GROUPS: TenGodGroup[] = ["companion", "output", "wealth", "officer", "resource"];

/** Traditional associations of the five elements, kept to everyday habits for the fallback suggestions. */
const HABIT_ZH: Record<ElementKey, string> = {
  wood: "多到户外走动，安排规律的运动，让生活保持舒展",
  fire: "多与人交流，让作息和学习保持积极的节奏",
  earth: "保持规律作息，基础打牢再往前走，循序渐进地学习",
  metal: "养成整理、复盘和定期总结的习惯，做事讲求条理",
  water: "留出安静思考和阅读的时间，注意休息和补水",
};
const HABIT_EN: Record<ElementKey, string> = {
  wood: "spend time outdoors, keep a regular exercise habit and let life stay relaxed",
  fire: "talk with people more and keep a lively rhythm in work and study",
  earth: "keep a regular routine, lay the groundwork first and study step by step",
  metal: "tidy up, review and summarise regularly, and work in an orderly way",
  water: "set aside quiet time for thinking and reading, and rest well",
};

const FACTOR_TOPIC: Record<string, string> = {
  seasonal_command: "得令",
  rootedness: "得地",
  revealed_support: "得势",
  assisting_support: "得助",
  opposition: "克泄耗",
};

export interface BaziFacts {
  pillars: Array<{ pillar: string; ganzhi: string; stem_element: string; ten_god: string | null; hidden_stems: string[] }>;
  day_master: { stem: string; element: string; polarity: string };
  element_share_percent: Record<string, number>;
  ten_gods: Array<{ group: string; relation: string; count: number; positions: string[] }>;
  /** The three directions of the tendency page: which ten-god groups bear on each, what each stands for, and how many of them the chart holds. */
  directions: Array<{ direction: string; groups: Array<{ group: string; stands_for: string; gloss: string; count: number }> }>;
  strength: { level: string; near_balance: boolean; special_pattern: string | null };
  useful_elements: string[];
  unfavourable_elements: string[];
  methods_agree: boolean;
  /** Classical passages the engine cited for this chart; the only sources the reading may point to. */
  evidence: EvidenceItem[];
  /** Elements as keys, for the checks below; not sent to the model. */
  _keys: { dayMaster: ElementKey; level: DayMasterStrength; useful: ElementKey[]; unfavourable: ElementKey[]; stem: string };
}

/** The passages the tendency page and the strength factors quote: one per ten-god group present, then one per strength factor, at most six. */
function collectEvidence(chart: BaziChartResult): EvidenceItem[] {
  const titles = new Map(chart.source_refs.map((ref) => [ref.source_id, ref.title]));
  const items: Array<Omit<EvidenceItem, "id">> = [];
  const seen = new Set<string>();
  const add = (topic: string, quotation: string | null | undefined, plain: string | null | undefined, sourceId: string | null | undefined, chapter: string | null | undefined) => {
    if (!quotation || !sourceId || seen.has(quotation)) return;
    seen.add(quotation);
    const book = titles.get(sourceId);
    const place = (chapter ?? "").replace(`${book} · `, "");
    items.push({ topic, quotation, plain: plain ?? null, source: `${book ? `《${book}》` : ""}${place}`.trim() });
  };
  for (const tally of chart.domain_tallies) {
    for (const group of tally.groups) {
      if (group.count > 0) add(TEN_GOD_GROUP_LABEL[group.group], group.quotation, group.quotation_plain, group.source_id, group.chapter);
    }
  }
  for (const factor of chart.reasoning_trace.factors) add(FACTOR_TOPIC[factor.key] ?? factor.key, factor.quotation, factor.rule_text, factor.source_id, factor.chapter);
  return items.slice(0, 6).map((item, index) => ({ id: `E${index + 1}`, ...item }));
}

/** The facts the model may use, in the engine's own Chinese labels. */
export function buildBaziFacts(chart: BaziChartResult): BaziFacts {
  const total = Object.values(chart.elements).reduce((sum, count) => sum + count, 0) || 1;
  const positions = tenGodPositions(chart.pillars);
  const trace = chart.reasoning_trace;
  const override = trace.override?.triggered ? PATTERN_LABEL[trace.override.pattern] : null;
  return {
    pillars: chart.pillars.map((pillar) => ({
      pillar: PILLAR_LABEL[pillar.label],
      ganzhi: `${STEM_LABEL[pillar.stem]}${BRANCH_LABEL[pillar.branch]}`,
      stem_element: ELEMENT_LABEL[pillar.element],
      ten_god: pillar.ten_god ? TEN_GOD_LABEL[pillar.ten_god] : null,
      hidden_stems: pillar.hidden_stems.map((hidden) => STEM_LABEL[hidden.stem]),
    })),
    day_master: {
      stem: STEM_LABEL[chart.day_master.stem],
      element: ELEMENT_LABEL[chart.day_master.element],
      polarity: STEM_POLARITY[chart.day_master.stem] === "yang" ? "阳" : "阴",
    },
    element_share_percent: Object.fromEntries(
      (Object.keys(chart.elements) as ElementKey[]).map((key) => [ELEMENT_LABEL[key], Math.round((chart.elements[key] / total) * 1000) / 10]),
    ),
    ten_gods: GROUPS.map((group) => ({
      group: TEN_GOD_GROUP_LABEL[group],
      relation: GROUP_INFO[group].relation,
      count: positions[group].length,
      positions: positions[group],
    })),
    directions: chart.domain_tallies.map((tally) => ({
      direction: DOMAIN_LABEL[tally.domain],
      groups: tally.groups.map((group) => ({ group: TEN_GOD_GROUP_LABEL[group.group], stands_for: group.category, gloss: group.gloss, count: group.count })),
    })),
    strength: {
      level: STRENGTH_LABEL[chart.day_master.strength],
      near_balance: trace.near_balance,
      special_pattern: override,
    },
    useful_elements: chart.disposition.useful.map((key) => ELEMENT_LABEL[key]),
    unfavourable_elements: chart.disposition.unfavourable.map((key) => ELEMENT_LABEL[key]),
    methods_agree: !chart.derivation.arbitration.conflict,
    evidence: collectEvidence(chart),
    _keys: {
      dayMaster: chart.day_master.element,
      level: chart.day_master.strength,
      useful: chart.disposition.useful,
      unfavourable: chart.disposition.unfavourable,
      stem: STEM_LABEL[chart.day_master.stem],
    },
  };
}

/** What the model receives: the facts without the checking keys. */
export function modelFacts(facts: BaziFacts): Omit<BaziFacts, "_keys"> {
  const { _keys: _unused, ...rest } = facts;
  void _unused;
  return rest;
}

export function buildReadingRequest(facts: BaziFacts, locale: ReadingLocale) {
  const language = locale === "en" ? "English (keep the Chinese term in brackets the first time it appears)" : "简体中文";
  const systemInstruction = [
    `你是命理知识平台的解读助手，用${language}为普通读者写一份三段的命盘解读：口语化、有温度、说人话，像一位懂行的朋友在慢慢讲给你听；多用生活里的比喻和小例子，让完全不懂命理的读者也能轻松看懂；整体基调积极、温暖、鼓励，同时保持客观，不渲染，不吓人。`,
    "四柱、日主、五行比例、十神位置、身强身弱、用神和忌神都是规则引擎已经算好的结论，你只能依据 facts 里已有的内容，不得改动、补充或推翻；也不得引用 facts.evidence 以外的典籍。可以借用日主五行的传统取象（比如木像草木的生长、火像光和热）以及 facts.ten_gods 里各组十神的含义来帮助读者理解，但要说成“倾向于”“往往”“可能”，不下定论。",
    "第一段 part1（命盘特征，写得充实一些）：从四柱和五行、十神入手，先说这张盘整体是什么样子，再展开：性格上的特点（待人处事、做事的方式）、能力上的倾向（擅长什么、怎样发挥）、可能的优势和自己也许没留意到的闪光点。比如哪一类十神出现得多，就说那一面在生活里大概怎么表现。多举生活里的小场景，让读者“对得上号”。至少引用一条 evidence，把用到的编号写进 part1_refs，正文里自然地点明“典籍里说……”。",
    "第二段 part2（强弱和用神，细化第一段）：在第一段的基础上，结合身强身弱和用神、忌神做细化分析，说明哪些方面是优势、哪些方面宜多留意；然后给出两到三条日常学习和生活方面的参考建议，建议只限于作息、学习方法、与人相处的节奏这类日常习惯，可以结合用神五行的传统取象来说明理由。",
    "第三段 part3（三个方向的现代解读，只讲积极的一面）：依次谈职业、学业、财运三个方向，每个方向两三句。只依据 facts.directions 里 count 大于 0 的十神组，把它们代表的特质写成可以发挥的优势和潜力，语气积极、乐观、鼓励；count 为 0 的组不要当作优势，也不要提它缺少什么。不写缺点、不足、风险、困难，也不写结果会怎样，只写“适合发挥……”“可以往……方向用力”这样的倾向。最后一句话说明以上解读仅供参考。",
    "全文不得预测事件、运势、事业财运的结果、婚姻、健康或寿命；建议不涉及购买、佩戴、风水、改名、开运、投资、就医，也不涉及结婚、分手、辞职一类的重大决定；不使用“一定、必然、注定、保证”一类的断言。",
    "名称和数字必须与 facts 完全一致：只把 useful_elements 里的五行写成用神，只把 unfavourable_elements 里的五行写成忌神，part2 要写明身强身弱的结论。如果 strength.near_balance 为 true，必须说明强弱接近分界线、结论只是倾向；如果 special_pattern 不为空，说明命局按该特殊格局判断。",
    "篇幅：part1 约 220 到 340 字，part2 约 160 到 260 字，part3 约 180 到 300 字（英文约 1.4 倍的词数）。part1_refs、part2_refs 是你引用的 evidence 编号数组，part2_refs 可以为空。",
    "只返回严格符合 output_contract 的 JSON 对象。",
  ].join("\n");
  const outputContract = {
    part1: "第一段：命盘特征；性格、能力、优势的展开，口语化、有生活场景；引用典籍",
    part1_refs: "数组，例如 [\"E1\", \"E2\"]，至少一个，必须是 facts.evidence 里的编号",
    part2: "第二段：结合身强身弱和用神忌神细化；两到三条日常学习生活的参考建议",
    part2_refs: "数组，可以为空",
    part3: "第三段：职业、学业、财运三个方向，只写积极的优势和潜力；末句说明仅供参考",
  };
  return { systemInstruction, payload: { facts: modelFacts(facts) }, outputContract };
}

/** The few things a reading must never do: promise or predict, name a disaster or an illness, or sell a remedy. Everything else is left to the prompt. */
const FORBIDDEN: RegExp[] = [
  /一定会|必然|必定|注定|命中注定|肯定会|保证|包你|绝对会/,
  /发财|暴富|破财|横财|升官|失业|桃花运|克夫|克妻|离婚|早逝|短命|官司|牢狱|血光|癌|重病|大病/,
  /风水|开运|转运|招财|改运|佩戴|改名|吃药/,
  /\b(definitely|certainly|guarantee[ds]?|destined|doomed|fated)\b/i,
  /\byou (will|'ll) (get|become|marry|earn|lose|fall|succeed|fail|meet)\b/i,
  /\b(get rich|divorce|illness|disease|bankrupt|lawsuit|feng shui|lucky charm|medication)\b/i,
];

/** The third paragraph is meant to encourage; only words that plainly discourage are refused. */
const DISCOURAGING: RegExp[] = [/失败|挫折|不适合|没有天赋|缺点|劣势|短板/, /\b(failure|unsuitable|disadvantages?|drawbacks?)\b/i];

const LENGTH: Record<"part1" | "part2" | "part3", { min: number; max: number }> = {
  part1: { min: 60, max: 1600 },
  part2: { min: 40, max: 1400 },
  part3: { min: 40, max: 1400 },
};

export interface ReadingCheck {
  valid: boolean;
  errors: string[];
  reading: Reading | null;
}

function sentences(text: string): string[] {
  return text.split(/[。！？；;.!?\n]+/).map((part) => part.trim()).filter(Boolean);
}

function mentions(sentence: string, keys: ElementKey[], locale: ReadingLocale): boolean {
  const lower = sentence.toLowerCase();
  return keys.some((key) => (locale === "zh" ? sentence.includes(ELEMENT_LABEL[key]) : lower.includes(ELEMENT_EN[key]) || sentence.includes(ELEMENT_LABEL[key])));
}

function refs(value: unknown, known: Set<string>, name: string, errors: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    errors.push(`${name} 必须是字符串数组`);
    return [];
  }
  const unknown = (value as string[]).filter((id) => !known.has(id));
  if (unknown.length) errors.push(`${name} 引用了不存在的出处：${unknown.join("、")}`);
  return [...new Set(value as string[])];
}

/** Whether a model answer may be shown: the right shape, no prediction, nothing that contradicts the facts, only cited passages that exist. */
export function checkReading(value: unknown, facts: BaziFacts, locale: ReadingLocale): ReadingCheck {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, errors: ["输出不是 JSON 对象"], reading: null };
  const record = value as Record<string, unknown>;
  const text: Record<"part1" | "part2" | "part3", string> = { part1: "", part2: "", part3: "" };
  for (const key of ["part1", "part2", "part3"] as const) {
    const field = record[key];
    if (typeof field !== "string") {
      errors.push(`缺少字段 ${key}`);
      continue;
    }
    text[key] = field.trim();
    if (text[key].length < LENGTH[key].min || text[key].length > LENGTH[key].max) errors.push(`字段 ${key} 的长度不合适`);
  }
  const known = new Set(facts.evidence.map((item) => item.id));
  const part1Refs = refs(record.part1_refs, known, "part1_refs", errors);
  const part2Refs = refs(record.part2_refs, known, "part2_refs", errors);
  if (errors.length) return { valid: false, errors, reading: null };

  const all = `${text.part1}\n${text.part2}\n${text.part3}`;
  for (const pattern of FORBIDDEN) if (pattern.test(all)) errors.push(`出现预测、保证或改运式措辞：${pattern.source.slice(0, 24)}`);

  const { _keys: keys } = facts;

  // A level named next to the day master must be the engine's; a reading that does not name one is left alone.
  const statedLevels =
    locale === "zh"
      ? [...text.part2.matchAll(/日主[^，。；、]{0,3}?(太旺|偏旺|中和|偏弱|太弱)/g)].map((match) => match[1])
      : [...text.part2.toLowerCase().matchAll(/day master[^.;]{0,24}?\b(very strong|somewhat strong|balanced|somewhat weak|very weak)\b/g)].map((match) => match[1]);
  const expectedLevel = locale === "zh" ? STRENGTH_LABEL[keys.level] : STRENGTH_EN[keys.level];
  if (statedLevels.some((level) => level !== expectedLevel)) errors.push("第二段身强身弱的结论与引擎不一致");

  const usefulOnly = keys.useful.filter((key) => !keys.unfavourable.includes(key));
  const unfavourableOnly = keys.unfavourable.filter((key) => !keys.useful.includes(key));
  const usefulWord = locale === "zh" ? /用神/ : /useful/i;
  const unfavourableWord = locale === "zh" ? /忌神/ : /unfavourable|avoid|burden/i;
  for (const sentence of sentences(text.part2)) {
    if (usefulWord.test(sentence) && !unfavourableWord.test(sentence) && mentions(sentence, unfavourableOnly, locale)) {
      errors.push("把忌神的五行写成了用神");
      break;
    }
    if (unfavourableWord.test(sentence) && !usefulWord.test(sentence) && mentions(sentence, usefulOnly, locale)) {
      errors.push("把用神的五行写成了忌神");
      break;
    }
  }

  const directionWords = locale === "zh" ? [/职业|事业|工作|职场/, /学业|学习|读书|求学|考试/, /财运|财富|收入|理财|赚钱/] : [/career|work/i, /stud(y|ies)|learning/i, /wealth|money|finance|income/i];
  if (!directionWords.every((word) => word.test(text.part3))) errors.push("第三段没有依次谈到职业、学业、财运");
  if (DISCOURAGING.some((pattern) => pattern.test(text.part3))) errors.push("第三段出现了消极或不鼓励的措辞");
  if (!(locale === "zh" ? /仅供参考|仅作参考/ : /for reference|for your reference|reference only/i).test(text.part3)) {
    errors.push("第三段没有“仅供参考”的说明");
  }

  return errors.length
    ? { valid: false, errors, reading: null }
    : { valid: true, errors: [], reading: { part1: text.part1, part1_refs: part1Refs, part2: text.part2, part2_refs: part2Refs, part3: text.part3 } };
}

function listElements(keys: ElementKey[], locale: ReadingLocale): string {
  if (locale === "zh") return keys.map((key) => ELEMENT_LABEL[key]).join("、");
  return keys.map((key) => `${ELEMENT_EN[key]} (${ELEMENT_LABEL[key]})`).join(", ");
}

/** What each ten-god group tends to look like in daily life, in plain words; used only by the template reading. */
const TRAIT_ZH: Record<TenGodGroup, string> = {
  companion: "有主见、重自主，遇事习惯自己拿主意，也愿意与同伴并肩合作",
  output: "表达欲和创造力比较强，点子多，愿意把想法讲出来、做出来",
  wealth: "务实、重成效，懂得权衡和安排资源，做事讲求实际回报",
  officer: "守规矩、有责任感，对秩序和分寸比较敏感，适合承担组织协调的角色",
  resource: "爱思考、肯学习，吸收新东西的能力比较好，也比较细心稳重",
};
const TRAIT_EN: Record<TenGodGroup, string> = {
  companion: "independent and self-directed, used to making up your own mind while still happy to work side by side",
  output: "expressive and inventive, full of ideas and glad to say or make them",
  wealth: "practical and results-minded, good at weighing and arranging resources",
  officer: "dutiful and attentive to order and proportion, well suited to organising and coordinating",
  resource: "thoughtful and eager to learn, quick to take things in and careful and steady",
};

/** The same three paragraphs from templates: what the page shows when no model answers or the answer fails the checks. */
export function ruleBasedReading(chart: BaziChartResult, facts: BaziFacts, locale: ReadingLocale): Reading {
  const keys = facts._keys;
  const strength = chart.day_master.strength;
  const weak = strength === "somewhat_weak" || strength === "very_weak";
  const shares = (Object.keys(chart.elements) as ElementKey[]).sort((a, b) => chart.elements[b] - chart.elements[a]);
  const top = shares.filter((key) => chart.elements[key] === chart.elements[shares[0]]);
  const missing = shares.filter((key) => chart.elements[key] === 0);
  const positions = tenGodPositions(chart.pillars);
  const ranked = [...GROUPS].sort((a, b) => positions[b].length - positions[a].length);
  const busiest = ranked[0];
  const second = ranked.find((group) => group !== busiest && positions[group].length > 0);
  const near = facts.strength.near_balance;
  const pattern = facts.strength.special_pattern;
  const pct = (key: ElementKey) => facts.element_share_percent[ELEMENT_LABEL[key]];
  const ganzhi = facts.pillars.map((pillar) => pillar.ganzhi).join(" ");
  const unfavourable = keys.unfavourable.filter((key) => !keys.useful.includes(key));
  const cited = facts.evidence.find((item) => item.topic === TEN_GOD_GROUP_LABEL[busiest]) ?? facts.evidence[0];
  const part1Refs = cited ? [cited.id] : [];
  const habits = keys.useful.slice(0, 2);
  const traits = [busiest, second].filter((group): group is TenGodGroup => Boolean(group));

  // For each direction, the first group the chart holds; a direction the chart holds none of says so kindly instead of listing a lack.
  const directionLine = (index: number): { zh: string; en: string } => {
    const direction = chart.domain_tallies[index];
    const held = direction?.groups.find((group) => group.count > 0);
    const name = direction ? DOMAIN_LABEL[direction.domain] : "";
    if (!held) return { zh: `${name}上不被某一种固定的路数限定，发展空间比较开阔，可以按自己的兴趣去尝试`, en: `in ${direction?.domain ?? "this direction"} you are not tied to one fixed path, so there is room to follow your own interests` };
    return {
      zh: `${name}上，命盘里有“${held.category}”这一类特质（${held.gloss}），这是可以发挥的长处，可以往这个方向多用力`,
      en: `in ${direction.domain}, the chart holds the "${held.category}" quality, a strength you can lean on`,
    };
  };
  const [careerLine, studyLine, wealthLine] = [0, 1, 2].map(directionLine);

  if (locale === "zh") {
    const quote = cited ? `典籍里对${cited.topic}有这样的说法：“${cited.plain ?? cited.quotation}”（${cited.source}）。` : "";
    return {
      part1: `这张命盘的四柱是 ${ganzhi}，日主为${facts.day_master.stem}（${facts.day_master.element}）。八个字里${listElements(top, "zh")}最多（${pct(top[0])}%）${missing.length ? `，${listElements(missing, "zh")}没有出现` : ""}，十神里${TEN_GOD_GROUP_LABEL[busiest]}出现得最多，共 ${positions[busiest].length} 处。落到性格和做事上，${traits.map((group) => TRAIT_ZH[group]).join("；")}，这些倾向往往会在日常的小事里慢慢显露出来。${quote}`,
      part1_refs: part1Refs,
      part2: `日主${STRENGTH_LABEL[strength]}，意思是日主自身的力量相对${weak ? "不足，命局更需要生扶" : "充足，命局更需要疏泄和克制"}${near ? "；而且接近强弱的分界线，这个结论只是倾向，不是定论" : ""}${pattern ? `；命局按${pattern}判断` : ""}。用神为${listElements(keys.useful, "zh")}，是对命局起补益作用的五行${unfavourable.length ? `；忌神为${listElements(unfavourable, "zh")}，是命局里已经偏多或会加重偏向的五行` : ""}。日常可以参考：${habits.map((key) => HABIT_ZH[key]).join("；")}。`,
      part2_refs: [],
      part3: `放到三个方向上看：${careerLine.zh}；${studyLine.zh}；${wealthLine.zh}。愿这些特质帮你更有底气地往前走。以上解读仅供参考，不构成预测，也不构成现实决策建议。`,
    };
  }
  const level = STRENGTH_EN[strength];
  const quote = cited ? ` The classics say of ${cited.topic}: "${cited.plain ?? cited.quotation}" (${cited.source}).` : "";
  return {
    part1: `The four pillars are ${ganzhi}, and the day master is ${facts.day_master.stem} (${ELEMENT_EN[keys.dayMaster]}). Across the eight characters ${listElements(top, "en")} appears most (${pct(top[0])}%)${missing.length ? `, and ${listElements(missing, "en")} does not appear` : ""}, and among the ten gods the ${GROUP_EN[busiest]} group appears most, ${positions[busiest].length} times. In character and in the way you work, you are ${traits.map((group) => TRAIT_EN[group]).join("; and ")}, and these leanings tend to show up in everyday small things.${quote}`,
    part1_refs: part1Refs,
    part2: `The day master is ${level}, meaning its own strength is relatively ${weak ? "short, so the chart leans on support" : "plentiful, so the chart leans on draining and restraint"}${near ? "; the result sits close to the dividing line, so treat it as a tendency rather than a verdict" : ""}${pattern ? `; the chart is judged as a special structure (${pattern})` : ""}. The useful elements are ${listElements(keys.useful, "en")}, the ones that support the chart${unfavourable.length ? `; the unfavourable elements are ${listElements(unfavourable, "en")}, the ones that are already plentiful or would add to the lean` : ""}. For everyday life you could ${habits.map((key) => HABIT_EN[key]).join("; and ")}.`,
    part2_refs: [],
    part3: `Across the three directions: ${careerLine.en}; ${studyLine.en}; ${wealthLine.en}. May these qualities give you steadier footing as you go forward. This reading is for reference only, and it is neither a prediction nor advice for real-world decisions.`,
  };
}
