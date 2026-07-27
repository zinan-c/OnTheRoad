import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import {
  generatedOpenApiSha256,
  parseExampleResponse,
} from "../src/generated/index.mjs";
import { generateClientSource, readContract } from "../../../scripts/generate-client.mjs";

test("TC-A04-01 OpenAPI generation is deterministic and covers shared conventions", async () => {
  const contract = await readContract();
  const committed = await readFile(
    new URL("../src/generated/index.mjs", import.meta.url),
    "utf8",
  );

  assert.equal(committed, generateClientSource(contract));
  assert.match(generatedOpenApiSha256, /^[a-f0-9]{64}$/u);

  const schemas = contract.components.schemas;
  assert.equal(schemas.ResourceId.format, "uuid");
  assert.equal(schemas.LocalDate.format, "date");
  assert.deepEqual(schemas.CursorPage.required, ["items", "nextCursor"]);
  assert.equal(contract.components.headers.ETag.schema.type, "string");
  assert.equal(contract.components.parameters.IdempotencyKey.name, "Idempotency-Key");
  assert.equal(parseExampleResponse({ id: randomUUID(), date: "2026-07-27" }).date, "2026-07-27");
});
