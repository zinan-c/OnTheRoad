import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import { encryptImportMediaUrl } from "../../../apps/worker/src/processors/import/media-url-crypto.js";
import {
  ImportMediaTaskProcessor,
  type ImportMediaTaskClaim,
  type ImportMediaTaskRepository,
} from "../../../apps/worker/src/processors/media/import-media-task.js";
import { fetchExternalMedia } from "../../../packages/storage/src/ssrf-safe-fetch.js";

const secret = "m4-media-secret-long";
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

type MutableImportMediaTaskClaim = {
  -readonly [Key in keyof ImportMediaTaskClaim]: ImportMediaTaskClaim[Key];
};

type MediaState = MutableImportMediaTaskClaim & {
  leaseExpiresAt: number;
  retryGeneration: number;
  errorCode?: string;
  attachmentId?: string;
};

class MediaRaceRepository implements ImportMediaTaskRepository {
  readonly tasks = new Map<string, MediaState>();
  readonly attachments: string[] = [];
  readonly parents = new Map<string, string>();
  readonly transitions: Array<{ id: string; status: string }> = [];
  #leaseSequence = 0;

  add(input: Readonly<{
    id: string;
    jobId: string;
    status: string;
    url?: string;
    itemId?: string;
  }>): void {
    const encrypted = encryptImportMediaUrl(input.url ?? "https://images.example.test/a.png", secret);
    this.tasks.set(input.id, {
      id: input.id,
      ownerId: "m4-media-owner",
      tripId: "00000000-0000-4000-8000-000000000501",
      importJobId: input.jobId,
      itineraryItemId: input.itemId ?? "item-media",
      status: input.status,
      version: 1,
      leaseToken: "lease-seed",
      sourceUrlCiphertext: encrypted.ciphertext,
      sourceUrlKeyVersion: "runtime-v1",
      sourceUrlExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      attemptCount: 0,
      maxAttempts: 3,
      leaseExpiresAt: 0,
      retryGeneration: 0,
    });
  }

  get(id: string): MediaState {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`missing task ${id}`);
    return task;
  }

  expire(id: string): void {
    this.get(id).leaseExpiresAt = 0;
  }

  cancel(id: string): void {
    const task = this.get(id);
    task.status = "cancelling";
    task.version += 1;
  }

  resume(id: string): void {
    const task = this.get(id);
    task.status = "approved";
    task.version += 1;
    task.retryGeneration += 1;
    task.attemptCount = 0;
  }

  async finalizeCancellation(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task || task.status !== "cancelling") return false;
    task.status = "cancelled";
    task.version += 1;
    this.transitions.push({ id, status: "cancelled" });
    return true;
  }

  async claim(id: string, workerId: string, leaseMs: number): Promise<ImportMediaTaskClaim | null> {
    const task = this.tasks.get(id);
    if (!task) return null;
    const claimable = ["approved", "queued", "retry_scheduled"].includes(task.status)
      || (["fetching", "quarantined", "scanning", "processing"].includes(task.status) && task.leaseExpiresAt <= Date.now());
    if (!claimable) return null;
    task.status = "fetching";
    task.version += 1;
    task.attemptCount += 1;
    task.leaseToken = `${workerId}:${++this.#leaseSequence}`;
    task.leaseExpiresAt = Date.now() + leaseMs;
    this.transitions.push({ id, status: "fetching" });
    return { ...task };
  }

  async advance(id: string, leaseToken: string, expectedVersion: number, status: string): Promise<boolean> {
    const task = this.get(id);
    if (!this.owns(task, leaseToken, expectedVersion)) return false;
    task.status = status;
    task.version += 1;
    this.transitions.push({ id, status });
    return true;
  }

  async bindAttachment(id: string, leaseToken: string, expectedVersion: number, attachmentId: string): Promise<boolean> {
    const task = this.get(id);
    if (!this.owns(task, leaseToken, expectedVersion)) return false;
    task.attachmentId = attachmentId;
    task.version += 1;
    this.transitions.push({ id, status: "bound" });
    return true;
  }

  async markReady(id: string, leaseToken: string, expectedVersion: number, attachmentId: string): Promise<boolean> {
    const task = this.get(id);
    if (!this.owns(task, leaseToken, expectedVersion)) return false;
    task.attachmentId = attachmentId;
    task.status = "ready";
    task.version += 1;
    task.leaseToken = "";
    task.leaseExpiresAt = 0;
    this.transitions.push({ id, status: "ready" });
    return true;
  }

  async markFailed(id: string, leaseToken: string, expectedVersion: number, code: string): Promise<boolean> {
    const task = this.get(id);
    if (!this.owns(task, leaseToken, expectedVersion)) return false;
    task.status = "failed";
    task.errorCode = code;
    task.version += 1;
    task.leaseToken = "";
    task.leaseExpiresAt = 0;
    this.transitions.push({ id, status: `failed:${code}` });
    return true;
  }

  async scheduleRetry(id: string, leaseToken: string, expectedVersion: number, code: string): Promise<boolean> {
    const task = this.get(id);
    if (!this.owns(task, leaseToken, expectedVersion)) return false;
    task.status = "retry_scheduled";
    task.errorCode = code;
    task.retryGeneration += 1;
    task.version += 1;
    task.leaseToken = "";
    task.leaseExpiresAt = 0;
    this.transitions.push({ id, status: "retry_scheduled" });
    return true;
  }

  async listRecoverable(): Promise<string[]> {
    return [...this.tasks.values()]
      .filter((task) => ["approved", "queued", "retry_scheduled", "cancelling"].includes(task.status)
        || (["fetching", "quarantined", "scanning", "processing"].includes(task.status) && task.leaseExpiresAt <= Date.now()))
      .map(({ id }) => id);
  }

  async reconcileParentJob(jobId: string): Promise<string | null> {
    const tasks = [...this.tasks.values()].filter((task) => task.importJobId === jobId);
    const pending = tasks.filter((task) => !["ready", "failed", "rejected", "cancelled"].includes(task.status));
    const failed = tasks.filter((task) => ["failed", "rejected"].includes(task.status));
    const current = this.parents.get(jobId) ?? "processing_media";
    const next = pending.length > 0
      ? current
      : current === "cancelling" ? "cancelled" : failed.length > 0 ? "completed_with_warnings" : "completed";
    this.parents.set(jobId, next);
    return next;
  }

  async getImportJobId(id: string): Promise<string | null> {
    return this.tasks.get(id)?.importJobId ?? null;
  }

  private owns(task: MediaState, leaseToken: string, expectedVersion: number): boolean {
    return task.leaseToken === leaseToken
      && task.version === expectedVersion
      && task.leaseExpiresAt > Date.now()
      && ["fetching", "quarantined", "scanning", "processing"].includes(task.status);
  }
}

