"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";

export type CurrentSession = {
  readonly principal: { readonly id: string };
  readonly account?: {
    readonly username: string;
    readonly role: string;
    readonly mustChangePassword: boolean;
  };
};

export async function getCurrentSession(): Promise<CurrentSession | null> {
  const response = await fetch(API_ORIGIN + "/api/v1/identity/session", {
    cache: "no-store",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Session request failed: " + response.status);
  return response.json() as Promise<CurrentSession>;
}

export function safeReturnTo(value: string | null | undefined, fallback = "/trips"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

export function loginHref(returnTo: string): string {
  return "/login?returnTo=" + encodeURIComponent(safeReturnTo(returnTo));
}

export function AuthGate({ children }: { readonly children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<"loading" | "ready">("loading");

  useEffect(() => {
    let active = true;
    void getCurrentSession()
      .then((session) => {
        if (!active) return;
        const returnTo = pathname + window.location.search;
        if (!session) {
          router.replace(loginHref(returnTo));
          return;
        }
        if (session.account?.mustChangePassword) {
          router.replace("/account/change-password?returnTo=" + encodeURIComponent(safeReturnTo(returnTo)));
          return;
        }
        setState("ready");
      })
      .catch(() => {
        if (active) router.replace(loginHref(pathname + window.location.search));
      });
    return () => {
      active = false;
    };
  }, [pathname, router]);

  if (state !== "ready") return <p className="status">Checking your session…</p>;
  return children;
}
