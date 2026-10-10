import { failure } from "@/lib/contracts/api";
import { authenticatedFetch } from "@/lib/server/module4-auth";

export async function POST(request: Request) {
  let response: Response | null;
  try {
    response = await authenticatedFetch("/api/user/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await request.text(),
    });
  } catch {
    return failure(
      "user-notes-v1",
      "PRIVATE_DATA_SERVICE_UNAVAILABLE",
      "个人笔记服务暂不可用。",
      undefined,
      503,
    );
  }
  if (!response) {
    return failure("user-notes-v1", "UNAUTHORIZED", "请先登录后再保存笔记。", undefined, 401);
  }
  return new Response(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}
