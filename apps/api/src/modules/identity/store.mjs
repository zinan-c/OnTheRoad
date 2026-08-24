export class MemoryIdentityStore {
  #sessions = new Map();
  #transactions = new Map();

  /** @param {string} id @param {Record<string, unknown>} value */
  async putSession(id, value) {
    this.#sessions.set(id, value);
  }

  /** @param {string} id */
  async getSession(id) {
    return this.#sessions.get(id) ?? null;
  }

  /** @param {string} id */
  async deleteSession(id) {
    this.#sessions.delete(id);
  }

  /** @param {string} principalId @param {string} [exceptSessionId] */
  async deleteSessionsForPrincipal(principalId, exceptSessionId) {
    for (const [id, value] of this.#sessions) {
      if (id !== exceptSessionId && value?.principal?.id === principalId) {
        this.#sessions.delete(id);
      }
    }
  }

  /** @param {string} id @param {Record<string, unknown>} value */
  async putTransaction(id, value) {
    this.#transactions.set(id, value);
  }

  /** @param {string} id */
  async consumeTransaction(id) {
    const value = this.#transactions.get(id) ?? null;
    this.#transactions.delete(id);
    return value;
  }
}

export class RedisIdentityStore {
  /**
   * @param {{set: Function, get: Function, del: Function, getdel: Function, sadd?: Function, smembers?: Function, srem?: Function, expire?: Function, status?: string, connect?: Function}} redis
   * @param {{namespace?: string}} [options]
   */
  constructor(redis, { namespace = "otr:identity" } = {}) {
    this.redis = redis;
    this.namespace = namespace;
    /** @type {Promise<unknown> | null} */
    this.connecting = null;
  }

  /** @param {string} id @param {Record<string, unknown>} value @param {number} ttlMs */
  async putSession(id, value, ttlMs) {
    await this.#ready();
    await this.redis.set(this.#key("session", id), JSON.stringify(value), "PX", ttlMs);
    const principalId = sessionPrincipalId(value);
    if (principalId && this.redis.sadd) {
      await this.redis.sadd(this.#key("principal-sessions", principalId), id);
      if (this.redis.expire) await this.redis.expire(this.#key("principal-sessions", principalId), Math.ceil(ttlMs / 1000));
    }
  }

  /** @param {string} id */
  async getSession(id) {
    await this.#ready();
    return parseStored(await this.redis.get(this.#key("session", id)));
  }

  /** @param {string} id */
  async deleteSession(id) {
    await this.#ready();
    const session = parseStored(await this.redis.get(this.#key("session", id)));
    await this.redis.del(this.#key("session", id));
    const principalId = sessionPrincipalId(session);
    if (principalId && this.redis.srem) {
      await this.redis.srem(this.#key("principal-sessions", principalId), id);
    }
  }

  /** @param {string} principalId @param {string} [exceptSessionId] */
  async deleteSessionsForPrincipal(principalId, exceptSessionId) {
    await this.#ready();
    if (!this.redis.smembers || !this.redis.srem) return;
    const indexKey = this.#key("principal-sessions", principalId);
    const ids = await this.redis.smembers(indexKey);
    for (const id of ids ?? []) {
      if (id === exceptSessionId) continue;
      await this.redis.del(this.#key("session", id));
      await this.redis.srem(indexKey, id);
    }
  }

  /** @param {string} id @param {Record<string, unknown>} value @param {number} ttlMs */
  async putTransaction(id, value, ttlMs) {
    await this.#ready();
    await this.redis.set(this.#key("transaction", id), JSON.stringify(value), "PX", ttlMs);
  }

  /** @param {string} id */
  async consumeTransaction(id) {
    await this.#ready();
    return parseStored(await this.redis.getdel(this.#key("transaction", id)));
  }

  /** @param {string} kind @param {string} id */
  #key(kind, id) {
    return `${this.namespace}:${kind}:${id}`;
  }

  async #ready() {
    if (this.redis.status !== "wait" || !this.redis.connect) return;
    this.connecting ??= Promise.resolve(this.redis.connect())
      .finally(() => {
        this.connecting = null;
      });
    await this.connecting;
  }
}

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function parseStored(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** @param {Record<string, unknown> | null} value */
function sessionPrincipalId(value) {
  const principal = value?.principal;
  return principal && typeof principal === "object" && "id" in principal && typeof principal.id === "string"
    ? principal.id
    : null;
}
