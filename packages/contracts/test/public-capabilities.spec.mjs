import assert from "node:assert/strict";
import { test } from "vitest";
import {
  collectOperations,
  readContract,
} from "../../../scripts/generate-client.mjs";
import {
  generatedOperations,
} from "../src/generated/index.mjs";

const REQUIRED_PUBLIC_OPERATIONS = [
  "createDevelopmentSession",
  "beginOidcAuthorization",
  "completeOidcAuthorization",
  "getSession",
  "deleteSession",
  "changeTripDates",
  "searchLocations",
  "confirmLocationCandidate",
  "adjustLocationCoordinates",
  "createAttachmentUploadSession",
  "completeAttachmentUpload",
  "createExpense",
  "getExpenseSummary",
  "setExchangeRate",
  "createImportUpload",
  "queueImportInspection",
  "getJob",
  "getCapabilities",
  "createLocation",
  "listRouteSegments",
  "listItemGallery",
  "reorderItemGallery",
  "updateGalleryAttachment",
  "deleteGalleryAttachment",
  "retryAttachmentProcessing",
  "getImportMapping",
  "saveImportMapping",
  "getLatestImportJob",
  "getImportPreview",
  "skipImportPreviewRows",
];

test("P1-03 OpenAPI covers every M0-M3 public capability and generated operation", async () => {
  const contract = await readContract();
  const operations = collectOperations(contract);

  for (const operationId of REQUIRED_PUBLIC_OPERATIONS) {
    assert.ok(operations[operationId], `${operationId} is absent from OpenAPI`);
    assert.deepEqual(generatedOperations[operationId], operations[operationId]);
  }

  assert.equal(
    Object.values(operations).filter(({ contractTestOnly }) => contractTestOnly).length,
    3,
  );
  assert.equal(operations.getExample.contractTestOnly, true);
  assert.deepEqual(contract.security, [{ sessionCookie: [] }]);
  assert.match(
    contract.components.securitySchemes.sessionCookie.description,
    /ownerId/u,
  );
});

test("P1-03 every public operation documents Problem Details and concurrency headers", async () => {
  const contract = await readContract();
  for (const [path, pathItem] of Object.entries(contract.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      assert.ok(operation.responses.default, `${method.toUpperCase()} ${path} lacks Problem Details`);
    }
  }

  for (const operationId of [
    "createTrip",
    "changeTripDates",
    "createAttachmentUploadSession",
    "completeAttachmentUpload",
    "createExpense",
    "setExchangeRate",
    "createImportUpload",
    "queueImportInspection",
  ]) {
    assert.ok(
      generatedOperations[operationId].parameters.some(
        ({ name }) => name === "Idempotency-Key",
      ),
      `${operationId} lacks Idempotency-Key`,
    );
  }

  for (const operationId of [
    "updateTrip",
    "deleteTrip",
    "restoreTrip",
    "changeTripDates",
    "confirmLocationCandidate",
    "adjustLocationCoordinates",
    "updateItineraryItem",
    "deleteItineraryItem",
  ]) {
    assert.ok(
      generatedOperations[operationId].parameters.some(
        ({ name }) => name === "If-Match",
      ),
      `${operationId} lacks If-Match`,
    );
  }
});
