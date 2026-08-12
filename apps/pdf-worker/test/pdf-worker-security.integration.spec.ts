import { describe, expect, test } from "vitest";

import { PrintResourceBarrierError, waitForPrintResources } from "../src/resource-barrier.js";

describe("TC-F05-02 resource timeout/cancel contract", () => {
  test("times out without a false ready signal", async () => {
    await expect(waitForPrintResources({
      fontsReady: () => false,
      imagesReady: () => true,
      mapsReady: () => true,
    }, { timeoutMs: 5, pollMs: 1 })).rejects.toMatchObject({ code: "PDF_RESOURCE_TIMEOUT" });
  });

  test("honors cancellation while resources are pending", async () => {
    const controller = new AbortController();
    const promise = waitForPrintResources({
      fontsReady: () => false,
      imagesReady: () => false,
      mapsReady: () => false,
    }, { timeoutMs: 1_000, pollMs: 2, signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(PrintResourceBarrierError);
    await expect(promise).rejects.toMatchObject({ code: "PDF_RENDER_CANCELLED" });
  });
});
