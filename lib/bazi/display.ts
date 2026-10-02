/**
 * Romanised contract keys → Chinese display names.
 *
 * The contract speaks `jia` / `zi` / `direct_wealth`; the UI shows 甲 / 子 / 正财.
 * bazi_service/app/models/enums.py holds the same maps for the Python side —
 * if you add a key to one, add it to the other.
 */

import type {
  AdvisoryDomain,
  ArbitrationOutcome,
  DerivationMethod,
  LuckDirection,
  DayMasterStrength,
  EarthlyBranch,
  ElementKey,
  HeavenlyStem,
  PillarLabel,
  SolarTerm,
  SpecialPattern,
  TenGod,
  TenGodGroup,
} from "@/lib/contracts/bazi";

export const STEM_LABEL: Record<HeavenlyStem, string> = {
  jia: "甲",
  yi: "乙",
  bing: "丙",
  ding: "丁",
  wu: "戊",
  ji: "己",
  geng: "庚",
  xin: "辛",
  ren: "壬",
  gui: "癸",
};

export const BRANCH_LABEL: Record<EarthlyBranch, string> = {
  zi: "子",
  chou: "丑",
  yin: "寅",
  mao: "卯",
  chen: "辰",
  si: "巳",
  wu_branch: "午",
  wei: "未",
  shen: "申",
  you: "酉",
  xu: "戌",
  hai: "亥",
};

export const ELEMENT_LABEL: Record<ElementKey, string> = {
  wood: "木",
  fire: "火",
  earth: "土",
  metal: "金",
  water: "水",
};

export const TEN_GOD_LABEL: Record<TenGod, string> = {
  friend: "比肩",
  rob_wealth: "劫财",
  eating_god: "食神",
  hurting_officer: "伤官",
  indirect_wealth: "偏财",
  direct_wealth: "正财",
  seven_killings: "七杀",
  direct_officer: "正官",
  indirect_resource: "偏印",
  direct_resource: "正印",
};

export const STRENGTH_LABEL: Record<DayMasterStrength, string> = {
  very_strong: "太旺",
  somewhat_strong: "偏旺",
  balanced: "中和",
  somewhat_weak: "偏弱",
  very_weak: "太弱",
};

export const PATTERN_LABEL: Record<SpecialPattern, string> = {
  following_wealth: "从财格",
  following_officer: "从官杀格",
  dominant_element: "专旺格",
  dual_qi_formation: "两气成象",
};

export const PILLAR_LABEL: Record<PillarLabel, string> = {
  year: "年柱",
  month: "月柱",
  day: "日柱",
  hour: "时柱",
};

export const TEN_GOD_GROUP_LABEL: Record<TenGodGroup, string> = {
  companion: "比劫",
  output: "食伤",
  wealth: "财",
  officer: "官杀",
  resource: "印",
};

export const FACTOR_LABEL: Record<string, string> = {
  seasonal_command: "得令",
  rootedness: "得地",
  revealed_support: "得势",
  assisting_support: "得助",
};

export const QI_LABEL: Record<string, string> = {
  primary: "本气",
  middle: "中气",
  residual: "余气",
};

export const DISPOSITION_LABEL: Record<string, string> = {
  useful: "用神",
  unfavourable: "忌神",
  neutral: "中性",
};

export const SOLAR_TERM_LABEL: Record<SolarTerm, string> = {
  lichun: "立春",
  yushui: "雨水",
  jingzhe: "惊蛰",
  chunfen: "春分",
  qingming: "清明",
  guyu: "谷雨",
  lixia: "立夏",
  xiaoman: "小满",
  mangzhong: "芒种",
  xiazhi: "夏至",
  xiaoshu: "小暑",
  dashu: "大暑",
  liqiu: "立秋",
  chushu: "处暑",
  bailu: "白露",
  qiufen: "秋分",
  hanlu: "寒露",
  shuangjiang: "霜降",
  lidong: "立冬",
  xiaoxue: "小雪",
  daxue: "大雪",
  dongzhi: "冬至",
  xiaohan: "小寒",
  dahan: "大寒",
};

export const METHOD_LABEL: Record<DerivationMethod, string> = {
  supporting: "扶抑",
  climatic: "调候",
};

export const ARBITRATION_LABEL: Record<ArbitrationOutcome, string> = {
  agree: "两法一致",
  supporting: "采纳扶抑",
  climatic: "采纳调候",
  both: "两者兼用",
  other: "其他",
};

export const LUCK_DIRECTION_LABEL: Record<LuckDirection, string> = {
  forward: "顺排",
  reverse: "逆排",
};

export const DOMAIN_LABEL: Record<AdvisoryDomain, string> = {
  career: "职业方向",
  study: "学业方向",
  wealth: "财运",
};
