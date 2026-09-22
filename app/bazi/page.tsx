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
        description="输入出生时间与地点，按真太阳时、节气边界与干支规则建立结构化命盘，并为每一步保留可追溯的典籍依据。"
      />
      {/* The step rail and the panel share state, so both live in the client component. */}
      <BaziWorkspace />
    </main>
  );
}
