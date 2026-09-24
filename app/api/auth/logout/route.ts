import { cookies } from "next/headers";
import { AUTH_COOKIE, authenticatedFetch } from "@/lib/server/module4-auth";

export async function POST() {
  try {
    await authenticatedFetch("/api/v1/auth/logout", { method: "POST" });
  } finally {
    (await cookies()).delete(AUTH_COOKIE);
  }
  return new Response(null, { status: 204 });
}
