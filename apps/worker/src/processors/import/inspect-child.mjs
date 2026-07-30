// @ts-nocheck -- isolated child errors cross a structured-clone boundary.
import { parentPort, workerData } from "node:worker_threads";

const inspectorUrl = new URL(
  "../../../../../packages/importer/src/workbook-inspector.mjs",
  import.meta.url,
);
const { inspectWorkbook } = await import(inspectorUrl.href);

if (!parentPort) throw new Error("Workbook inspect child requires a parent port.");

try {
  const result = inspectWorkbook(Buffer.from(workerData.body), workerData.options);
  parentPort.postMessage({ ok: true, result });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: {
      code: error?.code ?? "WORKBOOK_INSPECT_INTERNAL",
      message: error instanceof Error ? error.message : "Workbook inspection failed.",
      retryable: error?.retryable === true,
    },
  });
}
