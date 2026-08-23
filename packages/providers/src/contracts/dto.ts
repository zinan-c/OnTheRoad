export interface Wgs84Point {
  readonly longitude: number;
  readonly latitude: number;
  readonly crs: "WGS84";
}

export interface ProviderAttribution {
  readonly text: string;
}

export interface MapContext {
  readonly locale: string;
  readonly profile: string;
}

export interface MapClientConfig {
  readonly profile: string;
  readonly style: "neutral-grid";
  readonly attribution: string;
}

export interface GeocodeQuery {
  readonly query: string;
  readonly locale?: string;
  readonly limit?: number;
}

export interface PlaceCandidate {
  readonly id: string;
  readonly label: string;
  readonly point: Wgs84Point;
  readonly countryCode?: string;
  readonly providerScore: number;
  readonly attribution: string;
}

export interface RouteRequest {
  readonly from: Wgs84Point;
  readonly to: Wgs84Point;
  readonly mode: string;
  readonly mapProfile?: string;
  /** AMap transit city context. Values are provider-facing city names/codes. */
  readonly city?: string;
  readonly cityd?: string;
}

export interface RouteGeometry {
  readonly type: "LineString";
  readonly coordinates: readonly Wgs84Point[];
}

export interface RouteResult {
  readonly kind: "resolved" | "approximate";
  readonly mode: string;
  readonly geometry: RouteGeometry;
  readonly attribution: string;
}

export interface StaticMapRequest {
  readonly points: readonly Wgs84Point[];
  readonly width: number;
  readonly height: number;
}

export interface StaticMapAsset {
  readonly mediaType: "image/svg+xml";
  readonly content: string;
  readonly width: number;
  readonly height: number;
  readonly attribution: string;
}
