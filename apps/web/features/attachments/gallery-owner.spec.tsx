// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { TripGalleryWorkspace } from "../../src/features/attachments/trip-gallery";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("E2E-018 Gallery Item ownership", () => {
  test("loads and uploads against the Item selected by the user", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      requests.push(String(input));
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }));
    render(<TripGalleryWorkspace tripId="trip-18" items={[
      { id: "item-day", target: "白天景点", dayNumber: 1 },
      { id: "item-hotel", target: "夜宿酒店", dayNumber: 1 },
    ]} />);

    await waitFor(() => expect(requests.at(-1)).toContain("/item-day/gallery"));
    await userEvent.setup().selectOptions(screen.getByLabelText("图片归属 Item"), "item-hotel");
    await waitFor(() => expect(requests.at(-1)).toContain("/item-hotel/gallery"));
    expect(screen.getByRole("option", { name: "Day 1 · 夜宿酒店" })).toBeTruthy();
  });
});
