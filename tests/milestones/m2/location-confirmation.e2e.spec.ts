// @ts-nocheck
import { describe, expect, test, vi } from "vitest";

import { LocationCoordinatesApi } from "../../../apps/api/src/modules/locations/coordinates.js";
import { LocationService } from "../../../apps/api/src/modules/locations/service.mjs";
import { LocationInput } from "../../../apps/web/src/features/locations/location-input.js";
import { buildMapModel } from "../../../apps/web/src/features/map/map-model.js";
import { LocationPicker } from "../../../apps/web/src/features/map/location-picker.js";
import {
  CoordinateAdjustmentService,
  InMemoryCoordinateRepository,
} from "../../../packages/application/src/location/adjust-coordinates.js";
import {
  assertLocationTransition,
  CandidateTokenSigner,
} from "../../../packages/domain/src/location/index.mjs";
import { createHereGeocoder } from "../../../packages/providers/src/geocoding/here.js";
import { minimalFiveDay } from "../../../packages/test-fixtures/src/trips/minimal-five-day.mjs";

class GateLocationRepository {
  locations = new Map();
  jobs = new Map();
  nextLocation = 1;
  nextJob = 1;

  create(input) {
    const location = {
      id: `gate-location-${this.nextLocation++}`,
      ownerId: input.ownerId,
      tripId: input.tripId,
      inputText: input.inputText,
      name: input.name,
      formattedAddress: null,
      countryCode: null,
      city: null,
      district: null,
      point: null,
      provider: null,
      providerPlaceId: null,
      sourceCrs: null,
      confidence: null,
      status: "unresolved",
      manuallyAdjusted: false,
      version: 1,
    };
    this.locations.set(location.id, location);
    return structuredClone(location);
  }

  async getOwned(ownerId, locationId) {
    const location = this.locations.get(locationId);
    if (!location || location.ownerId !== ownerId) throw new Error("Location not found");
    return structuredClone(location);
  }

  async transition(ownerId, locationId, expectedVersion, target, payload = {}) {
    const current = await this.getOwned(ownerId, locationId);
    if (current.version !== expectedVersion) throw new Error("Location version conflict");
    assertLocationTransition(current.status, target, {
      point: payload.point,
      manual: payload.manual,
    });
    const updated = {
      ...current,
      ...payload,
      status: target,
      manuallyAdjusted: payload.manual ?? current.manuallyAdjusted,
      version: current.version + 1,
    };
    this.locations.set(locationId, updated);
    return structuredClone(updated);
  }

  async createJob(input) {
    const job = {
      id: `gate-job-${this.nextJob++}`,
      ...input,
      status: "queued",
      candidates: null,
      errorCode: null,
    };
    this.jobs.set(job.id, job);
    return structuredClone(job);
  }

  async getJobOwned(ownerId, jobId) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error("Job not found");
    await this.getOwned(ownerId, job.locationId);
    return structuredClone(job);
  }

  async finishJob(jobId, status, candidates, errorCode) {
    const current = this.jobs.get(jobId);
    if (!current) throw new Error("Job not found");
    const updated = { ...current, status, candidates, errorCode };
    this.jobs.set(jobId, updated);
    return structuredClone(updated);
  }
}

function coordinateGateway(api, ownerId, locationId) {
  return {
    get: async () => api.get(ownerId, locationId),
    drag: async (point, ifMatch, inputMode) =>
      api.drag(ownerId, locationId, { point, inputMode }, { ifMatch }),
    pick: async (point, ifMatch) =>
      api.pick(ownerId, locationId, { point }, { ifMatch }),
    manual: async (point, ifMatch) =>
      api.manual(ownerId, locationId, { point }, { ifMatch }),
  };
}

