import {success} from "@/lib/contracts/api";
import {listKnowledgeBooks} from "@/lib/knowledge/library";

export async function GET(){
  const result=listKnowledgeBooks();
  return Response.json(success(result,{system:"knowledge-library-v1",sources:result.groups.flatMap(group=>group.books.map(book=>({source_id:book.representative_source_id,title:book.title}))) }));
}
