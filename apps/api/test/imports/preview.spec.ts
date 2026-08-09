import { describe, expect, test, vi } from "vitest";

import { ImportPreviewService } from "../../src/modules/imports/preview.mjs";

describe("E2E-020 server import preview", () => {
  test("forwards validated status, query and pagination to the repository", async () => {
    const rows = vi.fn().mockResolvedValue({ rows: [], counts: { total: 0 }, filteredTotal: 0, page: 2, pageSize: 25, totalPages: 1 });
    const service = new ImportPreviewService({ job: vi.fn().mockResolvedValue({ id: "job" }), rows });
    const result = await service.list("owner", "job", { status: "error", query: "  museum  ", page: 2, pageSize: 25 });
    expect(rows).toHaveBeenCalledWith("owner", "job", { status: "error", query: "museum", page: 2, pageSize: 25 });
    expect(result.filteredTotal).toBe(0);
  });

  test("rejects unsupported filters and unsafe page windows", async () => {
    const service = new ImportPreviewService({ job: vi.fn(), rows: vi.fn() });
    await expect(service.list("owner", "job", { status: "pending" })).rejects.toMatchObject({ code: "IMPORT_PREVIEW_STATUS_INVALID" });
    await expect(service.list("owner", "job", { pageSize: 101 })).rejects.toMatchObject({ code: "IMPORT_PREVIEW_PAGE_INVALID" });
  });
});
