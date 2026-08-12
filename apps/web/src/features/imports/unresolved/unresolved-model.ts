export type Wgs84Point = Readonly<{
  longitude: number;
  latitude: number;
  crs: "WGS84";
}>;

export type UnresolvedCandidate = Readonly<{
  label: string;
  formattedAddress: string;
  point: Wgs84Point;
  city: string | null;
  district: string | null;
  provider: string;
  attribution: string;
  candidateToken: string;
}>;

export type UnresolvedLocation = Readonly<{
  id: string;
  tripId: string;
  importJobId: string;
  importRowId: string;
  sourceRowKey: string;
  status: "staged" | "ready";
  version: number;
  inputText: string;
  candidates: readonly UnresolvedCandidate[];
  selectedPoint: Wgs84Point | null;
  selectedType: "candidate" | "map_point" | "manual_coordinate" | "accept_text" | null;
  errors: readonly { readonly field?: string; readonly message?: string }[];
}>;

export type UnresolvedDecision =
  | Readonly<{ type: "candidate"; candidateToken: string }>
  | Readonly<{ type: "map_point"; point: Wgs84Point; name?: string }>
  | Readonly<{ type: "manual_coordinate"; point: Wgs84Point; name?: string }>
  | Readonly<{ type: "accept_text"; name?: string }>;

export function decisionLabel(decision: UnresolvedDecision["type"]): string {
  return {
    candidate: "候选地点",
    map_point: "地图点",
    manual_coordinate: "手工坐标",
    accept_text: "仅接受文本",
  }[decision];
}

export function isValidPoint(value: Readonly<{ latitude: number; longitude: number }>): boolean {
  return Number.isFinite(value.latitude)
    && Number.isFinite(value.longitude)
    && value.latitude >= -90
    && value.latitude <= 90
    && value.longitude >= -180
    && value.longitude <= 180;
}
