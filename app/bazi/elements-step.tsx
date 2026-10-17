import type { BaziChartResult } from "@/lib/contracts/bazi";
import { ELEMENT_LABEL, STEM_LABEL } from "@/lib/bazi/display";
import { ElementDistribution } from "./element-distribution";
import { StrengthBreakdown } from "./strength-breakdown";
import { TenGodRelations } from "./ten-god-relations";
import { YongshenDerivation } from "./yongshen-derivation";
import styles from "./bazi-chart.module.css";

/** Step 3: the chart's structure (element distribution, ten gods), how strong the day master is and why, and the useful elements derived from it. */
export function ElementsStep({ chart }: { chart: BaziChartResult }) {
  return (
    <>
      <h2>五行十神</h2>
      <p className="kicker">命局结构</p>
      <p className={styles.subline}>
        日主 {STEM_LABEL[chart.day_master.stem]}
        {ELEMENT_LABEL[chart.day_master.element]} · 以下十神均相对日主而论
      </p>

      <ElementDistribution chart={chart} delay="0ms" />
      <TenGodRelations chart={chart} delay="120ms" />
      <StrengthBreakdown chart={chart} delay="240ms" />
      <YongshenDerivation chart={chart} delay="360ms" />
    </>
  );
}
