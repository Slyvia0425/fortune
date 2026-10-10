/**
 * Structural facts derived from a chart for display: which ten-god group each
 * element plays relative to the day master, where each group appears, and the
 * plain-language note shown when a character is selected.
 *
 * Everything here is deterministic and descriptive. Nothing expresses a
 * favourable or unfavourable judgement — that boundary is part of the module
 * design, and these notes deliberately stop at "what relation is this".
 */

import type {
  BaziPillar,
  EarthlyBranch,
  ElementKey,
  HeavenlyStem,
  HiddenStem,
  PillarLabel,
  TenGod,
} from "@/lib/contracts/bazi";
import {
  BRANCH_LABEL,
  ELEMENT_LABEL,
  QI_LABEL,
  STEM_LABEL,
  TEN_GOD_LABEL,
} from "./display"; // relative: vitest has no "@/" alias configured

export type Polarity = "yang" | "yin";

export const STEM_POLARITY: Record<HeavenlyStem, Polarity> = {
  jia: "yang",
  yi: "yin",
  bing: "yang",
  ding: "yin",
  wu: "yang",
  ji: "yin",
  geng: "yang",
  xin: "yin",
  ren: "yang",
  gui: "yin",
};

export const BRANCH_ELEMENT: Record<EarthlyBranch, ElementKey> = {
  zi: "water",
  chou: "earth",
  yin: "wood",
  mao: "wood",
  chen: "earth",
  si: "fire",
  wu_branch: "fire",
  wei: "earth",
  shen: "metal",
  you: "metal",
  xu: "earth",
  hai: "water",
};

/** Each element generates the next: 木→火→土→金→水→木. */
export const GENERATING_ORDER: ElementKey[] = ["wood", "fire", "earth", "metal", "water"];

export type TenGodGroup = "companion" | "output" | "wealth" | "officer" | "resource";

export const TEN_GOD_GROUP: Record<TenGod, TenGodGroup> = {
  friend: "companion",
  rob_wealth: "companion",
  eating_god: "output",
  hurting_officer: "output",
  indirect_wealth: "wealth",
  direct_wealth: "wealth",
  seven_killings: "officer",
  direct_officer: "officer",
  indirect_resource: "resource",
  direct_resource: "resource",
};

export const GROUP_INFO: Record<
  TenGodGroup,
  { label: string; relation: string; definition: string; polarityRule: string }
> = {
  companion: {
    label: "比劫",
    relation: "同我者",
    definition: "与日主五行相同者为比劫",
    polarityRule: "阴阳相同为比肩，相异为劫财",
  },
  output: {
    label: "食伤",
    relation: "我生者",
    definition: "日主所生者为食伤",
    polarityRule: "阴阳相同为食神，相异为伤官",
  },
  wealth: {
    label: "财",
    relation: "我克者",
    definition: "日主所克者为财",
    polarityRule: "阴阳相同为偏财，相异为正财",
  },
  officer: {
    label: "官杀",
    relation: "克我者",
    definition: "克日主者为官杀",
    polarityRule: "阴阳相同为七杀，相异为正官",
  },
  resource: {
    label: "印",
    relation: "生我者",
    definition: "生日主者为印",
    polarityRule: "阴阳相同为偏印，相异为正印",
  },
};

// Offset along the generating cycle from the day master's element.
const GROUP_BY_OFFSET: TenGodGroup[] = ["companion", "output", "wealth", "officer", "resource"];

/** The ten-god group an element plays relative to the day master's element. */
export function groupForElement(element: ElementKey, dayMaster: ElementKey): TenGodGroup {
  const offset =
    (GENERATING_ORDER.indexOf(element) - GENERATING_ORDER.indexOf(dayMaster) + 5) % 5;
  return GROUP_BY_OFFSET[offset];
}

/** Elements in generating order, rotated so the day master's element comes first. */
export function cycleFromDayMaster(dayMaster: ElementKey): ElementKey[] {
  const start = GENERATING_ORDER.indexOf(dayMaster);
  return GENERATING_ORDER.map((_, i) => GENERATING_ORDER[(start + i) % 5]);
}

const PILLAR_PREFIX: Record<PillarLabel, string> = {
  year: "年",
  month: "月",
  day: "日",
  hour: "时",
};

const POLARITY_LABEL: Record<Polarity, string> = { yang: "阳", yin: "阴" };

export interface ChartCell {
  /** Stable id, e.g. "year-stem". */
  id: string;
  pillar: PillarLabel;
  position: "stem" | "branch";
  /** Display character, e.g. "癸". */
  char: string;
  element: ElementKey;
  /** Only stems carry a polarity here. */
  polarity: Polarity | null;
  /** Stem: its own ten-god. Branch: the ten-god of its primary hidden stem. */
  tenGod: TenGod | null;
  hiddenStems: HiddenStem[];
  isDayMaster: boolean;
  isMonthBranch: boolean;
}

