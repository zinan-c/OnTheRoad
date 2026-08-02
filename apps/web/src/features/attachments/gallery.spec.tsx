// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { Gallery, attachmentAspectRatio, type GalleryAttachment } from "./gallery";

const ready: GalleryAttachment = { id: "a", status: "ready", previewUrl: "/a.jpg", width: 1200, height: 800, caption: "上海", sortOrder: 0, isCover: true };

describe("D03 gallery", () => {
  test("renders proportional preview, caption, cover and lightbox", async () => {
    const user = userEvent.setup();
    const actions = { retry: vi.fn(), updateCaption: vi.fn(), setCover: vi.fn(), remove: vi.fn(), reorder: vi.fn() };
    render(<Gallery attachments={[ready]} actions={actions} />);
    expect(attachmentAspectRatio(ready)).toBe("1200 / 800");
    await user.click(screen.getByRole("button", { name: "上海" }));
    expect(screen.getByRole("dialog", { name: "图片灯箱" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "设为封面" }));
    expect(actions.setCover).toHaveBeenCalledWith("a");
  });
});
