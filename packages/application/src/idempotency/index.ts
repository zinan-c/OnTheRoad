import { createHash } from "node:crypto";

export type IdempotentResponse = Readonly<{
  status: number;
  body: unknown;
}>;

type StoredRequest =
  | { state: "running"; requestHash: string; result: Promise<IdempotentResponse> }
  | { state: "completed"; requestHash: string; response: IdempotentResponse };

export class IdempotencyConflictError extends Error {
  readonly status = 409;
  readonly code = "IDEMPOTENCY_KEY_REUSED";

  constructor() {
    super("The idempotency key was already used with a different request.");
    this.name = "IdempotencyConflictError";
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function hashIdempotentRequest(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

export class InMemoryIdempotencyRepository {
  readonly #requests = new Map<string, StoredRequest>();

  get(ownerId: string, key: string): StoredRequest | undefined {
    return this.#requests.get(this.#key(ownerId, key));
  }

  setRunning(
    ownerId: string,
    key: string,
    requestHash: string,
    result: Promise<IdempotentResponse>,
  ): void {
    this.#requests.set(this.#key(ownerId, key), { state: "running", requestHash, result });
  }

  complete(
    ownerId: string,
    key: string,
    requestHash: string,
    response: IdempotentResponse,
  ): void {
    this.#requests.set(this.#key(ownerId, key), {
      state: "completed",
      requestHash,
      response,
    });
  }

  delete(ownerId: string, key: string): void {
    this.#requests.delete(this.#key(ownerId, key));
  }

  #key(ownerId: string, key: string): string {
    return `${ownerId}\u0000${key}`;
  }
}

export class IdempotencyService {
  constructor(private readonly repository: InMemoryIdempotencyRepository) {}

  async execute(
    ownerId: string,
    key: string,
    body: unknown,
    action: () => Promise<IdempotentResponse>,
  ): Promise<IdempotentResponse> {
    if (ownerId.length === 0 || key.length === 0) {
      throw new TypeError("Owner and idempotency key are required");
    }
    const requestHash = hashIdempotentRequest(body);
    const existing = this.repository.get(ownerId, key);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new IdempotencyConflictError();
      return existing.state === "completed" ? existing.response : existing.result;
    }

    const result = action();
    this.repository.setRunning(ownerId, key, requestHash, result);
    try {
      const response = await result;
      this.repository.complete(ownerId, key, requestHash, response);
      return response;
    } catch (error) {
      this.repository.delete(ownerId, key);
      throw error;
    }
  }
}
