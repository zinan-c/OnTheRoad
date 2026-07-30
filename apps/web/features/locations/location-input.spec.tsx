import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  LocationInput,
  renderLocationInput,
} from "../../src/features/locations/location-input.js";

const shanghaiCandidates = [
  {
    candidateId: "signed.shanghai.1",
    label: "上海迪士尼乐园",
    formattedAddress: "中国上海市浦东新区川沙新镇黄赵路 310 号",
    countryCode: "CN",
    city: "上海",
    district: "浦东新区",
    provider: "fixture",
    attribution: "Fixture Geocoder",
  },
  {
    candidateId: "signed.hongkong.2",
    label: "香港迪士尼乐园",
    formattedAddress: "香港特别行政区大屿山",
    countryCode: "HK",
    city: "香港",
    district: "离岛区",
    provider: "fixture",
    attribution: "Fixture Geocoder",
  },
];

describe("TC-C04-01 debounced candidate UX", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("debounces Chinese/English autocomplete for 400ms and renders geographic context", async () => {
    const search = vi.fn(async () => ({ candidates: shanghaiCandidates }));
    const input = new LocationInput({
      adapter: {
        capabilities: { autocomplete: true, explicitSearch: true },
        search,
      },
      locationGateway: {},
      context: { tripId: "trip-1", city: "上海", countryCode: "CN" },
      locale: "zh-CN",
    });

    input.setQuery("上");
    await vi.advanceTimersByTimeAsync(500);
    expect(search).not.toHaveBeenCalled();

    input.setQuery("上海迪士尼");
    await vi.advanceTimersByTimeAsync(399);
    expect(search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      trigger: "autocomplete",
      query: "上海迪士尼",
      locale: "zh-CN",
      context: { tripId: "trip-1", city: "上海", countryCode: "CN" },
      signal: expect.any(AbortSignal),
    }));
    await Promise.resolve();

    const html = renderLocationInput(input.state);
    expect(html).toContain("中国上海市浦东新区");
    expect(html).toContain("上海 · 浦东新区 · CN");
    expect(html).toContain("香港 · 离岛区 · HK");
    expect(html).toContain("Fixture Geocoder");
    expect(html).not.toContain('checked');

    input.setQuery("Shanghai Disney Resort");
    await vi.advanceTimersByTimeAsync(400);
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({
      query: "Shanghai Disney Resort",
      trigger: "autocomplete",
    }));
  });

  test("capability=false suppresses autocomplete and keeps explicit search available", async () => {
    const search = vi.fn(async () => ({ candidates: shanghaiCandidates }));
    const input = new LocationInput({
      adapter: {
        capabilities: { autocomplete: false, explicitSearch: true },
        search,
      },
      locationGateway: {},
      context: { tripId: "trip-1" },
      locale: "en",
    });
    input.setQuery("Shanghai Disney");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(search).not.toHaveBeenCalled();
    expect(input.state.status).toBe("explicit-ready");

    await input.explicitSearch();
    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      trigger: "explicit",
      query: "Shanghai Disney",
    }));
  });
});
