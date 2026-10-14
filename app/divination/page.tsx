import type { Metadata } from "next";
import PageHeading from "../components/page-heading";
import Trans from "../components/trans";
import DivinationChatbot from "./divination-chatbot";
import { siteLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await siteLocale();
  return { title: translate(locale, "智能占卜") };
}

export default function Page() {
  return (
    <main className="subpage">
      <PageHeading
        eyebrow="易卦推演"
        title="一问一卦，察其变化"
        description="通过对话说明问题、时间范围和起卦数字。卦象由确定性规则生成，解释与古籍依据分层呈现。"
      />
      <div className="page-shell workspace">
        <aside className="side-steps">
          <span className="active"><Trans zh="01　明确所问" /></span>
          <span><Trans zh="02　补充起卦数字" /></span>
          <span><Trans zh="03　查看卦变" /></span>
          <span><Trans zh="04　阅读依据" /></span>
        </aside>
        <div className="divination-tools">
          <DivinationChatbot />
        </div>
      </div>
    </main>
  );
}
