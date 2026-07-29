// @ts-nocheck
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class RedisCliJobQueue {
  constructor({
    redisUrl,
    namespace = "otr:jobs",
    redisCliBin = process.env.REDIS_CLI_BIN || "redis-cli",
  }) {
    if (!redisUrl) throw new TypeError("redisUrl is required");
    this.redisUrl = new URL(redisUrl);
    this.redisCliBin = redisCliBin;
    this.idsKey = `${namespace}:ids`;
    this.eventsKey = `${namespace}:events`;
  }

  async has(eventId) {
    return (await this.#run(["SISMEMBER", this.idsKey, eventId])) === "1";
  }

  async add(event) {
    await this.#run([
      "EVAL",
      "if redis.call('SADD', KEYS[1], ARGV[1]) == 1 then return redis.call('RPUSH', KEYS[2], ARGV[2]) else return 0 end",
      "2",
      this.idsKey,
      this.eventsKey,
      event.eventId,
      JSON.stringify(event),
    ]);
  }

  async events() {
    const output = await this.#run(["LRANGE", this.eventsKey, "0", "-1"]);
    return output ? output.split("\n").map((value) => JSON.parse(value)) : [];
  }

  async clear() {
    await this.#run(["DEL", this.idsKey, this.eventsKey]);
  }

  async #run(command) {
    const database = this.redisUrl.pathname.replace(/^\//u, "") || "0";
    const connection = [
      "-h",
      this.redisUrl.hostname,
      "-p",
      this.redisUrl.port || "6379",
      ...(this.redisUrl.password
        ? ["-a", decodeURIComponent(this.redisUrl.password)]
        : []),
      "-n",
      database,
    ];
    const { stdout } = await execFileAsync(
      this.redisCliBin,
      [...connection, "--no-auth-warning", "--raw", ...command],
      { maxBuffer: 2 * 1024 * 1024 },
    );
    const output = stdout.trim();
    if (/^(?:NOAUTH|WRONGPASS|ERR)\b/u.test(output)) {
      throw new Error(`Redis command failed: ${output}`);
    }
    return output;
  }
}
