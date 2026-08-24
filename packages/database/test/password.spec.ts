import { describe, expect, test } from "vitest";

import { hashPassword, verifyPassword } from "../src/password.js";

describe("local account password hashing", () => {
  test("uses a self-describing scrypt hash and verifies only the original password", async () => {
    const encoded = await hashPassword("Admin_1234");
    expect(encoded).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/u);
    await expect(verifyPassword("Admin_1234", encoded)).resolves.toBe(true);
    await expect(verifyPassword("Admin_12345", encoded)).resolves.toBe(false);
  });

  test("does not accept malformed hashes or short passwords", async () => {
    await expect(hashPassword("short")).rejects.toThrow(/10 characters/u);
    await expect(verifyPassword("Admin_1234", "not-a-password-hash")).resolves.toBe(false);
  });
});
