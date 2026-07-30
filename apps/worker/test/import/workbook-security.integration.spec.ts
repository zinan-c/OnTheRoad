import { createHash } from "node:crypto";

import { describe, expect, test, vi } from "vitest";
import * as XLSX from "../../../../packages/importer/vendor/xlsx/xlsx.mjs";

import {
  WorkbookInspectError,
  inspectWorkbook,
} from "../../../../packages/importer/src/workbook-inspector.mjs";
import {
  ImportInspectProcessor,
  InMemoryImportInspectRepository,
} from "../../src/processors/import/inspect.js";
import { IsolatedWorkbookInspector } from "../../src/processors/import/isolated-inspector.js";
import { WorkbookSourceScanProcessor } from "../../src/processors/import/source-scan.js";

describe("TC-E02-02 malicious and limit matrix", () => {
  test.each([
    ["empty", Buffer.alloc(0), "empty.xlsx", "WORKBOOK_EMPTY"],
    ["encrypted container", cfbMagic(), "secret.xlsx", "WORKBOOK_ENCRYPTED"],
    ["bad magic", Buffer.from("not a workbook"), "bad.xlsx", "WORKBOOK_MAGIC_MISMATCH"],
    ["macro", validWorkbook(), "macro.xlsm", "WORKBOOK_MACRO_UNSUPPORTED"],
    ["corrupt zip", Buffer.from("PK\u0003\u0004broken"), "broken.xlsx", "WORKBOOK_CORRUPT"],
  ])("rejects %s with a permanent explanatory code", (
    _case,
    body,
    filename,
    code,
  ) => {
    expect(() => inspectWorkbook(body, { filename })).toThrow(
      expect.objectContaining({ code, retryable: false }),
    );
  });

  test("enforces bytes, rows, cells and ZIP expansion before unbounded work", () => {
    expect(() => inspectWorkbook(Buffer.alloc(11, 0x61), {
      filename: "rows.csv",
      limits: { maximumBytes: 10 },
    })).toThrow(expect.objectContaining({ code: "WORKBOOK_SIZE_LIMIT" }));

    const csv = Buffer.from("A,B\n1,2\n3,4\n");
    expect(() => inspectWorkbook(csv, {
      filename: "rows.csv",
      limits: { maximumRows: 1 },
    })).toThrow(expect.objectContaining({ code: "WORKBOOK_ROW_LIMIT" }));
    expect(() => inspectWorkbook(csv, {
      filename: "rows.csv",
      limits: { maximumCells: 3 },
    })).toThrow(expect.objectContaining({ code: "WORKBOOK_CELL_LIMIT" }));
    expect(() => inspectWorkbook(validWorkbook(), {
      filename: "trip.xlsx",
      limits: { maximumCompressionRatio: 1 },
    })).toThrow(expect.objectContaining({ code: "WORKBOOK_ZIP_RATIO_LIMIT" }));
  });

  test("never evaluates formulas and exposes them only as inert text", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["Target"], ["safe"]]);
    sheet.A2 = { t: "n", f: "1+1", v: 2 };
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    const body = Buffer.from(XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    }));
    expect(inspectWorkbook(body, { filename: "formula.xlsx" })
      .sheets[0]?.samples[0]?.Target).toBe("=1+1");
  });

  test("requires ready immutable attachment and does not retry permanent failures", async () => {
    const repository = new InMemoryImportInspectRepository({
      attachments: [{
        id: "attachment-1",
        ownerId: "owner-1",
        status: "uploaded",
        filename: "trip.xlsx",
        objectKey: "quarantine/source",
        objectVersion: "v1",
        checksumSha256: "checksum",
        contentLength: validWorkbook().byteLength,
        version: 1,
      }],
      jobs: [{
        id: "job-1",
        ownerId: "owner-1",
        attachmentId: "attachment-1",
        status: "queued",
        attempts: 0,
      }],
    });
    const read = vi.fn(async () => validWorkbook());
    const processor = new ImportInspectProcessor({
      repository,
      storage: { readImmutable: read },
      inspect: vi.fn(inspectWorkbook),
    });

    await expect(processor.process("job-1")).rejects.toMatchObject({
      code: "ATTACHMENT_NOT_READY",
      retryable: false,
    });
    expect(read).not.toHaveBeenCalled();
    expect(repository.getJob("job-1")).toMatchObject({
      status: "failed",
      errorCode: "ATTACHMENT_NOT_READY",
      retryable: false,
      attempts: 1,
    });
  });

  test("parses in a resource-limited isolate and terminates a timed-out isolate", async () => {
    const isolated = new IsolatedWorkbookInspector({ timeoutMs: 5_000 });
    await expect(isolated.inspect(validWorkbook(), {
      filename: "isolated.xlsx",
    })).resolves.toMatchObject({
      format: "xlsx",
      sheets: [expect.objectContaining({ columns: ["Day", "Target"] })],
    });

    const neverResponds = new IsolatedWorkbookInspector({
      timeoutMs: 5,
      workerFactory: () => ({
        once: () => {},
        terminate: vi.fn(async () => 1),
      }),
    });
    await expect(neverResponds.inspect(validWorkbook(), {
      filename: "timeout.xlsx",
    })).rejects.toMatchObject({
      code: "WORKBOOK_INSPECT_TIMEOUT",
      retryable: false,
    });
  });

  test("scanner failure is fail-closed and cannot produce ready evidence", async () => {
    const body = validWorkbook();
    const markAttachmentFailed = vi.fn(async () => ({
      id: "attachment-1",
      ownerId: "owner-1",
      status: "failed" as const,
      filename: "trip.xlsx",
      version: 3,
    }));
    const recordCleanScan = vi.fn();
    const processor = new WorkbookSourceScanProcessor({
      repository: {
        getAttachment: async () => ({
          id: "attachment-1",
          ownerId: "owner-1",
          status: "uploaded",
          filename: "trip.xlsx",
          objectKey: "imports/source",
          objectVersion: "v1",
          checksumSha256: createHash("sha256").update(body).digest("base64"),
          contentLength: body.byteLength,
          version: 2,
        }),
        recordCleanScan,
        markAttachmentFailed,
      },
      storage: { readImmutable: async () => body },
      scanner: {
        name: "clamav",
        scan: async () => {
          throw new Error("scanner down");
        },
      },
    });

    await expect(processor.process("attachment-1")).rejects.toMatchObject({
      code: "WORKBOOK_SCANNER_UNAVAILABLE",
      retryable: true,
    });
    expect(markAttachmentFailed).toHaveBeenCalledWith(
      "attachment-1",
      "WORKBOOK_SCANNER_UNAVAILABLE",
    );
    expect(recordCleanScan).not.toHaveBeenCalled();
  });
});

function validWorkbook(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Day", "Target"],
    [1, "外滩"],
  ]), "Sheet1");
  return Buffer.from(XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
  }));
}

function cfbMagic(): Buffer {
  return Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

void WorkbookInspectError;
