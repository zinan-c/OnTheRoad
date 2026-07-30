import { Worker } from "node:worker_threads";

import type { WorkbookInspection } from "./inspect.js";

type WorkerLike = {
  once: (event: string, listener: (...arguments_: any[]) => void) => void;
  terminate: () => Promise<number>;
};

type IsolatedInspectorOptions = {
  timeoutMs?: number;
  maximumOldGenerationSizeMb?: number;
  maximumYoungGenerationSizeMb?: number;
  workerFactory?: (options: ConstructorParameters<typeof Worker>[1]) => WorkerLike;
};

export class IsolatedInspectError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "IsolatedInspectError";
    this.code = code;
    this.retryable = retryable;
  }
}

export class IsolatedWorkbookInspector {
  readonly #timeoutMs: number;
  readonly #maximumOldGenerationSizeMb: number;
  readonly #maximumYoungGenerationSizeMb: number;
  readonly #workerFactory: NonNullable<IsolatedInspectorOptions["workerFactory"]>;

  constructor(options: IsolatedInspectorOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#maximumOldGenerationSizeMb =
      options.maximumOldGenerationSizeMb ?? 96;
    this.#maximumYoungGenerationSizeMb =
      options.maximumYoungGenerationSizeMb ?? 16;
    this.#workerFactory = options.workerFactory ?? ((workerOptions) =>
      new Worker(
        new URL("./inspect-child.mjs", import.meta.url),
        workerOptions,
      ));
  }

  inspect(
    body: Buffer,
    options: { filename: string },
  ): Promise<WorkbookInspection> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const worker = this.#workerFactory({
        workerData: {
          body: Buffer.from(body),
          options,
        },
        resourceLimits: {
          maxOldGenerationSizeMb: this.#maximumOldGenerationSizeMb,
          maxYoungGenerationSizeMb: this.#maximumYoungGenerationSizeMb,
          stackSizeMb: 4,
        },
      });
      const finish = (
        callback: () => void,
      ): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        void worker.terminate();
        callback();
      };
      const timeout = setTimeout(() => finish(() => reject(
        new IsolatedInspectError(
          "WORKBOOK_INSPECT_TIMEOUT",
          "Workbook inspection exceeded its isolated time limit.",
        ),
      )), this.#timeoutMs);

      worker.once("message", (message: unknown) => finish(() => {
        if (isSuccessMessage(message)) {
          resolve(message.result);
          return;
        }
        reject(errorFromMessage(message));
      }));
      worker.once("error", (error: Error) => finish(() => reject(
        new IsolatedInspectError(
          "WORKBOOK_INSPECT_ISOLATE_FAILURE",
          "Workbook inspection isolate failed.",
          true,
        ),
      )));
      worker.once("exit", (code: number) => {
        if (code === 0 || settled) return;
        finish(() => reject(new IsolatedInspectError(
          "WORKBOOK_INSPECT_RESOURCE_LIMIT",
          "Workbook inspection isolate exceeded a resource limit.",
        )));
      });
    });
  }
}

function isSuccessMessage(value: unknown): value is {
  ok: true;
  result: WorkbookInspection;
} {
  return Boolean(value && typeof value === "object" && "ok" in value && value.ok === true);
}

function errorFromMessage(value: unknown): IsolatedInspectError {
  if (
    value
    && typeof value === "object"
    && "error" in value
    && value.error
    && typeof value.error === "object"
  ) {
    const error = value.error as Record<string, unknown>;
    return new IsolatedInspectError(
      typeof error.code === "string" ? error.code : "WORKBOOK_INSPECT_INTERNAL",
      typeof error.message === "string" ? error.message : "Workbook inspection failed.",
      error.retryable === true,
    );
  }
  return new IsolatedInspectError(
    "WORKBOOK_INSPECT_INTERNAL",
    "Workbook inspection returned an invalid result.",
    true,
  );
}
