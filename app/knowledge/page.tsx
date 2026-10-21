import type {Metadata} from "next";
import KnowledgeCentre from "./knowledge-centre";
import { siteLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
export async function generateMetadata():Promise<Metadata>{const locale=await siteLocale();return{title:translate(locale,"知识图谱与学习中心"),description:translate(locale,"检索古籍、理解术语、比较注家观点，并沿概念关系追溯来源。")};}
export default function Page(){return <main className="knowledge-page"><KnowledgeCentre/></main>}