describe("TC-M2-INT-02 location confirmation", () => {
  test("requires explicit same-name choice and preserves map edits over late geocoding", async () => {
    expect(minimalFiveDay.fixtureVersion).toBe("minimal-five-day@1");
    expect(minimalFiveDay.trip.days).toHaveLength(5);

    const bund = minimalFiveDay.locations.find(({ id }) => id === "loc-bund");
    expect(bund).toBeDefined();
    const ownerId = "empty-account-owner";
    const repository = new GateLocationRepository();
    expect(repository.locations.size).toBe(0);

    const locationService = new LocationService({
      repository,
      candidateSigner: new CandidateTokenSigner({
        secret: "tc-m2-location-confirmation-secret-32-bytes",
        clock: () => Date.parse("2026-10-01T00:00:00.000Z"),
      }),
    });
    const created = locationService.create(ownerId, minimalFiveDay.trip.id, {
      inputText: "外滩",
    });
    expect(repository.locations.size).toBe(1);
    const started = await locationService.beginResolving(
      ownerId,
      created.id,
      created.version,
      { provider: "here", query: created.inputText },
    );

    const fetchMock = vi.fn(async (url) => {
      const requestUrl = new URL(String(url));
      expect(requestUrl.hostname).toBe("geocode.search.hereapi.com");
      expect(requestUrl.searchParams.get("q")).toBe("外滩");
      expect(requestUrl.searchParams.get("apiKey")).toBe("gate-test-key");
      return new Response(JSON.stringify({
        items: [
          {
            id: "here:cn:bund",
            title: "外滩",
            resultType: "place",
            position: { lng: bund.longitude, lat: bund.latitude },
            address: {
              label: "中国上海市黄浦区外滩",
              countryCode: "CHN",
              city: "上海",
            },
            scoring: { queryScore: 0.98 },
          },
          {
            id: "here:gb:bund",
            title: "外滩",
            resultType: "place",
            position: { lng: -0.1276, lat: 51.5072 },
            address: {
              label: "英国伦敦的同名测试地点",
              countryCode: "GBR",
              city: "London",
            },
            scoring: { queryScore: 0.91 },
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const geocoder = createHereGeocoder({
      profile: "commercial-required",
      apiKey: "gate-test-key",
      language: "zh-CN",
      fetch: fetchMock,
    });

    let ambiguousResult;
    const input = new LocationInput({
      adapter: {
        capabilities: { autocomplete: false, explicitSearch: true },
        async search(request) {
          const normalized = await geocoder.search({
            query: request.query,
            trigger: request.trigger,
            locale: request.locale,
            limit: 5,
          });
          ambiguousResult = await locationService.applyResult(ownerId, started.job.id, {
            status: "ambiguous",
            candidates: normalized.map((candidate) => ({
              label: candidate.label,
              formattedAddress: candidate.formattedAddress,
              countryCode: candidate.countryCode,
              city: candidate.city,
              providerPlaceId: candidate.id,
              attribution: candidate.attribution,
              point: candidate.point,
            })),
          });
          return {
            candidates: normalized.map((candidate, index) => ({
              candidateId: ambiguousResult.job.candidates[index],
              label: candidate.label,
              formattedAddress: candidate.formattedAddress ?? candidate.label,
              countryCode: candidate.countryCode,
              city: candidate.city,
              provider: candidate.provider,
              attribution: candidate.attribution,
            })),
          };
        },
      },
      locationGateway: {
        selectCandidate: (request) => locationService.selectCandidate(
          ownerId,
          request.jobId,
          request.candidateToken,
          request.expectedVersion,
        ),
      },
      context: {
        tripId: minimalFiveDay.trip.id,
        locationId: created.id,
        jobId: started.job.id,
        expectedVersion: started.location.version + 1,
      },
      locale: "zh-CN",
    });

    input.setQuery("外滩");
    await input.explicitSearch();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(input.state.status).toBe("ambiguous");
    expect(input.state.candidates.map(({ label }) => label)).toEqual(["外滩", "外滩"]);
    expect(input.state.selectedCandidateId).toBeNull();
    await expect(input.submitSelected()).rejects.toThrow("Select a candidate");

    input.selectCandidate(input.state.candidates[0].candidateId);
    const selected = await input.submitSelected();
    expect(selected).toMatchObject({
      status: "resolved",
      point: {
        longitude: bund.longitude,
        latitude: bund.latitude,
        crs: "WGS84",
      },
    });

    const coordinateRepository = new InMemoryCoordinateRepository([{
      id: selected.id,
      ownerId,
      version: selected.version,
      status: selected.status,
      point: selected.point,
      manuallyAdjusted: false,
      name: selected.name,
      formattedAddress: selected.formattedAddress,
    }], () => new Date("2026-10-01T08:00:00.000Z"));
    const coordinateService = new CoordinateAdjustmentService(coordinateRepository);
    const coordinateApi = new LocationCoordinatesApi(coordinateService);
    const picker = new LocationPicker(coordinateGateway(
      coordinateApi,
      ownerId,
      selected.id,
    ));
    await picker.load();

    const staleVersion = picker.state.version;
    let releaseLateGeocode;
    const lateGeocode = new Promise((resolve) => {
      releaseLateGeocode = resolve;
    }).then(() => coordinateService.applyGeocodeResult(
      ownerId,
      selected.id,
      staleVersion,
      {
        label: "迟到的错误候选",
        point: { longitude: 10, latitude: 20, crs: "WGS84" },
      },
    ));

    const pickedPoint = { longitude: 121.501, latitude: 31.245, crs: "WGS84" };
    expect(await picker.pickPoint(pickedPoint, 2)).toBe(true);
    releaseLateGeocode();
    await expect(lateGeocode).resolves.toEqual({ affectedRows: 0, discarded: true });

    const draggedPoint = { longitude: 121.503, latitude: 31.247, crs: "WGS84" };
    await picker.dragMarker(draggedPoint, "mouse");

    const refreshed = new LocationPicker(coordinateGateway(
      coordinateApi,
      ownerId,
      selected.id,
    ));
    await refreshed.load();
    expect(refreshed.state).toMatchObject({
      status: "ready",
      point: draggedPoint,
      manuallyAdjusted: true,
    });

    const model = buildMapModel([{
      id: "item-03",
      dayId: minimalFiveDay.trip.days[0].id,
      dayNumber: 1,
      dayColor: "#2563eb",
      label: "外滩夜景",
      point: refreshed.state.point,
    }]);
    expect(model.markers[0].coordinate).toEqual([
      draggedPoint.longitude,
      draggedPoint.latitude,
    ]);
    expect(model.fit.kind).toBe("single");
    expect(await coordinateRepository.audits(ownerId, selected.id)).toMatchObject([
      { action: "location.coordinates.map-picked", fromVersion: selected.version },
      { action: "location.coordinates.marker-dragged" },
    ]);
  });
});
