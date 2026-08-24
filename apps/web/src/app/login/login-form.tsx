"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { safeReturnTo } from "../../features/identity/auth-gate";

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const username = String(data.get("username") ?? "");
    const password = String(data.get("password") ?? "");
    const returnTo = safeReturnTo(new URL(window.location.href).searchParams.get("returnTo"));
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(API_ORIGIN + "/api/v1/identity/password-session", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        setError("用户名或密码错误，或账号暂时不可用。");
        return;
      }
      const result = await response.json() as { mustChangePassword?: boolean };
      if (result.mustChangePassword) {
        router.replace("/account/change-password?returnTo=" + encodeURIComponent(returnTo));
      } else {
        router.replace(returnTo);
      }
    } catch {
      setError("登录服务暂时不可用，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="authForm" onSubmit={submit} aria-label="登录">
      <label>
        用户名
        <input name="username" autoComplete="username" required autoFocus />
      </label>
      <label>
        密码
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {error ? <p className="formError" role="alert">{error}</p> : null}
      <button className="primary formSubmit" type="submit" disabled={pending}>
        {pending ? "登录中…" : "登录"}
      </button>
    </form>
  );
}
