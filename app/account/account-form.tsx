"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthUser } from "@/lib/auth/types";

export default function AccountForm({ initialUser }: { initialUser: AuthUser | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register" | "forgot" | "reset">("login");
  const [user, setUser] = useState(initialUser);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetToken, setResetToken] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error?.message ?? "操作失败"); setBusy(false); return; }
    setUser(payload.result.user);
    setBusy(false);
    window.dispatchEvent(new Event("fortune-auth-changed"));
    router.push("/");
    router.refresh();
  }

  async function requestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const email = new FormData(event.currentTarget).get("email");
    const response = await fetch("/api/auth/forgot-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    const payload = await response.json();
    if (!response.ok) { setError(payload.error?.message ?? "操作失败"); setBusy(false); return; }
    setResetToken(payload.result.debug_token ?? ""); setMode("reset"); setBusy(false);
  }

  async function confirmReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/reset-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: form.get("token"), password: form.get("password") }) });
    if (!response.ok) { const payload = await response.json(); setError(payload.error?.message ?? "操作失败"); setBusy(false); return; }
    setMode("login"); setBusy(false);
  }

  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); setUser(null); window.dispatchEvent(new Event("fortune-auth-changed")); router.push("/"); router.refresh(); }

  if (user) return <section className="page-shell account-shell"><div className="account-card"><p className="kicker">SIGNED IN</p><h2>{user.display_name}</h2><p>{user.email}</p><div className="account-actions"><a className="button button-primary" href="/library">进入我的藏书</a><button className="button" type="button" onClick={logout}>退出登录</button></div></div></section>;

  return <section className="page-shell account-shell"><div className="account-card"><div className="account-tabs"><button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")} type="button">登录</button><button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")} type="button">注册</button></div>{mode === "forgot" ? <form className="account-form" onSubmit={requestReset}><label>注册邮箱<input name="email" type="email" required /></label>{error && <p className="notice" role="alert">{error}</p>}<button className="button button-primary" disabled={busy}>申请重置</button></form> : mode === "reset" ? <form className="account-form" onSubmit={confirmReset}><label>重置令牌<input name="token" value={resetToken} onChange={(event) => setResetToken(event.target.value)} required /></label><label>新密码<input name="password" type="password" minLength={10} required /></label>{error && <p className="notice" role="alert">{error}</p>}<button className="button button-primary" disabled={busy}>更新密码</button></form> : <form className="account-form" onSubmit={submit}>{mode === "register" && <label>显示名称<input name="display_name" required maxLength={80} /></label>}<label>邮箱<input name="email" type="email" autoComplete="email" required /></label><label>密码<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 10 : 1} required /></label>{error && <p className="notice" role="alert">{error}</p>}<button className="button button-primary" disabled={busy}>{busy ? "处理中……" : mode === "login" ? "登录" : "创建账户"}</button>{mode === "login" && <button className="text-link" type="button" onClick={() => setMode("forgot")}>忘记密码</button>}</form>}</div></section>;
}
