import type { Metadata } from "next";

import DrawPanel from "../components/draw-panel";
import PageHeading from "../components/page-heading";

export const metadata: Metadata = { title: "观音灵签" };

export default function Page() {
  return <main className="subpage guanyin-page">
    <PageHeading eyebrow="观音百签" title="静心一念，签落有声" description="签号由浏览器安全随机数从完整百签库中抽取。问题只影响阅读焦点，不会改变签文原文。" />
    <section className="page-shell section-block"><div className="panel"><p className="kicker">求签之前</p><h2>一签，只问一事</h2><p className="panel-intro">短暂静心，将问题在心中说明白。传统签文与分项解释来自项目签库，并会与辅助解读清楚区分。</p><DrawPanel /></div></section>
  </main>;
}
