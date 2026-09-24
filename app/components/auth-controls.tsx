"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AuthUser } from "@/lib/auth/types";

export default function AuthControls() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    function refreshUser() {
      fetch("/api/auth/me", { cache: "no-store" })
        .then(async (response) => response.ok ? (await response.json()).result as AuthUser : null)
        .then(setUser)
        .catch(() => setUser(null));
    }
    refreshUser();
    window.addEventListener("fortune-auth-changed", refreshUser);
    return () => window.removeEventListener("fortune-auth-changed", refreshUser);
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    window.dispatchEvent(new Event("fortune-auth-changed"));
    router.push("/");
    router.refresh();
  }

  if (user === undefined) return <span className="auth-loading" aria-label="正在读取登录状态" />;
  if (!user) return <Link className="auth-link" href="/account">登录</Link>;
  return <div className="auth-user"><Link href="/account">{user.display_name}</Link><button type="button" onClick={logout}>退出</button></div>;
}
