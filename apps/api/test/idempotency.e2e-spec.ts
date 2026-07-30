import { describe, expect, test } from "vitest";

import {
  IdempotencyConflictError,
  InMemoryIdempotencyRepository,
  IdempotencyService,
} from "@on-the-road/application/idempotency";

describe("TC-A06-03 HTTP idempotency integration", () => {
  test("same key and body replays the original response without rerunning the action", async () => {
    const service = new IdempotencyService(new InMemoryIdempotencyRepository());
    let calls = 0;
    const action = async () => {
      calls += 1;
      return { status: 201, body: { id: "trip-01" } };
    };

    const first = await service.execute("owner-01", "create-trip-01", { name: "Shanghai" }, action);
    const replay = await service.execute("owner-01", "create-trip-01", { name: "Shanghai" }, action);

    expect(replay).toEqual(first);
    expect(calls).toBe(1);
  });

  test("same owner/key with a different request hash returns a conflict", async () => {
    const service = new IdempotencyService(new InMemoryIdempotencyRepository());
    await service.execute(
      "owner-01",
      "create-trip-01",
      { name: "Shanghai" },
      async () => ({ status: 201, body: { id: "trip-01" } }),
    );

    await expect(
      service.execute(
        "owner-01",
        "create-trip-01",
        { name: "Ningbo" },
        async () => ({ status: 201, body: { id: "trip-02" } }),
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});
