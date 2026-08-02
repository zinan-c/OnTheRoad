// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { Gallery, type GalleryAttachment } from "./gallery";

describe("D03 gallery failure states", () => {
  test("shows failed state and retries without rendering a broken image", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const attachment: GalleryAttachment = { id: "failed", status: "failed", caption: "", sortOrder: 0, isCover: false, error: "扫描失败" };
    render(<Gallery attachments={[attachment]} actions={{ retry, updateCaption: vi.fn(), setCover: vi.fn(), remove: vi.fn(), reorder: vi.fn() }} />);
    expect(screen.getByRole("alert").textContent).toContain("扫描失败");
    expect(screen.queryByRole("img")).toBeNull();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(retry).toHaveBeenCalledWith("failed");
  });
});
