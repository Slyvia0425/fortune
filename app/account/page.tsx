import type { Metadata } from "next";
import AccountForm from "./account-form";
import Trans from "../components/trans";
import { currentUser } from "@/lib/server/module4-auth";
import { siteLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await siteLocale();
  return { title: translate(locale, "账户") };
}

export default async function AccountPage() {
  const user = await currentUser();
  return <main className="subpage"><section className="page-hero"><div className="page-shell"><p className="kicker">GLOBAL ACCOUNT</p><h1 className="page-title"><Trans zh="统一账户" /></h1><p><Trans zh="一个账户管理问卦、排盘、灵签、收藏和个人知识记录。" /></p></div></section><AccountForm initialUser={user} /></main>;
}
