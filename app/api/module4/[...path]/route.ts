import { authenticatedFetch } from "@/lib/server/module4-auth";

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const sourceUrl = new URL(request.url);
  const target = `/api/v1/${path.map(encodeURIComponent).join("/")}${sourceUrl.search}`;
  let response: Response | null;
  try {
    response = await authenticatedFetch(target, {
      method: request.method,
      headers: request.headers.get("content-type") ? { "content-type": request.headers.get("content-type")! } : {},
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
    });
  } catch {
    return Response.json({ result: null, error: { code: "PRIVATE_DATA_SERVICE_UNAVAILABLE", message: "个人数据服务暂不可用" } }, { status: 503 });
  }
  if (!response) return Response.json({ result: null, error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
  return new Response(response.status === 204 ? null : await response.text(), {
    status: response.status,
    headers: response.status === 204 ? undefined : { "content-type": "application/json" },
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
