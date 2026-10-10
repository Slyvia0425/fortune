import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/module4-auth";

import AgentWorkspace from "./agent-workspace";
import "./module4.css";

export const metadata: Metadata = { title: "知命智库" };

export default async function Page() {
  const user = await currentUser();
  if (!user) redirect("/account");
  return <AgentWorkspace user={user} />;
}
