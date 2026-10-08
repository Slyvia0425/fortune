import type {Metadata} from "next";
import KnowledgeCentre from "./knowledge-centre";
export const metadata:Metadata={title:"知识图谱与学习中心",description:"检索古籍、理解术语、比较注家观点，并沿概念关系追溯来源。"};
export default function Page(){return <main className="knowledge-page"><KnowledgeCentre/></main>}
