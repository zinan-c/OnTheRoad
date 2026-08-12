import { createHash } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import { encryptImportMediaUrl } from "../../src/processors/import/media-url-crypto.js";
import {
  ImportMediaTaskProcessor,
  type ImportMediaTaskClaim,
  type ImportMediaTaskRepository,
} from "../../src/processors/media/import-media-task.js";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const secret = "test-import-media-secret";

function task(overrides: Partial<ImportMediaTaskClaim> = {}): ImportMediaTaskClaim {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    ownerId: "owner-1",
    tripId: "00000000-0000-4000-8000-000000000011",
    importJobId: "00000000-0000-4000-8000-000000000012",
    itineraryItemId: "00000000-0000-4000-8000-000000000013",
    status: "queued",
    version: 1,
    leaseToken: "00000000-0000-4000-8000-000000000014",
    sourceUrlCiphertext: encryptImportMediaUrl("https://images.example.test/a.png", secret).ciphertext,
    sourceUrlKeyVersion: "runtime-v1",
    sourceUrlExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    attemptCount: 1,
    maxAttempts: 4,
    ...overrides,
  };
}

class FakeRepository implements ImportMediaTaskRepository {
  readonly claimValue: ImportMediaTaskClaim | null;
  readonly statuses: string[] = [];
  constructor(claimValue: ImportMediaTaskClaim | null) { this.claimValue = claimValue; }
  async claim(): Promise<ImportMediaTaskClaim | null> { return this.claimValue; }
  async finalizeCancellation(): Promise<boolean> { return false; }
  async advance(_id: string, _lease: string, _version: number, status: string): Promise<boolean> { this.statuses.push(status); return true; }
  async bindAttachment(): Promise<boolean> { this.statuses.push("bound"); return true; }
  async markReady(): Promise<boolean> { this.statuses.push("ready"); return true; }
  async markFailed(_id: string, _lease: string, _version: number, code: string): Promise<boolean> { this.statuses.push(`failed:${code}`); return true; }
  async scheduleRetry(): Promise<boolean> { this.statuses.push("retry_scheduled"); return true; }
  async listRecoverable(): Promise<string[]> { return []; }
  async reconcileParentJob(): Promise<string | null> { return null; }
  async getImportJobId(): Promise<string | null> { return null; }
}

describe("TC-E09-01 approval-to-ready media task", () => {
  test("does not issue a network request until the task is claimable", async () => {
    const request = vi.fn();
    const repository = new FakeRepository(null);
    const processor = new ImportMediaTaskProcessor({
      repository,
      mediaSecret: secret,
      fetch: request,
      storage: { async putQuarantine() { throw new Error("should not store"); } },
      attachments: { async create() { throw new Error("should not attach"); } },
    });
    await expect(processor.process("task-1")).resolves.toBe("not_claimable");
    expect(request).not.toHaveBeenCalled();
  });

  test("approved media passes the fenced processing stages and binds an attachment", async () => {
    const repository = new FakeRepository(task());
    const request = vi.fn(async () => new Response(png, {
      status: 200,
      headers: { "content-type": "image/png", "content-length": String(png.length) },
    }));
    const processor = new ImportMediaTaskProcessor({
      repository,
      mediaSecret: secret,
      fetch: request,
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      storage: {
        async putQuarantine(_ownerId, value, contentType) {
          return {
            key: "attachments/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/quarantine-1",
            version: "v1",
            checksumSha256: createHash("sha256").update(value).digest("base64"),
            contentType,
            contentLength: value.length,
            etag: "etag-1",
          };
        },
      },
      attachments: { async create() { return "00000000-0000-4000-8000-000000000015"; } },
    });
    await expect(processor.process("task-1")).resolves.toBe("ready");
    expect(repository.statuses).toEqual(["quarantined", "scanning", "processing", "bound", "ready"]);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
