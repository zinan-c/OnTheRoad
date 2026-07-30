export interface TokenBucketPolicy {
  readonly capacity: number;
  readonly refillPerSecond: number;
}

export interface TokenDecision {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

export interface GeocodingStateStore {
  get(key: string, nowMs: number): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number, nowMs: number): Promise<void>;
  takeToken(
    key: string,
    policy: TokenBucketPolicy,
    nowMs: number,
  ): Promise<TokenDecision>;
}

interface StoredValue {
  value: string;
  expiresAt: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class InMemoryGeocodingStateStore implements GeocodingStateStore {
  readonly #values = new Map<string, StoredValue>();
  readonly #buckets = new Map<string, Bucket>();

  async get(key: string, nowMs: number): Promise<string | null> {
    const stored = this.#values.get(key);
    if (!stored || stored.expiresAt <= nowMs) {
      this.#values.delete(key);
      return null;
    }
    return stored.value;
  }

  async set(key: string, value: string, ttlSeconds: number, nowMs: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    this.#values.set(key, { value, expiresAt: nowMs + ttlSeconds * 1_000 });
  }

  async takeToken(
    key: string,
    policy: TokenBucketPolicy,
    nowMs: number,
  ): Promise<TokenDecision> {
    const previous = this.#buckets.get(key) ?? {
      tokens: policy.capacity,
      updatedAt: nowMs,
    };
    const elapsedSeconds = Math.max(0, nowMs - previous.updatedAt) / 1_000;
    const tokens = Math.min(
      policy.capacity,
      previous.tokens + elapsedSeconds * policy.refillPerSecond,
    );
    if (tokens >= 1) {
      this.#buckets.set(key, { tokens: tokens - 1, updatedAt: nowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    this.#buckets.set(key, { tokens, updatedAt: nowMs });
    return {
      allowed: false,
      retryAfterMs: policy.refillPerSecond > 0
        ? Math.ceil((1 - tokens) / policy.refillPerSecond * 1_000)
        : 60_000,
    };
  }
}

export interface RedisEvalClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
}

const TOKEN_BUCKET_SCRIPT = `
local current = redis.call("HMGET", KEYS[1], "tokens", "updatedAt")
local tokens = tonumber(current[1]) or tonumber(ARGV[1])
local updatedAt = tonumber(current[2]) or tonumber(ARGV[3])
local elapsed = math.max(0, tonumber(ARGV[3]) - updatedAt) / 1000
tokens = math.min(tonumber(ARGV[1]), tokens + elapsed * tonumber(ARGV[2]))
local allowed = 0
if tokens >= 1 then tokens = tokens - 1; allowed = 1 end
redis.call("HMSET", KEYS[1], "tokens", tokens, "updatedAt", ARGV[3])
redis.call("PEXPIRE", KEYS[1], 120000)
return { allowed, tokens }
`;

export class RedisGeocodingStateStore implements GeocodingStateStore {
  constructor(readonly client: RedisEvalClient) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds > 0) await this.client.set(key, value, { EX: ttlSeconds });
  }

  async takeToken(
    key: string,
    policy: TokenBucketPolicy,
    nowMs: number,
  ): Promise<TokenDecision> {
    const result = await this.client.eval(TOKEN_BUCKET_SCRIPT, {
      keys: [key],
      arguments: [
        String(policy.capacity),
        String(policy.refillPerSecond),
        String(nowMs),
      ],
    });
    if (!Array.isArray(result) || result.length < 2) {
      throw new Error("Redis token bucket returned an invalid result");
    }
    const allowed = Number(result[0]) === 1;
    const tokens = Number(result[1]);
    return {
      allowed,
      retryAfterMs: allowed
        ? 0
        : policy.refillPerSecond <= 0
          ? 60_000
        : Math.ceil((1 - tokens) / policy.refillPerSecond * 1_000),
    };
  }
}
