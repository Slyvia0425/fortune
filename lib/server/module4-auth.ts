import "server-only";

import { cookies } from "next/headers";
import type { AuthUser } from "@/lib/auth/types";

export const AUTH_COOKIE = "fortune_session";

export function module4BaseUrl() {
  return (process.env.MODULE4_API_BASE_URL ?? process.env.NEXT_PUBLIC_MODULE4_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
}

export async function sessionToken() {
  return (await cookies()).get(AUTH_COOKIE)?.value ?? null;
}

export async function authenticatedFetch(path: string, init: RequestInit = {}) {
  const token = await sessionToken();
  if (!token) return null;
  return fetch(`${module4BaseUrl()}${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
}

export async function currentUser(): Promise<AuthUser | null> {
  try {
    const response = await authenticatedFetch("/api/v1/auth/me");
    if (!response?.ok) return null;
    const payload = await response.json();
    return payload.result ?? null;
  } catch {
    return null;
  }
}
