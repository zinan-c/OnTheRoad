import { describe, expect, test } from "vitest";

import { CandidateTokenSigner } from "@on-the-road/domain/location";
import type {
  LocationGateway,
  LocationSearchAdapter,
} from "../src/features/locations/api.js";
import { LocationInput } from "../src/features/locations/location-input.js";

type PersistedLocation = {
  id: string;
  tripId: string;
  inputText: string;
  name: string;
  status: "unresolved" | "ambiguous" | "resolved";
  version: number;
  point?: { latitude: number; longitude: number; crs: "WGS84" };
};

describe("TC-C04-03 select-or-text E2E", () => {
  test("signed candidate selection persists resolved Location without trusting client coordinates", async () => {
    const signer = new CandidateTokenSigner({
      secret: "tc-c04-candidate-signing-secret-32-bytes",
      clock: () => Date.parse("2026-10-01T00:00:00.000Z"),
    });
    const store = new Map<string, PersistedLocation>([
      ["location-1", {
        id: "location-1",
        tripId: "trip-1",
        inputText: "上海迪士尼",
        name: "上海迪士尼",
        status: "ambiguous",
        version: 2,
      }],
    ]);
    const rawCandidate = {
      label: "上海迪士尼乐园",
      formattedAddress: "中国上海市浦东新区川沙新镇黄赵路 310 号",
      countryCode: "CN",
      city: "上海",
      district: "浦东新区",
      providerPlaceId: "fixture-shanghai-disney",
      attribution: "Fixture Geocoder",
      point: {
        latitude: 31.1434,
        longitude: 121.6579,
        crs: "WGS84",
      },
    };
    const token = signer.sign({
      ownerId: "owner-1",
      tripId: "trip-1",
      locationId: "location-1",
      locationVersion: 2,
      candidate: rawCandidate,
    });
    const adapter: LocationSearchAdapter = {
      capabilities: { autocomplete: false, explicitSearch: true },
      search: async () => ({
        candidates: [{
          candidateId: token,
          label: rawCandidate.label,
          formattedAddress: rawCandidate.formattedAddress,
          countryCode: rawCandidate.countryCode,
          city: rawCandidate.city,
          district: rawCandidate.district,
          provider: "fixture",
          attribution: rawCandidate.attribution,
        }],
      }),
    };
    const gateway: LocationGateway = {
      async selectCandidate(request) {
        const verified = signer.verify(request.candidateToken, {
          ownerId: "owner-1",
          tripId: "trip-1",
          locationId: "location-1",
          locationVersion: request.expectedVersion,
        });
        if (request.confirmation.label !== verified.label) {
          throw new Error("Candidate confirmation label mismatch");
        }
        const current = store.get("location-1")!;
        const resolved: PersistedLocation = {
          ...current,
          name: verified.label,
          status: "resolved",
          version: current.version + 1,
          point: verified.point,
        };
        store.set(resolved.id, resolved);
        return structuredClone(resolved);
      },
    };

    const input = new LocationInput({
      adapter,
      locationGateway: gateway,
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
    expect(input.state.selectedCandidateId).toBeNull();
    input.selectCandidate(token);
    await input.submitSelected();

    const reloaded = structuredClone(store.get("location-1"));
    expect(reloaded).toMatchObject({
      name: "上海迪士尼乐园",
      status: "resolved",
      version: 3,
      point: { latitude: 31.1434, longitude: 121.6579, crs: "WGS84" },
    });
  });

  test("English zero-result path persists text-only unresolved Location", async () => {
    const store = new Map<string, PersistedLocation>();
    const adapter: LocationSearchAdapter = {
      capabilities: { autocomplete: false, explicitSearch: true },
      search: async () => ({ candidates: [] }),
    };
    const gateway: LocationGateway = {
      async saveText(request) {
        const saved: PersistedLocation = {
          id: "location-text-1",
          tripId: request.tripId,
          inputText: request.inputText,
          name: request.inputText,
          status: "unresolved",
          version: 1,
        };
        store.set(saved.id, saved);
        return structuredClone(saved);
      },
    };
    const input = new LocationInput({
      adapter,
      locationGateway: gateway,
      context: { tripId: "trip-1" },
      locale: "en",
    });
    input.setQuery("Unlisted pier near the old lighthouse");
    await input.explicitSearch();
    expect(input.state.status).toBe("empty");
    await input.saveText();

    expect(structuredClone(store.get("location-text-1"))).toEqual({
      id: "location-text-1",
      tripId: "trip-1",
      inputText: "Unlisted pier near the old lighthouse",
      name: "Unlisted pier near the old lighthouse",
      status: "unresolved",
      version: 1,
    });
  });
});
