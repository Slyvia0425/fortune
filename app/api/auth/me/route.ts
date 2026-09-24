import { authenticatedFetch } from "@/lib/server/module4-auth";

export async function GET() {
  try {
    const response = await authenticatedFetch("/api/v1/auth/me");
    if (!response) return Response.json({ result: null, error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
    return new Response(await response.text(), { status: response.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ result: null, error: { code: "AUTH_SERVICE_UNAVAILABLE", message: "账户服务暂不可用" } }, { status: 503 });
  }
}
