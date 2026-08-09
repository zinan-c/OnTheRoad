"use client";

import { useEffect, useRef, useState } from "react";

import type { MapRuntimeHandle, MapRuntimeOptions } from "../map/maplibre-wrapper";
import { loadMapLibreRuntime } from "../map/maplibre-runtime.mjs";
import type { ProductLocation } from "./location-product-picker";

type Point = { longitude: number; latitude: number; crs: "WGS84" };
type AdjustmentKind = "map-pick" | "marker-drag" | "manual";

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";

function parsePoint(longitude: string, latitude: string): Point | null {
  const point = { longitude: Number(longitude), latitude: Number(latitude), crs: "WGS84" as const };
  return Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180
    && Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90
    ? point
    : null;
}

export function LocationCoordinateEditor({
  tripId,
  location,
  onSaved,
}: {
  readonly tripId: string;
  readonly location: ProductLocation;
  readonly onSaved: (location: ProductLocation) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<MapRuntimeHandle | null>(null);
  const locationRef = useRef(location);
  const [mapLongitude, setMapLongitude] = useState(String(location.point?.longitude ?? 121.49));
  const [mapLatitude, setMapLatitude] = useState(String(location.point?.latitude ?? 31.24));
  const [manualLongitude, setManualLongitude] = useState(String(location.point?.longitude ?? ""));
  const [manualLatitude, setManualLatitude] = useState(String(location.point?.latitude ?? ""));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    locationRef.current = location;
    if (location.point) {
      setMapLongitude(String(location.point.longitude));
      setMapLatitude(String(location.point.latitude));
      setManualLongitude(String(location.point.longitude));
      setManualLatitude(String(location.point.latitude));
    }
  }, [location]);

  async function persist(point: Point, adjustmentKind: AdjustmentKind, inputMode: "mouse" | "touch" | "keyboard" | "manual") {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`${API_ORIGIN}/api/v1/trips/${tripId}/locations/${locationRef.current.id}/coordinates`, {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: {
          accept: "application/json, application/problem+json",
          "content-type": "application/json",
          "if-match": `"${locationRef.current.version}"`,
        },
        body: JSON.stringify({ longitude: point.longitude, latitude: point.latitude, adjustmentKind, inputMode }),
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => null) as { code?: string; title?: string; detail?: string } | null;
        throw Object.assign(new Error(problem?.detail ?? problem?.title ?? `坐标保存失败：${response.status}`), {
          status: response.status,
          code: problem?.code,
        });
      }
      const saved = await response.json() as ProductLocation;
      locationRef.current = saved;
      onSaved(saved);
    } catch (caught) {
      const conflict = caught && typeof caught === "object" && "code" in caught
        && caught.code === "LOCATION_VERSION_CONFLICT";
      setError(conflict ? "Location 已被其他操作更新，请刷新后重试（版本冲突）" : caught instanceof Error ? caught.message : "坐标保存失败");
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    let disposed = false;
    void loadMapLibreRuntime().then(async (runtime) => {
      if (disposed || !containerRef.current) return;
      const typedRuntime = runtime as unknown as {
        createMap: (options: MapRuntimeOptions) => MapRuntimeHandle | Promise<MapRuntimeHandle>;
      };
      const handle = await typedRuntime.createMap({
        container: containerRef.current,
        onTileError: () => undefined,
        onMapClick: (point: Point) => void persist(point, "map-pick", "mouse"),
        onMarkerDragEnd: (_id: string, point: Point, inputMode: "mouse" | "touch") => void persist(point, "marker-drag", inputMode),
        draggableMarkers: true,
      });
      if (disposed) {
        handle.destroy();
        return;
      }
      runtimeRef.current = handle;
      handle.setGeoJson({ type: "FeatureCollection", features: [] });
      if (locationRef.current.point) {
        const point = locationRef.current.point;
        handle.setMarkers([{
          id: locationRef.current.id,
          itemId: locationRef.current.id,
          dayId: "location-editor",
          dayNumber: 1,
          daySequence: 1,
          dayColor: "#2563EB",
          markerLabel: `拖动 ${locationRef.current.name}`,
          label: locationRef.current.name,
          coordinate: [point.longitude, point.latitude],
          tooltip: `${locationRef.current.name} · 可拖动调整`,
        }]);
        handle.fitBounds([[point.longitude, point.latitude], [point.longitude, point.latitude]], { padding: 72, maxZoom: 15 });
      } else {
        handle.setMarkers([]);
      }
    }).catch(() => setError("地图运行时不可用，仍可使用精确坐标输入"));
    return () => {
      disposed = true;
      runtimeRef.current?.destroy();
      runtimeRef.current = null;
    };
  }, [tripId, location.id]);

  useEffect(() => {
    const handle = runtimeRef.current;
    if (!handle || !location.point) return;
    handle.setMarkers([{
      id: location.id, itemId: location.id, dayId: "location-editor", dayNumber: 1,
      daySequence: 1, dayColor: "#2563EB", markerLabel: `拖动 ${location.name}`,
      label: location.name, coordinate: [location.point.longitude, location.point.latitude],
      tooltip: `${location.name} · 可拖动调整`,
    }]);
  }, [location]);

  function submitExact(kind: "map-pick" | "marker-drag") {
    const point = parsePoint(mapLongitude, mapLatitude);
    if (!point) {
      setError("请输入有效的 WGS84 经纬度");
      return;
    }
    void persist(point, kind, "keyboard");
  }

  function submitManual() {
    const point = parsePoint(manualLongitude, manualLatitude);
    if (!point) {
      setError("请输入有效的 WGS84 经纬度");
      return;
    }
    void persist(point, "manual", "manual");
  }

  return <section className="locationCoordinateEditor" aria-label="Location 坐标调整">
    <h4>坐标调整</h4>
    <p>点击地图保存点位；已有 Marker 可直接拖动。所有坐标按 WGS84 保存。</p>
    <div ref={containerRef} className="locationPickMap" role="application" aria-label="地点点选与 Marker 拖动地图" />
    <details><summary>键盘精确操作地图与 Marker</summary>
      <div className="formRow">
        <label>地图经度<input aria-label="地图操作经度" inputMode="decimal" value={mapLongitude} onChange={(event) => setMapLongitude(event.target.value)} /></label>
        <label>地图纬度<input aria-label="地图操作纬度" inputMode="decimal" value={mapLatitude} onChange={(event) => setMapLatitude(event.target.value)} /></label>
      </div>
      <button type="button" disabled={pending} onClick={() => submitExact("map-pick")}>保存地图点选</button>
      <button type="button" disabled={pending || !location.point} onClick={() => submitExact("marker-drag")}>保存 Marker 拖动位置</button>
    </details>
    <fieldset><legend>手工坐标</legend><div className="formRow">
      <label>longitude<input aria-label="手工 longitude" inputMode="decimal" value={manualLongitude} onChange={(event) => setManualLongitude(event.target.value)} /></label>
      <label>latitude<input aria-label="手工 latitude" inputMode="decimal" value={manualLatitude} onChange={(event) => setManualLatitude(event.target.value)} /></label>
    </div><button type="button" disabled={pending} onClick={submitManual}>保存手工坐标</button></fieldset>
    <p role="status">version {location.version}{location.point ? ` · ${location.point.longitude}, ${location.point.latitude}` : " · 未解析"}{location.manuallyAdjusted ? " · 人工调整" : ""}</p>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
