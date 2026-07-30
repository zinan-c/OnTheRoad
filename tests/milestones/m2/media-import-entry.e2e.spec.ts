import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";
import * as XLSX from "../../../packages/importer/vendor/xlsx/xlsx.mjs";

import { downloadStandardTemplate } from "../../../apps/api/src/modules/imports/template.mjs";
import {
  ImportAuditStore,
  ImportUploadService,
} from "../../../apps/api/src/modules/imports/upload.mjs";
import {
  ImportInspectProcessor,
} from "../../../apps/worker/src/processors/import/inspect.js";
import {
  IsolatedWorkbookInspector,
} from "../../../apps/worker/src/processors/import/isolated-inspector.js";
import {
  WorkbookSourceScanProcessor,
} from "../../../apps/worker/src/processors/import/source-scan.js";
import {
  InMemoryMediaRepository,
  InMemoryMediaStorage,
  MediaPipeline,
} from "../../../apps/worker/src/processors/media/media-pipeline.js";
import { minimalFiveDay } from "../../../packages/test-fixtures/src/trips/minimal-five-day.mjs";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const EICAR = Buffer.from(
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
  "ascii",
);

describe("TC-M2-INT-03 safe media and import entry", () => {
  test("keeps malicious uploads closed and inspects three real formats without importing Items", async () => {
    expect(minimalFiveDay.fixtureVersion).toBe("minimal-five-day@1");
    expect(minimalFiveDay.trip.days).toHaveLength(5);
    const formalItems = minimalFiveDay.trip.days.flatMap(({ items }) =>
      items.map(({ id, title }) => ({ id, title })));
    const formalItemsBefore = structuredClone(formalItems);

    const mediaAttachment = {
      id: "m2-benign-image",
      ownerId: "m2-empty-account",
      objectKey: "quarantine/m2-benign-image",
      objectVersion: "immutable-v1",
      checksumSha256: checksum(PNG),
      contentType: "image/png",
      contentLength: PNG.byteLength,
      status: "uploaded" as const,
      version: 2,
    };
    const mediaRepository = new InMemoryMediaRepository([mediaAttachment]);
    const mediaStorage = new InMemoryMediaStorage();
    mediaStorage.seedQuarantine(
      mediaAttachment.objectKey,
      mediaAttachment.objectVersion,
      PNG,
    );
    const media = new MediaPipeline({
      repository: mediaRepository,
      storage: mediaStorage,
      scanner: { scan: async () => ({ clean: true }) },
      imageProcessor: {
        process: async () => ({
          detectedContentType: "image/png",
          width: 1,
          height: 1,
          thumbnail: PNG,
          thumbnailContentType: "image/png",
        }),
      },
      keyFactory: () => "m2-thumb",
    });
    await expect(media.process(mediaAttachment.id)).resolves.toMatchObject({
      status: "ready",
      objectVersion: "immutable-v1",
      width: 1,
      height: 1,
    });
    expect(mediaStorage.publicKeys()).toEqual([
      "derived/m2-benign-image/m2-thumb",
    ]);

    const threatStore = new ImportAuditStore();
    const threatService = new ImportUploadService({
      store: threatStore,
      idFactory: sequenceIds("threat"),
    });
    const threat = threatService.createUpload({
      ownerId: "m2-empty-account",
      filename: "threat.csv",
      contentType: "text/csv",
      contentLength: EICAR.byteLength,
      checksumSha256: checksum(EICAR),
    });
    threatStore.upload(threat.id, EICAR);
    const threatScan = new WorkbookSourceScanProcessor({
      repository: threatStore,
      storage: threatStore,
      scanner: {
        name: "gate-clamav",
        scan: async (body) => body.equals(EICAR)
          ? { clean: false, signature: "Eicar-Signature" }
          : { clean: true },
      },
    });
    await expect(threatScan.process(threat.id)).rejects.toMatchObject({
      code: "WORKBOOK_MALWARE_DETECTED",
      retryable: false,
    });
    expect(threatStore.getAttachment(threat.id)).toMatchObject({
      status: "failed",
      processingErrorCode: "WORKBOOK_MALWARE_DETECTED",
    });
    expect(() => threatService.queueInspection({
      ownerId: "m2-empty-account",
      attachmentId: threat.id,
    })).toThrow(expect.objectContaining({ code: "ATTACHMENT_NOT_READY" }));

    const template = downloadStandardTemplate();
    expect(template).toMatchObject({
      status: 200,
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
    const sources = [
      {
        filename: "five-day.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        body: Buffer.from(template.body),
      },
      {
        filename: "five-day.xls",
        contentType: "application/vnd.ms-excel",
        body: workbook("xls"),
      },
      {
        filename: "five-day.csv",
        contentType: "text/csv",
        body: Buffer.from(
          "\uFEFFDay,Date,Target\n1,2026-10-01,上海抵达\n5,2026-10-05,返程\n",
          "utf8",
        ),
      },
    ];
    const isolate = new IsolatedWorkbookInspector({ timeoutMs: 5_000 });

    for (const [index, source] of sources.entries()) {
      const store = new ImportAuditStore();
      expect(() => store.getJob("missing")).toThrow(
        expect.objectContaining({ code: "IMPORT_INSPECT_JOB_NOT_FOUND" }),
      );
      const service = new ImportUploadService({
        store,
        idFactory: sequenceIds(`format-${index}`),
      });
      const attachment = service.createUpload({
        ownerId: "m2-empty-account",
        filename: source.filename,
        contentType: source.contentType,
        contentLength: source.body.byteLength,
        checksumSha256: checksum(source.body),
      });
      store.upload(attachment.id, source.body);
      await new WorkbookSourceScanProcessor({
        repository: store,
        storage: store,
        scanner: {
          name: "gate-clamav",
          scan: async () => ({ clean: true }),
        },
        now: () => new Date("2026-07-30T00:00:00.000Z"),
      }).process(attachment.id);
      const job = service.queueInspection({
        ownerId: "m2-empty-account",
        attachmentId: attachment.id,
      });
      const processor = new ImportInspectProcessor({
        repository: store,
        storage: store,
        inspect: isolate.inspect.bind(isolate),
      });
      await processor.process(job.id);

      const refreshed = new ImportUploadService({
        store,
        idFactory: sequenceIds("refresh"),
      }).getJob({ ownerId: "m2-empty-account", jobId: job.id });
      expect(refreshed).toMatchObject({
        status: "succeeded",
        attempts: 1,
        inspection: {
          format: source.filename.split(".").at(-1),
          sheets: expect.arrayContaining([
            expect.objectContaining({
              columns: expect.arrayContaining(["Day"]),
              rowCount: expect.any(Number),
            }),
          ]),
        },
      });
      expect(refreshed).not.toHaveProperty("staging");
      expect(refreshed).not.toHaveProperty("normalizedRows");
    }

    expect(formalItems).toEqual(formalItemsBefore);
  }, 30_000);
});

function checksum(body: Buffer): string {
  return createHash("sha256").update(body).digest("base64");
}

function sequenceIds(prefix: string): () => string {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

function workbook(bookType: "xls"): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Day", "Date", "Target"],
    [1, "2026-10-01", "上海抵达"],
    [5, "2026-10-05", "返程"],
  ]), "Itinerary");
  return Buffer.from(XLSX.write(book, { type: "buffer", bookType }));
}
