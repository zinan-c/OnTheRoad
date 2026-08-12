"use client";

import { useEffect, useState } from "react";

import {
  decisionLabel,
  isValidPoint,
  type UnresolvedDecision,
  type UnresolvedLocation,
  type Wgs84Point,
} from "./unresolved-model";

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ORIGIN}/api/v1${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { accept: "application/json, application/problem+json", ...init?.headers },
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as { detail?: string; title?: string } | null;
    throw new Error(problem?.detail ?? problem?.title ?? `请求失败：${response.status}`);
  }
  return await response.json() as T;
}

function pointFromInputs(latitude: string, longitude: string): Wgs84Point | null {
  const point = { latitude: Number(latitude), longitude: Number(longitude) };
  return isValidPoint(point) ? { ...point, crs: "WGS84" } : null;
}

export function UnresolvedLocations({ jobId }: { readonly jobId: string }) {
  const [locations, setLocations] = useState<readonly UnresolvedLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setLocations(await request<readonly UnresolvedLocation[]>(`/imports/${jobId}/unresolved-locations`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未确认地点加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, [jobId]);

  async function decide(id: string, decision: UnresolvedDecision) {
    setSavingId(id);
    setError(null);
    try {
      await request(`/imports/${jobId}/unresolved-locations/${id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(decision),
      });
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未确认地点保存失败");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) return <section aria-busy="true"><h2>未确认地点</h2><p>正在加载地点候选…</p></section>;
  if (error && locations.length === 0) return <section><h2>未确认地点</h2><p role="alert">{error}</p><button type="button" onClick={() => void reload()}>重试</button></section>;
  return <section className="importUnresolvedLocations">
    <div className="importUnresolvedHeader"><h2>未确认地点</h2><span>{locations.length} 条待确认</span></div>
    {error ? <p role="alert">{error}</p> : null}
    {locations.length === 0 ? <p>所有地点都已完成处理。</p> : locations.map((location) => (
      <UnresolvedLocationCard key={location.id} location={location} saving={savingId === location.id} onDecision={(decision) => void decide(location.id, decision)} />
    ))}
  </section>;
}

function UnresolvedLocationCard({
  location,
  saving,
  onDecision,
}: {
  readonly location: UnresolvedLocation;
  readonly saving: boolean;
  readonly onDecision: (decision: UnresolvedDecision) => void;
}) {
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [name, setName] = useState(location.inputText);
  const point = pointFromInputs(latitude, longitude);
  return <article className="importUnresolvedCard">
    <header><strong>{location.inputText}</strong><small>{location.sourceRowKey}</small></header>
    {location.candidates.length > 0 ? <fieldset>
      <legend>候选地点</legend>
      {location.candidates.map((candidate) => <label key={candidate.candidateToken}>
        <input type="radio" name={`candidate-${location.id}`} value={candidate.candidateToken} onChange={() => onDecision({ type: "candidate", candidateToken: candidate.candidateToken })} disabled={saving} />
        <span>{candidate.label} · {candidate.formattedAddress}</span>
        <small>{candidate.provider} · {candidate.attribution}</small>
      </label>)}
    </fieldset> : <p>没有候选结果，请在地图上选点或填写坐标。</p>}
    <label>名称<input value={name} onChange={(event) => setName(event.target.value)} disabled={saving} /></label>
    <div className="importUnresolvedCoordinates">
      <label>纬度<input aria-label="纬度" inputMode="decimal" value={latitude} onChange={(event) => setLatitude(event.target.value)} disabled={saving} /></label>
      <label>经度<input aria-label="经度" inputMode="decimal" value={longitude} onChange={(event) => setLongitude(event.target.value)} disabled={saving} /></label>
    </div>
    <div className="importUnresolvedActions">
      <button type="button" disabled={saving || !point} onClick={() => point && onDecision({ type: "map_point", point, name })}>{decisionLabel("map_point")}</button>
      <button type="button" disabled={saving || !point} onClick={() => point && onDecision({ type: "manual_coordinate", point, name })}>{decisionLabel("manual_coordinate")}</button>
      <button type="button" disabled={saving} onClick={() => onDecision({ type: "accept_text", name })}>{decisionLabel("accept_text")}</button>
    </div>
  </article>;
}