/** The eight characters of the chart, in reading order. */
export function chartCells(pillars: BaziPillar[]): ChartCell[] {
  return pillars.flatMap((pillar) => {
    const primary = pillar.hidden_stems.find((hidden) => hidden.qi === "primary");
    const stem: ChartCell = {
      id: `${pillar.label}-stem`,
      pillar: pillar.label,
      position: "stem",
      char: STEM_LABEL[pillar.stem],
      element: pillar.element,
      polarity: STEM_POLARITY[pillar.stem],
      tenGod: pillar.ten_god,
      hiddenStems: [],
      isDayMaster: pillar.label === "day",
      isMonthBranch: false,
    };
    const branch: ChartCell = {
      id: `${pillar.label}-branch`,
      pillar: pillar.label,
      position: "branch",
      char: BRANCH_LABEL[pillar.branch],
      element: BRANCH_ELEMENT[pillar.branch],
      polarity: null,
      tenGod: primary?.ten_god ?? null,
      hiddenStems: pillar.hidden_stems,
      isDayMaster: false,
      isMonthBranch: pillar.label === "month",
    };
    return [stem, branch];
  });
}

function placeLabel(cell: ChartCell): string {
  const base = `${PILLAR_PREFIX[cell.pillar]}${cell.position === "stem" ? "干" : "支"}`;
  if (cell.isDayMaster) return `${base}（日主）`;
  if (cell.isMonthBranch) return `${base}（月令）`;
  return base;
}

export interface CellNote {
  title: string;
  place: string;
  relation: string;
  body: string;
}

/** What each branch is used for in the reading, in the page's own terms (the month branch is the 月令; the others are where the day master's root is looked for). */
const BRANCH_ROLE: Record<PillarLabel, string> = {
  year: "年支的藏干与日支、时支一起，用来看日主有没有根（得地）。",
  month: "月支又称月令，是判断日主强弱时最先考察的一项。",
  day: "日支是日主所坐之地，藏干里有没有与日主同五行者，是看日主有没有根（得地）的依据之一。",
  hour: "时支由出生时辰定出，藏干与年支、日支一起，用来看日主有没有根（得地）。",
};

/** The annotation shown when a character is selected. */
export function cellNote(cell: ChartCell, dayMaster: ChartCell): CellNote {
  const elementLabel = ELEMENT_LABEL[cell.element];
  const place = placeLabel(cell);

  if (cell.isDayMaster) {
    return {
      title: `${cell.char} · ${POLARITY_LABEL[cell.polarity ?? "yang"]}${elementLabel}`,
      place,
      relation: "整张命盘的参照点",
      body: "日主代表命主本人。其余七字的十神，都是以它为参照推出来的。",
    };
  }

  if (cell.position === "stem") {
    const tenGod = cell.tenGod;
    const group = tenGod ? GROUP_INFO[TEN_GOD_GROUP[tenGod]] : null;
    const same = cell.polarity === dayMaster.polarity;
    const body =
      group && tenGod
        ? `${group.definition}。${cell.char}${elementLabel}为${POLARITY_LABEL[cell.polarity ?? "yang"]}、日主${dayMaster.char}${ELEMENT_LABEL[dayMaster.element]}为${POLARITY_LABEL[dayMaster.polarity ?? "yang"]}，阴阳${same ? "相同" : "相异"}，故为${TEN_GOD_LABEL[tenGod]}。`
        : "";
    return {
      title: `${cell.char} · ${POLARITY_LABEL[cell.polarity ?? "yang"]}${elementLabel}`,
      place,
      relation: tenGod ? `相对日主：${TEN_GOD_LABEL[tenGod]}` : "",
      body,
    };
  }

  const primary = cell.hiddenStems.find((hidden) => hidden.qi === "primary");
  const hiddenList = cell.hiddenStems
    .map((hidden) => `${STEM_LABEL[hidden.stem]}${ELEMENT_LABEL[hidden.element]}（${QI_LABEL[hidden.qi]}）`)
    .join("、");
  const parts = [
    BRANCH_ROLE[cell.pillar],
    hiddenList ? `${cell.char}中藏${hiddenList}。` : "",
  ];
  if (primary && primary.element === dayMaster.element) {
    parts.push("本气与日主五行相同，是日主在地支中的根。");
  }
  return {
    title: `${cell.char} · ${elementLabel}`,
    place,
    relation: "",
    body: parts.join(""),
  };
}

/** Occurrences of every ten-god group: visible stems plus all hidden stems. */
export function tenGodPositions(pillars: BaziPillar[]): Record<TenGodGroup, string[]> {
  const positions: Record<TenGodGroup, string[]> = {
    companion: [],
    output: [],
    wealth: [],
    officer: [],
    resource: [],
  };
  for (const pillar of pillars) {
    const prefix = PILLAR_PREFIX[pillar.label];
    if (pillar.ten_god) {
      positions[TEN_GOD_GROUP[pillar.ten_god]].push(
        `${prefix}干 ${STEM_LABEL[pillar.stem]} · ${TEN_GOD_LABEL[pillar.ten_god]}`,
      );
    }
    for (const hidden of pillar.hidden_stems) {
      const qi = hidden.qi === "primary" ? "" : `（${QI_LABEL[hidden.qi]}）`;
      positions[TEN_GOD_GROUP[hidden.ten_god]].push(
        `${prefix}支 ${BRANCH_LABEL[pillar.branch]} · 藏${STEM_LABEL[hidden.stem]}${qi} · ${TEN_GOD_LABEL[hidden.ten_god]}`,
      );
    }
  }
  return positions;
}
