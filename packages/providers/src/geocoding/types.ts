import type { PlaceCandidate, Wgs84Point } from "../contracts/dto.js";

export interface GeocodingContext {
  readonly countryCodes?: readonly string[];
  readonly viewbox?: readonly [number, number, number, number];
}

export interface GeocodingSearchRequest {
  readonly query: string;
  readonly locale?: string;
  readonly limit?: number;
  readonly context?: GeocodingContext;
  readonly trigger?: "explicit" | "autocomplete" | "batch";
}

export interface NormalizedCandidate extends PlaceCandidate {
  readonly formattedAddress?: string;
  readonly city?: string;
  readonly type?: string;
  readonly selected: false;
  readonly provider: "here" | "amap" | "fixture";
  readonly mapProfile: string;
}

export interface GeocoderCapabilities {
  readonly search: true;
  readonly reverse: true;
  readonly autocomplete: false;
  readonly fuzzy: boolean;
}

export interface Geocoder {
  readonly provider: "here" | "amap" | "hybrid" | "fixture";
  readonly profile: string;
  capabilities(): GeocoderCapabilities;
  search(request: GeocodingSearchRequest): Promise<NormalizedCandidate[]>;
  reverse(point: Wgs84Point, locale?: string): Promise<NormalizedCandidate | null>;
}

export type GeocodingFetch = (
  url: URL,
  init?: RequestInit,
) => Promise<Response>;
