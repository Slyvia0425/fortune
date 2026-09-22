import { failure, success } from "@/lib/contracts/api";
import { searchUnifiedAgentData } from "@/lib/agent/catalog";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (!query) {
    return failure("agent-search-v1", "VALIDATION_ERROR", "请输入检索词 q。");
  }

  const result = await searchUnifiedAgentData(query);
  return Response.json(
    success(result, {
      system: "agent-search-v1",
      sources: result.map((item) => ({
        source_id: item.source_id ?? item.id,
        title: item.title,
        url: item.url ?? undefined,
      })),
    }),
  );
}
