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
        throw Object.assign(new Error(problem?.detail ?? problem?.title ?? `Unable to save coordinates: ${response.status}`), {
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
      setError(conflict ? "This location was updated elsewhere. Refresh and try again." : caught instanceof Error ? caught.message : "Unable to save coordinates");
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
          markerLabel: `Drag ${locationRef.current.name}`,
          label: locationRef.current.name,
          coordinate: [point.longitude, point.latitude],
          tooltip: `${locationRef.current.name} · drag to adjust`,
        }]);
        handle.fitBounds([[point.longitude, point.latitude], [point.longitude, point.latitude]], { padding: 72, maxZoom: 15 });
      } else {
        handle.setMarkers([]);
      }
    }).catch(() => setError("The map is unavailable. You can still enter exact coordinates."));
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
      daySequence: 1, dayColor: "#2563EB", markerLabel: `Drag ${location.name}`,
      label: location.name, coordinate: [location.point.longitude, location.point.latitude],
      tooltip: `${location.name} · drag to adjust`,
    }]);
  }, [location]);

  function submitExact(kind: "map-pick" | "marker-drag") {
    const point = parsePoint(mapLongitude, mapLatitude);
    if (!point) {
      setError("Enter valid WGS84 coordinates");
      return;
    }
    void persist(point, kind, "keyboard");
  }

  function submitManual() {
    const point = parsePoint(manualLongitude, manualLatitude);
    if (!point) {
      setError("Enter valid WGS84 coordinates");
      return;
    }
    void persist(point, "manual", "manual");
  }

  return <section className="locationCoordinateEditor" aria-label="Location coordinate adjustment">
    <h4>Adjust coordinates</h4>
    <p>Click the map to save a point, or drag an existing marker. Coordinates are saved as WGS84.</p>
    <div ref={containerRef} className="locationPickMap" role="application" aria-label="Location picker and draggable marker map" />
    <details><summary>Precise keyboard map and marker controls</summary>
      <div className="formRow">
        <label>Map longitude<input aria-label="Map longitude" inputMode="decimal" value={mapLongitude} onChange={(event) => setMapLongitude(event.target.value)} /></label>
        <label>Map latitude<input aria-label="Map latitude" inputMode="decimal" value={mapLatitude} onChange={(event) => setMapLatitude(event.target.value)} /></label>
      </div>
      <button type="button" disabled={pending} onClick={() => submitExact("map-pick")}>Save map point</button>
      <button type="button" disabled={pending || !location.point} onClick={() => submitExact("marker-drag")}>Save marker position</button>
    </details>
    <fieldset><legend>Manual coordinates</legend><div className="formRow">
      <label>Longitude<input aria-label="Manual longitude" inputMode="decimal" value={manualLongitude} onChange={(event) => setManualLongitude(event.target.value)} /></label>
      <label>Latitude<input aria-label="Manual latitude" inputMode="decimal" value={manualLatitude} onChange={(event) => setManualLatitude(event.target.value)} /></label>
    </div><button type="button" disabled={pending} onClick={submitManual}>Save manual coordinates</button></fieldset>
    <p role="status">Version {location.version}{location.point ? ` · ${location.point.longitude}, ${location.point.latitude}` : " · unresolved"}{location.manuallyAdjusted ? " · manually adjusted" : ""}</p>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
