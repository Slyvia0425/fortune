import type { BaziChartResult } from "@/lib/contracts/bazi";
import { ELEMENT_LABEL, STEM_LABEL } from "@/lib/bazi/display";
import CollectionButton from "@/app/components/collection-button";
import {
  arbitrationEvidence,
  chartSourceId,
  dayMasterText,
  displayName,
  factorEvidence,
  personKey,
  sourceEvidence,
  type BaziProfileActivity,
  yongshenText,
} from "./profile-activity";
import { BAZI_TERMS } from "@/lib/bazi/knowledge-links";
import { ElementDistribution } from "./element-distribution";
import { TermLink } from "./knowledge-link";
import { StrengthBreakdown } from "./strength-breakdown";
import { TenGodRelations } from "./ten-god-relations";
import { YongshenDerivation } from "./yongshen-derivation";
import styles from "./bazi-chart.module.css";
import { useI18n } from "@/lib/i18n";

/** Step 3: the chart's structure (element distribution, ten gods), how strong the day master is and why, and the useful elements derived from it. */
export function ElementsStep({ chart, profileActivity }: { chart: BaziChartResult; profileActivity?: BaziProfileActivity }) {
  const { t } = useI18n();
  const elements = (Object.keys(chart.elements) as Array<keyof typeof chart.elements>)
    .map((key) => `${ELEMENT_LABEL[key]} ${chart.elements[key]}`)
    .join("，");
  return (
    <>
      <h2>{t("五行十神")}</h2>
      <p className="kicker">{t("命局结构")}</p>
      <p className={styles.subline}>
        <TermLink term={BAZI_TERMS.dayMaster}>日主</TermLink> {STEM_LABEL[chart.day_master.stem]}
        {ELEMENT_LABEL[chart.day_master.element]} · 以下十神均相对日主而论
      </p>

      <ElementDistribution chart={chart} delay="0ms" />
      <TenGodRelations chart={chart} delay="120ms" />
      <StrengthBreakdown chart={chart} delay="240ms" />
      <YongshenDerivation chart={chart} delay="360ms" />

      {profileActivity ? (
        <CollectionButton
          {...profileActivity}
          action="interpretation"
          evidence={[...factorEvidence(chart), ...arbitrationEvidence(chart), ...sourceEvidence(chart)]}
          itemType="bazi_analysis"
          label="收藏五行十神"
          module="bazi"
          sourceId={`${chartSourceId(chart, personKey(profileActivity))}:elements`}
          step="elements"
          summary={`${displayName(profileActivity)} · 五行分布 ${elements}；日主 ${dayMasterText(chart)}；${yongshenText(chart)}。`}
          tags={["八字", "五行", "十神"]}
          title={`${displayName(profileActivity)} · 五行十神依据`}
          snapshot={{
            elements: chart.elements,
            day_master: chart.day_master,
            disposition: chart.disposition,
            derivation: chart.derivation,
            reasoning_trace: chart.reasoning_trace,
          }}
        />
      ) : null}
    </>
  );
}
