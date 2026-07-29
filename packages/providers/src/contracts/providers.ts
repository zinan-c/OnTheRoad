import type {
  GeocodeQuery,
  MapClientConfig,
  MapContext,
  PlaceCandidate,
  ProviderAttribution,
  RouteRequest,
  RouteResult,
  StaticMapAsset,
  StaticMapRequest,
  Wgs84Point,
} from "./dto.js";

export type ProviderCapability =
  | "map"
  | "geocoding"
  | "reverseGeocoding"
  | "directions"
  | "staticMap";

export interface ProviderCapabilityMatrix {
  readonly map: boolean;
  readonly geocoding: boolean;
  readonly reverseGeocoding: boolean;
  readonly directions: boolean;
  readonly staticMap: boolean;
  readonly autocomplete: boolean;
  readonly fuzzy: boolean;
}

export interface MapProvider {
  getClientConfig(context: MapContext): Promise<MapClientConfig>;
  getAttribution(): ProviderAttribution;
}

export interface GeocodingProvider {
  capabilities(): { readonly autocomplete: boolean; readonly fuzzy: boolean };
  search(query: GeocodeQuery): Promise<PlaceCandidate[]>;
}

export interface ReverseGeocodingProvider {
  reverse(point: Wgs84Point, locale?: string): Promise<PlaceCandidate | null>;
}

export interface DirectionsProvider {
  route(request: RouteRequest): Promise<RouteResult>;
}

export interface StaticMapProvider {
  render(request: StaticMapRequest): Promise<StaticMapAsset>;
}

export interface ProviderSuite {
  readonly map: MapProvider;
  readonly geocoding: GeocodingProvider;
  readonly reverseGeocoding: ReverseGeocodingProvider;
  readonly directions: DirectionsProvider;
  readonly staticMap: StaticMapProvider;
  readonly capabilityMatrix: ProviderCapabilityMatrix;
}
