import { cookies } from "next/headers";
import { AUTH_COOKIE, module4BaseUrl } from "@/lib/server/module4-auth";
import type { AuthResult } from "@/lib/auth/types";

export async function POST(request: Request) {
  let response: Response;
  try {
    response = await fetch(`${module4BaseUrl()}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await request.text(),
      cache: "no-store",
    });
  } catch {
    return Response.json({ result: null, error: { code: "AUTH_SERVICE_UNAVAILABLE", message: "账户服务暂不可用" } }, { status: 503 });
  }
  const payload = await response.json();
  const result = payload.result as AuthResult | null;
  if (response.ok && result) {
    (await cookies()).set(AUTH_COOKIE, result.session_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(result.expires_at),
    });
    payload.result = { user: result.user, expires_at: result.expires_at };
  }
  return Response.json(payload, { status: response.status });
}
