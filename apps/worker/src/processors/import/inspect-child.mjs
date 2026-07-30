import { parentPort, workerData } from "node:worker_threads";

const { inspectWorkbook } = await import(
  "@on-the-road/importer/workbook-inspector"
);

if (!parentPort) throw new Error("Workbook inspect child requires a parent port.");

try {
  const result = inspectWorkbook(Buffer.from(workerData.body), workerData.options);
  parentPort.postMessage({ ok: true, result });
} catch (error) {
  const details = error && typeof error === "object"
    ? /** @type {Record<string, unknown>} */ (error)
    : {};
  parentPort.postMessage({
    ok: false,
    error: {
      code: typeof details.code === "string"
        ? details.code
        : "WORKBOOK_INSPECT_INTERNAL",
      message: error instanceof Error ? error.message : "Workbook inspection failed.",
      retryable: details.retryable === true,
    },
  });
}
