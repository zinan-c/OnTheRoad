import { describe, expect, test, vi } from "vitest";

import {
  LocationInput,
  renderLocationInput,
} from "../../src/features/locations/location-input.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("TC-C04-02 ambiguous/out-of-order/failure", () => {
  test("ignores an aborted late response and never preselects ambiguous candidates", async () => {
    const first = deferred<{ candidates: Array<Record<string, string>> }>();
    const second = deferred<{ candidates: Array<Record<string, string>> }>();
    const signals: AbortSignal[] = [];
    const search = vi.fn(({ signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return signals.length === 1 ? first.promise : second.promise;
    });
    const input = new LocationInput({
      adapter: {
        capabilities: { autocomplete: false, explicitSearch: true },
        search,
      },
      locationGateway: {},
      context: { tripId: "trip-1" },
      locale: "zh-CN",
    });

    input.setQuery("南京路");
    const oldRequest = input.explicitSearch();
    input.setQuery("南京东路");
    const newRequest = input.explicitSearch();
    expect(signals[0]?.aborted).toBe(true);

    second.resolve({
      candidates: [
        candidate("token-new-1", "南京东路", "上海", "黄浦区"),
        candidate("token-new-2", "南京路", "南京", "鼓楼区"),
      ],
    });
    await newRequest;
    first.resolve({ candidates: [candidate("token-old", "旧结果", "旧城", "旧区")] });
    await oldRequest;

    expect(input.state.candidates.map(({ candidateId }) => candidateId))
      .toEqual(["token-new-1", "token-new-2"]);
    expect(input.state.status).toBe("ambiguous");
    expect(input.state.selectedCandidateId).toBeNull();
    expect(renderLocationInput(input.state)).not.toContain('checked');
  });

  test("zero/error exposes all five recovery actions and signed selection sends no coordinates", async () => {
    const selectCandidate = vi.fn(async () => ({
      id: "location-1",
      status: "resolved",
      version: 3,
    }));
    const saveManual = vi.fn(async (request) => request);
    const saveText = vi.fn(async (request) => request);
    const mapPick = vi.fn();
    const input = new LocationInput({
      adapter: {
        capabilities: { autocomplete: false, explicitSearch: true },
        search: async () => ({ candidates: [] }),
      },
      locationGateway: { selectCandidate, saveManual, saveText },
      context: {
        tripId: "trip-1",
        locationId: "location-1",
        jobId: "job-1",
        expectedVersion: 2,
      },
      locale: "zh-CN",
      onMapPickRequested: mapPick,
    });
    input.setQuery("不存在的地点");
    await input.explicitSearch();

    expect(input.recoveryActions()).toEqual([
      "retry-search",
      "relocate",
      "pick-on-map",
      "manual-coordinates",
      "save-text",
    ]);
    const html = renderLocationInput(input.state);
    for (const label of ["重新搜索", "重新定位", "地图选点", "手工坐标", "暂存文字"]) {
      expect(html).toContain(label);
    }
    input.requestMapPick();
    expect(mapPick).toHaveBeenCalledOnce();
    await input.relocate(async () => ({ latitude: 31.23, longitude: 121.47 }));
    await input.applyMapPoint(31.24, 121.48);
    await input.saveManualCoordinates(31.25, 121.49);
    expect(saveManual.mock.calls.map(([request]) => request.source)).toEqual([
      "device",
      "map",
      "manual",
    ]);
    await input.saveText();
    expect(saveText).toHaveBeenCalledWith(expect.objectContaining({
      inputText: "不存在的地点",
    }));

    input.acceptCandidates([
      candidate("signed.opaque.token", "上海迪士尼乐园", "上海", "浦东新区"),
    ]);
    input.selectCandidate("signed.opaque.token");
    await input.submitSelected();
    expect(selectCandidate).toHaveBeenCalledWith({
      jobId: "job-1",
      candidateToken: "signed.opaque.token",
      expectedVersion: 2,
      confirmation: { label: "上海迪士尼乐园" },
    });
    expect(JSON.stringify(selectCandidate.mock.calls)).not.toMatch(
      /latitude|longitude|providerPlaceId/,
    );
  });

  test("network failure and expired candidate remain recoverable", async () => {
    const input = new LocationInput({
      adapter: {
        capabilities: { autocomplete: false, explicitSearch: true },
        search: async () => {
          throw new Error("network unavailable");
        },
      },
      locationGateway: {
        selectCandidate: async () => {
          throw Object.assign(new Error("expired"), { status: 410 });
        },
      },
      context: {
        tripId: "trip-1",
        locationId: "location-1",
        jobId: "job-1",
        expectedVersion: 2,
      },
      locale: "zh-CN",
    });
    input.setQuery("上海迪士尼");
    await input.explicitSearch();
    expect(input.state).toMatchObject({
      status: "failed",
      error: "network unavailable",
    });
    expect(input.recoveryActions()).toHaveLength(5);

    input.acceptCandidates([
      candidate("expired.signed.token", "上海迪士尼乐园", "上海", "浦东新区"),
    ]);
    input.selectCandidate("expired.signed.token");
    await expect(input.submitSelected()).rejects.toMatchObject({ status: 410 });
    expect(input.state).toMatchObject({
      status: "failed",
      error: "候选已过期，请重新搜索",
      selectedCandidateId: null,
    });
  });
});

function candidate(
  candidateId: string,
  label: string,
  city: string,
  district: string,
) {
  return {
    candidateId,
    label,
    formattedAddress: `${city}${district}${label}`,
    countryCode: "CN",
    city,
    district,
    provider: "fixture",
    attribution: "Fixture Geocoder",
  };
}
