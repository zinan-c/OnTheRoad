import { expect, test } from "vitest";

import {
  resolveNativeTestBinary,
  startNativeMinio,
} from "./native-minio.js";

test("treats blank optional binary paths as unset", () => {
  expect(resolveNativeTestBinary(undefined, "", "minio")).toBe("minio");
  expect(resolveNativeTestBinary("", "  ", "mc")).toBe("mc");
  expect(resolveNativeTestBinary("/custom/minio", "", "minio")).toBe(
    "/custom/minio",
  );
});

test("reports a missing native MinIO binary without an unhandled process error", async () => {
  await expect(startNativeMinio({
    minioBin: "/missing/otr-ci-minio",
    mcBin: "/missing/otr-ci-mc",
  })).rejects.toThrow(/Native MinIO failed to start.*ENOENT/u);
});
