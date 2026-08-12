import { describe, expect, test } from "vitest";

import { InMemoryExportStageRepository, assertStageTransition } from "../src/export-stage-machine.js";

const base = {
  id: "export-1",
  status: "queued" as const,
  stage: "snapshot" as const,
  version: 1,
  snapshotHash: "a".repeat(64),
  templateVersion: "m4-print-v1",
};

describe("TC-F05-01 worker stage/CAS contract", () => {
  test("allows a queued job to advance once and fences stale writers", async () => {
    const repository = new InMemoryExportStageRepository();
    repository.seed(base);
    const claimed = await repository.claim(base.id, "worker-a", 60_000);
    expect(claimed?.leaseToken).toBeTruthy();
    const advanced = await repository.advance(base.id, "worker-a", claimed!.leaseToken, 1, "queued", "waiting_assets", "assets");
    expect(advanced).toMatchObject({ status: "waiting_assets", version: 2 });
    await expect(repository.advance(base.id, "worker-b", claimed!.leaseToken, 1, "queued", "waiting_assets", "assets")).resolves.toBeNull();
  });

  test("rejects invalid and terminal transitions", () => {
    expect(() => assertStageTransition("queued", "rendering")).not.toThrow();
    expect(() => assertStageTransition("completed", "rendering")).toThrow(/invalid export job transition/iu);
  });
});
