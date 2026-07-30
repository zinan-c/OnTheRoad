import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";
import * as XLSX from "../../../packages/importer/vendor/xlsx/xlsx.mjs";

import {
  ImportAuditStore,
  ImportUploadService,
} from "../../api/src/modules/imports/upload.mjs";
import { inspectWorkbook } from "../../../packages/importer/src/workbook-inspector.mjs";
import { ImportInspectProcessor } from "../../worker/src/processors/import/inspect.js";
import { IsolatedWorkbookInspector } from "../../worker/src/processors/import/isolated-inspector.js";
import { WorkbookSourceScanProcessor } from "../../worker/src/processors/import/source-scan.js";

describe("TC-E02-03 upload to inspect", () => {
  test.each([
    ["trip.xlsx", xlsxBody(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["trip.xls", xlsBody(), "application/vnd.ms-excel"],
    ["trip.csv", Buffer.from("\uFEFFDay,Target\n1,外滩\n"), "text/csv"],
  ])("uploads, passes ready gate and restores %s inspection after refresh", async (
    filename,
    body,
    contentType,
  ) => {
    const store = new ImportAuditStore();
    const ids = sequenceIds();
    const firstSession = new ImportUploadService({ store, idFactory: ids });
    const attachment = firstSession.createUpload({
      ownerId: "owner-1",
      filename,
      contentType,
      contentLength: body.byteLength,
      checksumSha256: checksum(body),
    });
    expect(attachment.status).toBe("pending");
    expect(() => firstSession.queueInspection({
      ownerId: "owner-1",
      attachmentId: attachment.id,
    })).toThrow(expect.objectContaining({ code: "ATTACHMENT_NOT_READY" }));

    store.upload(attachment.id, body);
    const scanProcessor = cleanScanProcessor(store);
    await expect(scanProcessor.process(attachment.id)).resolves.toMatchObject({
      status: "ready",
      scanEngine: "fixture-clamav",
    });
    const queued = firstSession.queueInspection({
      ownerId: "owner-1",
      attachmentId: attachment.id,
    });
    expect(queued.status).toBe("queued");

    const isolated = new IsolatedWorkbookInspector({ timeoutMs: 5_000 });
    const processor = new ImportInspectProcessor({
      repository: store,
      storage: store,
      inspect: isolated.inspect.bind(isolated),
    });
    await expect(processor.process(queued.id)).resolves.toMatchObject({
      status: "succeeded",
      inspection: {
        sheets: [expect.objectContaining({
          columns: ["Day", "Target"],
          rowCount: 1,
        })],
      },
    });

    const refreshed = new ImportUploadService({ store, idFactory: ids });
    const restored = refreshed.getJob({
      ownerId: "owner-1",
      jobId: queued.id,
    });
    expect(restored.status).toBe("succeeded");
    expect(restored.inspection.sheets[0].samples[0]).toMatchObject({
      Day: filename.endsWith(".csv") ? "1" : 1,
      Target: "外滩",
    });
    expect(restored).not.toHaveProperty("staging");
    expect(restored).not.toHaveProperty("normalizedRows");
  });

  test("persists an explanatory permanent error for refresh", async () => {
    const body = Buffer.from("PK\u0003\u0004broken");
    const store = new ImportAuditStore();
    const ids = sequenceIds();
    const service = new ImportUploadService({ store, idFactory: ids });
    const attachment = service.createUpload({
      ownerId: "owner-1",
      filename: "broken.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      contentLength: body.byteLength,
      checksumSha256: checksum(body),
    });
    store.upload(attachment.id, body);
    await cleanScanProcessor(store).process(attachment.id);
    const job = service.queueInspection({
      ownerId: "owner-1",
      attachmentId: attachment.id,
    });
    const processor = new ImportInspectProcessor({
      repository: store,
      storage: store,
      inspect: inspectWorkbook,
    });
    await expect(processor.process(job.id)).rejects.toMatchObject({
      code: "WORKBOOK_CORRUPT",
      retryable: false,
    });
    expect(service.getJob({ ownerId: "owner-1", jobId: job.id })).toMatchObject({
      status: "failed",
      errorCode: "WORKBOOK_CORRUPT",
      retryable: false,
      attempts: 1,
    });
  });
});

function xlsxBody(): Buffer {
  return workbookBody("xlsx");
}

function xlsBody(): Buffer {
  return workbookBody("xls");
}

function workbookBody(bookType: "xlsx" | "xls"): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Day", "Target"],
    [1, "外滩"],
  ]), "行程");
  return Buffer.from(XLSX.write(workbook, {
    type: "buffer",
    bookType,
    ...(bookType === "xlsx" ? { compression: true } : {}),
  }));
}

function checksum(body: Buffer): string {
  return createHash("sha256").update(body).digest("base64");
}

function sequenceIds(): () => string {
  let value = 0;
  return () => `import-${++value}`;
}

function cleanScanProcessor(store: ImportAuditStore): WorkbookSourceScanProcessor {
  return new WorkbookSourceScanProcessor({
    repository: store,
    storage: store,
    scanner: {
      name: "fixture-clamav",
      scan: async () => ({ clean: true }),
    },
    now: () => new Date("2026-07-30T00:00:00.000Z"),
  });
}
