import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/module4-auth";

import AgentWorkspace from "./agent-workspace";
import "./module4.css";
import { siteLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await siteLocale();
  return { title: translate(locale, "知命智库") };
}

export default async function Page() {
  const user = await currentUser();
  if (!user) redirect("/account");
  return <AgentWorkspace user={user} />;
}
