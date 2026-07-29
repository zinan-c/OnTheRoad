import { expect, test } from "vitest";

import { startNativeMinio } from "./native-minio.js";

test("reports a missing native MinIO binary without an unhandled process error", async () => {
  await expect(startNativeMinio({
    minioBin: "/missing/otr-ci-minio",
    mcBin: "/missing/otr-ci-mc",
  })).rejects.toThrow(/Native MinIO failed to start.*ENOENT/u);
});
