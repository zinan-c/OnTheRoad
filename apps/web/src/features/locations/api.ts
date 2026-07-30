export type LocationSearchTrigger = "autocomplete" | "explicit";

export type LocationCandidate = {
  candidateId: string;
  label: string;
  formattedAddress: string;
  countryCode?: string;
  city?: string;
  district?: string;
  provider: string;
  attribution: string;
};

export type LocationSearchContext = {
  tripId: string;
  city?: string;
  countryCode?: string;
  proximity?: { latitude: number; longitude: number };
};

export type LocationSearchAdapter = {
  capabilities: {
    autocomplete: boolean;
    explicitSearch: boolean;
  };
  search: (request: {
    query: string;
    trigger: LocationSearchTrigger;
    locale: string;
    context: LocationSearchContext;
    signal: AbortSignal;
  }) => Promise<{ candidates: LocationCandidate[] }>;
};

export type Wgs84Point = {
  latitude: number;
  longitude: number;
  crs: "WGS84";
};

export type LocationGateway = {
  selectCandidate?: (request: {
    jobId: string;
    candidateToken: string;
    expectedVersion: number;
    confirmation: { label: string };
  }) => Promise<unknown>;
  saveManual?: (request: {
    locationId: string;
    expectedVersion: number;
    point: Wgs84Point;
    source: "device" | "map" | "manual";
  }) => Promise<unknown>;
  saveText?: (request: {
    tripId: string;
    locationId?: string;
    expectedVersion?: number;
    inputText: string;
  }) => Promise<unknown>;
};
