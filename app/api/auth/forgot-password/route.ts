import { module4BaseUrl } from "@/lib/server/module4-auth";

export async function POST(request: Request) {
  try {
    const response = await fetch(`${module4BaseUrl()}/api/v1/auth/forgot-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await request.text(),
      cache: "no-store",
    });
    return new Response(await response.text(), { status: response.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ result: null, error: { code: "AUTH_SERVICE_UNAVAILABLE", message: "账户服务暂不可用" } }, { status: 503 });
  }
}