function processor(
  repository: MediaRaceRepository,
  workerId: string,
  fetch: typeof globalThis.fetch,
  lookup: NonNullable<ConstructorParameters<typeof ImportMediaTaskProcessor>[0]>["lookup"] = publicLookup,
): ImportMediaTaskProcessor {
  return new ImportMediaTaskProcessor({
    repository,
    workerId,
    mediaSecret: secret,
    fetch,
    lookup,
    storage: {
      async putQuarantine(_ownerId, body, contentType) {
        return {
          key: `quarantine/${body.byteLength}`,
          version: "q1",
          checksumSha256: createHash("sha256").update(body).digest("hex"),
          contentType,
          contentLength: body.byteLength,
          etag: "etag-q1",
        };
      },
    },
    attachments: {
      async create(input) {
        const id = `attachment-${repository.attachments.length + 1}`;
        repository.attachments.push(id);
        return id;
      },
    },
  });
}

function imageResponse(): Response {
  return new Response(png, {
    status: 200,
    headers: { "content-type": "image/png", "content-length": String(png.length) },
  });
}

describe("TC-M4-INT-02 import concurrency/media recovery", () => {
  test("fences concurrent and expired leases, recovers after queue loss, and aggregates parent state", async () => {
    const repository = new MediaRaceRepository();
    repository.add({ id: "concurrent", jobId: "job-concurrent", status: "queued" });
    repository.parents.set("job-concurrent", "processing_media");
    const request = async () => imageResponse();
    const outcomes = await Promise.all([
      processor(repository, "worker-a", request).process("concurrent"),
      processor(repository, "worker-b", request).process("concurrent"),
    ]);
    expect(outcomes.sort()).toEqual(["not_claimable", "ready"]);
    expect(repository.attachments).toHaveLength(1);
    expect(repository.get("concurrent").status).toBe("ready");

    let releaseOld!: () => void;
    const oldRelease = new Promise<void>((resolve) => { releaseOld = resolve; });
    let oldRequestStarted!: () => void;
    const oldRequestReady = new Promise<void>((resolve) => { oldRequestStarted = resolve; });
    const oldFetch = async () => {
      oldRequestStarted();
      await oldRelease;
      return imageResponse();
    };
    repository.add({ id: "lease-aba", jobId: "job-media", status: "queued" });
    const oldProcess = processor(repository, "old-worker", oldFetch).process("lease-aba");
    await oldRequestReady;
    repository.expire("lease-aba");
    const newProcess = processor(repository, "restarted-worker", request).process("lease-aba");
    await expect(newProcess).resolves.toBe("ready");
    releaseOld();
    await expect(oldProcess).resolves.toBe("fenced");
    expect(repository.attachments).toHaveLength(2);

    repository.add({ id: "redis-recovery", jobId: "job-media", status: "retry_scheduled" });
    repository.add({
      id: "failed-ssrf",
      jobId: "job-media",
      status: "queued",
      url: "https://metadata.example.test/secret.png",
    });
    repository.parents.set("job-media", "processing_media");
    expect(await repository.listRecoverable()).toContain("redis-recovery");
    await expect(processor(repository, "recovery-worker", request).process("redis-recovery")).resolves.toBe("ready");
    await expect(processor(
      repository,
      "failed-worker",
      request,
      async () => [{ address: "169.254.169.254", family: 4 }],
    ).process("failed-ssrf")).resolves.toBe("failed");
    expect(await repository.reconcileParentJob("job-media")).toBe("completed_with_warnings");

    repository.add({ id: "cancel-resume", jobId: "job-media", status: "approved" });
    repository.cancel("cancel-resume");
    await expect(processor(repository, "cancel-worker", request).process("cancel-resume")).resolves.toBe("cancelled");
    repository.resume("cancel-resume");
    const retryGeneration = repository.get("cancel-resume").retryGeneration;
    await expect(processor(repository, "resume-worker", request).process("cancel-resume")).resolves.toBe("ready");
    expect(repository.get("cancel-resume").retryGeneration).toBe(retryGeneration);
    expect(repository.get("cancel-resume").status).toBe("ready");
    expect(repository.transitions.filter(({ id, status }) => id === "cancel-resume" && status === "ready")).toHaveLength(1);
  });

  test("blocks private-address SSRF before the request boundary", async () => {
    let requests = 0;
    await expect(fetchExternalMedia("https://images.example.test/a.png", {
      lookup: async () => [{ address: "169.254.169.254", family: 4 }],
      fetch: async () => {
        requests += 1;
        return imageResponse();
      },
    })).rejects.toMatchObject({ code: "MEDIA_URL_PRIVATE_ADDRESS" });
    expect(requests).toBe(0);
  });
});
