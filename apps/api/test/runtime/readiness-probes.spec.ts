import { describe, expect, test, vi } from "vitest";

import { storageReachable } from "../../src/runtime.js";

describe("storage readiness probe", () => {
  test("uses the MinIO readiness endpoint instead of the unauthenticated root", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await expect(storageReachable(
      new URL("http://127.0.0.1:19000"),
      request,
    )).resolves.toBe(true);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0].toString()).toBe(
      "http://127.0.0.1:19000/minio/health/ready",
    );
  });

  test("fails closed for unhealthy responses and connection errors", async () => {
    const unavailable = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 503 }),
    );
    const disconnected = vi.fn<typeof fetch>().mockRejectedValue(
      new Error("connection refused"),
    );

    await expect(storageReachable(
      new URL("http://127.0.0.1:19000"),
      unavailable,
    )).resolves.toBe(false);
    await expect(storageReachable(
      new URL("http://127.0.0.1:19000"),
      disconnected,
    )).resolves.toBe(false);
  });
});
