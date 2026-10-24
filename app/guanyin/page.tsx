import type { Metadata } from "next";

import DrawPanel from "../components/draw-panel";
import PageHeading from "../components/page-heading";
import Trans from "../components/trans";
import { siteLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await siteLocale();
  return { title: translate(locale, "观音灵签") };
}

export default function Page() {
  return <main className="subpage guanyin-page">
    <PageHeading eyebrow="观音百签" title="静心一念，签落有声" description="在心中安放一件所问之事。所得之签不替你决定，只借古意照见当下。" />
    <section className="page-shell section-block guanyin-entry-section"><div className="panel guanyin-entry-panel">
      <div className="guanyin-entry-copy"><p className="kicker"><Trans zh="求签之前" /></p><h2><Trans zh="一签，只问一事" /></h2><p className="panel-intro"><Trans zh="短暂静心，把此刻真正想确认的事情说清楚。先读签诗，再结合现实处境理解其中的提醒。" /></p><DrawPanel /></div>
      <aside className="guanyin-entry-guide" aria-label="求签提示"><div className="entry-seal" aria-hidden="true"><span>观音</span><span>灵签</span></div><ol><li><b>壹</b><span><strong><Trans zh="一事一问" /></strong><small><Trans zh="让所问清楚而专一" /></small></span></li><li><b>贰</b><span><strong><Trans zh="随缘得签" /></strong><small><Trans zh="不预设想要的答案" /></small></span></li><li><b>叁</b><span><strong><Trans zh="静心而读" /></strong><small><Trans zh="把签意带回现实思考" /></small></span></li></ol></aside>
    </div></section>
  </main>;
}
