"use client";

import { useEffect, useState } from "react";
import { LocationCoordinateEditor } from "./location-coordinate-editor";

type Point = { longitude: number; latitude: number; crs: "WGS84" };

export type ProductLocation = {
  id: string;
  tripId: string;
  inputText: string;
  name: string;
  formattedAddress: string | null;
  city: string | null;
  district: string | null;
  point: Point | null;
  provider: string | null;
  attribution: string | null;
  status: "unresolved" | "resolving" | "resolved" | "ambiguous" | "failed";
  manuallyAdjusted: boolean;
  version: number;
};

type SignedCandidate = {
  label: string;
  formattedAddress: string;
  city: string | null;
  district: string | null;
  point: Point;
  provider: string;
  attribution: string;
  selected: false;
  candidateToken: string;
};

type ResolutionOffer = {
  location: ProductLocation;
  job: { id: string; status: string };
  mapProfile: string;
  candidates: SignedCandidate[];
};

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";

async function locationApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ORIGIN}/api/v1${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { accept: "application/json, application/problem+json", ...init?.headers },
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as { detail?: string; title?: string } | null;
    throw Object.assign(new Error(problem?.detail ?? problem?.title ?? `Location request failed: ${response.status}`), { status: response.status });
  }
  return await response.json() as T;
}

export function LocationProductPicker({
  tripId,
  locationId,
  initialText = "",
  legend = "Location",
  inputLabel = "Location name",
  onLocationChange,
}: {
  readonly tripId: string;
  readonly locationId: string;
  readonly initialText?: string;
  readonly legend?: string;
  readonly inputLabel?: string;
  readonly onLocationChange: (locationId: string, inputText: string) => void;
}) {
  const [inputText, setInputText] = useState(initialText);
  const [location, setLocation] = useState<ProductLocation | null>(null);
  const [offer, setOffer] = useState<ResolutionOffer | null>(null);
  const [selectedToken, setSelectedToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!locationId) {
      setLocation(null);
      return;
    }
    let active = true;
    void locationApi<ProductLocation>(`/trips/${tripId}/locations/${locationId}`).then((loaded) => {
      if (!active) return;
      setLocation(loaded);
      setInputText(loaded.inputText);
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "Unable to load location");
    });
    return () => { active = false; };
  }, [locationId, tripId]);

  async function explicitSearch() {
    if (!inputText.trim()) {
      setError("Enter a location first");
      return;
    }
    setPending(true);
    setError(null);
    setOffer(null);
    setSelectedToken("");
    try {
      const target = location ?? await locationApi<ProductLocation>(`/trips/${tripId}/locations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inputText: inputText.trim() }),
      });
      setLocation(target);
      onLocationChange(target.id, inputText.trim());
      const found = await locationApi<ResolutionOffer>(`/trips/${tripId}/locations/${target.id}/search`, {
        method: "POST",
        headers: { "content-type": "application/json", "if-match": String(target.version) },
        body: JSON.stringify({ query: inputText.trim() }),
      });
      setLocation(found.location);
      setOffer(found);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Location search failed");
    } finally {
      setPending(false);
    }
  }

  async function saveTextOnly() {
    if (!inputText.trim()) {
      setError("Enter a location first");
      return;
    }
    if (location) {
      onLocationChange(location.id, location.inputText);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const created = await locationApi<ProductLocation>(`/trips/${tripId}/locations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inputText: inputText.trim() }),
      });
      setLocation(created);
      onLocationChange(created.id, created.inputText);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the location text");
    } finally {
      setPending(false);
    }
  }

  async function confirmCandidate() {
    if (!offer || !selectedToken) {
      setError("Select a location candidate");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const resolved = await locationApi<ProductLocation>(`/trips/${tripId}/locations/${offer.location.id}/candidate`, {
        method: "POST",
        headers: { "content-type": "application/json", "if-match": String(offer.location.version) },
        body: JSON.stringify({ jobId: offer.job.id, candidateToken: selectedToken }),
      });
      setLocation(resolved);
      setOffer(null);
      setSelectedToken("");
      onLocationChange(resolved.id, resolved.inputText);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to confirm the candidate");
    } finally {
      setPending(false);
    }
  }

  return <fieldset className="locationProductPicker">
    <legend>{legend}</legend>
    <label>{inputLabel}<input aria-label={inputLabel} value={inputText} disabled={location?.status === "resolved"} onChange={(event) => setInputText(event.target.value)} /></label>
    {!location ? <button type="button" disabled={pending} onClick={() => void saveTextOnly()}>Save text only</button> : null}
    {!location || location.status === "unresolved" || location.status === "failed"
      ? <button type="button" disabled={pending} onClick={() => void explicitSearch()}>{pending ? "Working…" : "Search location"}</button>
      : null}
    {location ? <p role="status">Location status: {location.status}{location.formattedAddress ? ` · ${location.formattedAddress}` : ""}{location.attribution ? ` · ${location.attribution}` : ""}</p> : null}
    {offer ? <div className="locationCandidates" role="radiogroup" aria-label="Location candidates">
      {offer.candidates.map((candidate) => <label key={candidate.candidateToken}>
        <input type="radio" name={`location-candidate-${offer.location.id}`} value={candidate.candidateToken} checked={selectedToken === candidate.candidateToken} onChange={(event) => setSelectedToken(event.target.value)} />
        <strong>{candidate.label}</strong><span>{candidate.city ?? ""} {candidate.district ?? ""}</span><span>{candidate.formattedAddress}</span><small>{candidate.provider} · {candidate.attribution}</small>
      </label>)}
      <button type="button" disabled={pending || !selectedToken} onClick={() => void confirmCandidate()}>Confirm location</button>
      <small>Map profile：{offer.mapProfile}</small>
    </div> : null}
    {location ? <LocationCoordinateEditor tripId={tripId} location={location} onSaved={(saved) => {
      setLocation(saved);
      onLocationChange(saved.id, saved.inputText);
    }} /> : null}
    {error ? <p role="alert">{error}</p> : null}
  </fieldset>;
}
