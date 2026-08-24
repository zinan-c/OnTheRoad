"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { getCurrentSession, loginHref, safeReturnTo } from "../../../features/identity/auth-gate";

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";

export function ChangePasswordForm() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void getCurrentSession()
      .then((session) => {
        const returnTo = safeReturnTo(new URL(window.location.href).searchParams.get("returnTo"));
        if (!session) router.replace(loginHref(returnTo));
        else if (!session.account?.mustChangePassword) router.replace(returnTo);
        else setChecking(false);
      })
      .catch(() => router.replace(loginHref("/trips")));
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (password.length < 12) {
      setError("新密码至少需要 12 个字符。");
      return;
    }
    if (password !== confirmation) {
      setError("两次输入的新密码不一致。");
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(API_ORIGIN + "/api/v1/identity/password", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setError("密码修改失败，请检查密码要求后重试。");
        return;
      }
      const returnTo = safeReturnTo(new URL(window.location.href).searchParams.get("returnTo"));
      router.replace(returnTo);
    } catch {
      setError("密码修改服务暂时不可用，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  if (checking) return <p className="status">Checking your session…</p>;
  return (
    <form className="authForm" onSubmit={submit} aria-label="修改密码">
      <label>
        新密码
        <input name="password" type="password" autoComplete="new-password" required minLength={12} />
      </label>
      <label>
        确认新密码
        <input name="confirmation" type="password" autoComplete="new-password" required minLength={12} />
      </label>
      <p className="formHint">首次登录必须设置一个新的管理员密码，至少 12 个字符。</p>
      {error ? <p className="formError" role="alert">{error}</p> : null}
      <button className="primary formSubmit" type="submit" disabled={pending}>
        {pending ? "保存中…" : "保存新密码"}
      </button>
    </form>
  );
}
