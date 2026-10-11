import type { Metadata } from "next";
import PageHeading from "../components/page-heading";
import BaziWorkspace from "./bazi-workspace";

export const metadata: Metadata = { title: "八字命盘" };

export default function Page() {
  return (
    <main className="subpage">
      <PageHeading
        eyebrow="八字命盘"
        title="以四时，观五行"
        description="输入出生时间与地点，建立结构化命盘。由规则引擎排出四柱，判断日主强弱与格局、推导用神，并列出依据的典籍。"
      />
      {/* The step rail and the panel share state, so both live in the client component. */}
      <BaziWorkspace />
    </main>
  );
}
