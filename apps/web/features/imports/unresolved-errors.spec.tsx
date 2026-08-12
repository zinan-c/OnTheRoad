// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { UnresolvedLocations } from "../../src/features/imports/unresolved/unresolved-locations";

const location = {
  id: "staging-1",
  tripId: "trip-1",
  importJobId: "job-1",
  importRowId: "row-1",
  sourceRowKey: "Sheet 1:2",
  status: "staged" as const,
  version: 1,
  inputText: "人民广场",
  candidates: [{
    label: "人民广场",
    formattedAddress: "上海市黄浦区人民广场",
    point: { longitude: 121.4737, latitude: 31.2304, crs: "WGS84" as const },
    city: "上海",
    district: "黄浦区",
    provider: "fixture",
    attribution: "On The Road fixture",
    candidateToken: "signed-candidate",
  }],
  selectedPoint: null,
  selectedType: null,
  errors: [],
};

describe("TC-E07-02 unresolved location review", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  test("shows candidates and sends a staged candidate decision", async () => {
    const user = userEvent.setup();
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(init ?? {});
      if (init?.method === "POST") return Response.json({ status: "ready" });
      return Response.json([location]);
    }));
    render(<UnresolvedLocations jobId="job-1" />);
    await screen.findByRole("radio");
    await user.click(screen.getByRole("radio"));
    await waitFor(() => expect(calls.some((init) => init.method === "POST"
      && JSON.parse(String(init.body)).candidateToken === "signed-candidate")).toBe(true));
  });

  test("offers map point, manual coordinate and text-only decisions", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? Response.json({ status: "ready" })
      : Response.json([{ ...location, candidates: [] }])),
    );
    render(<UnresolvedLocations jobId="job-1" />);
    await screen.findByText("没有候选结果，请在地图上选点或填写坐标。");
    await user.type(screen.getByLabelText("纬度"), "31.2304");
    await user.type(screen.getByLabelText("经度"), "121.4737");
    expect((screen.getByRole("button", { name: "地图点" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "手工坐标" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "仅接受文本" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
