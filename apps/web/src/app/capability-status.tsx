"use client";

import { OnTheRoadClient } from "@on-the-road/contracts";
import { useEffect, useState } from "react";

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly imports: boolean; readonly geocoding: boolean }
  | { readonly kind: "error" };

export function CapabilityStatus() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const baseUrl = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";
    const client = new OnTheRoadClient(baseUrl);
    void (async () => {
      for (const delayMs of [0, 200, 500]) {
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        if (cancelled) return;
        try {
          const { data } = await client.request("getCapabilities");
          if (cancelled) return;
          const capabilities = data as { imports?: boolean; geocoding?: boolean };
          setState({
            kind: "ready",
            imports: capabilities.imports === true,
            geocoding: capabilities.geocoding === true,
          });
          return;
        } catch {
          // Startup races and transient provider failures receive bounded retries.
        }
      }
      if (!cancelled) setState({ kind: "error" });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") {
    return <p className="status" aria-live="polite">正在连接旅行服务…</p>;
  }
  if (state.kind === "error") {
    return (
      <p className="status statusError" role="alert">
        暂时无法连接 API。你的本地内容不会因此丢失。
      </p>
    );
  }
  return (
    <p className="status statusReady" aria-live="polite">
      服务已就绪 · 地点搜索 {state.geocoding ? "可用" : "降级"} · Excel{" "}
      {state.imports ? "可用" : "维护中"}
    </p>
  );
}
