import type { Metadata } from "next";
import AccountForm from "./account-form";
import { currentUser } from "@/lib/server/module4-auth";

export const metadata: Metadata = { title: "账户" };

export default async function AccountPage() {
  const user = await currentUser();
  return <main className="subpage"><section className="page-hero"><div className="page-shell"><p className="kicker">GLOBAL ACCOUNT</p><h1 className="page-title">统一账户</h1><p>一个账户管理问卦、排盘、灵签、收藏和个人知识记录。</p></div></section><AccountForm initialUser={user} /></main>;
}
