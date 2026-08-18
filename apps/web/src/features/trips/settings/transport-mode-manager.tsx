"use client";

import { useEffect, useState } from "react";

import type { TransportModeInput, TransportModeView } from "./transport-modes";

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";

async function modeApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ORIGIN}/api/v1${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { accept: "application/json, application/problem+json", ...init?.headers },
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as { detail?: string; title?: string } | null;
    throw new Error(problem?.detail ?? problem?.title ?? `Transport mode request failed: ${response.status}`);
  }
  return await response.json() as T;
}

const EMPTY: TransportModeInput = {
  code: "",
  label: "",
  icon: "route",
  color: "#2563EB",
  lineStyle: "solid",
};

export function TransportModeManager({
  tripId,
  onCatalogChange,
}: {
  readonly tripId: string;
  readonly onCatalogChange: (modes: TransportModeView[]) => void;
}) {
  const [modes, setModes] = useState<TransportModeView[]>([]);
  const [draft, setDraft] = useState<TransportModeInput>(EMPTY);
  const [editing, setEditing] = useState<TransportModeView | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function replace(next: TransportModeView[]) {
    setModes(next);
    onCatalogChange(next);
  }

  useEffect(() => {
    let active = true;
    void modeApi<TransportModeView[]>(`/trips/${tripId}/transport-modes`).then((loaded) => {
      if (active) replace(loaded);
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "Unable to load transport modes");
    });
    return () => { active = false; };
  }, [tripId]);

  function updateDraft<K extends keyof TransportModeInput>(key: K, value: TransportModeInput[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const saved = editing
        ? await modeApi<TransportModeView>(`/trips/${tripId}/transport-modes/${editing.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json", "if-match": String(editing.version) },
            body: JSON.stringify({ label: draft.label, icon: draft.icon, color: draft.color, lineStyle: draft.lineStyle }),
          })
        : await modeApi<TransportModeView>(`/trips/${tripId}/transport-modes`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(draft),
          });
      replace(editing
        ? modes.map((mode) => mode.id === saved.id ? saved : mode)
        : [...modes, saved]);
      setDraft(EMPTY);
      setEditing(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the transport mode");
    } finally {
      setPending(false);
    }
  }

  async function deactivate(mode: TransportModeView) {
    setPending(true);
    setError(null);
    try {
      const saved = await modeApi<TransportModeView>(`/trips/${tripId}/transport-modes/${mode.id}`, {
        method: "DELETE",
        headers: { "if-match": String(mode.version) },
      });
      replace(modes.map((entry) => entry.id === saved.id ? saved : entry));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to deactivate the transport mode");
    } finally {
      setPending(false);
    }
  }

  return <section className="transportModeManager" aria-label="Transport mode management">
    <h3>Transport modes</h3>
    {error ? <p role="alert">{error}</p> : null}
    <form aria-label={editing ? `Edit transport mode ${editing.label}` : "Add custom transport mode"} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label>Code<input aria-label="Transport mode code" required pattern="[A-Z][A-Z0-9_]{1,63}" disabled={Boolean(editing)} value={draft.code} onChange={(event) => updateDraft("code", event.target.value.toUpperCase())} /></label>
      <label>Name<input aria-label="Transport mode name" required maxLength={80} value={draft.label} onChange={(event) => updateDraft("label", event.target.value)} /></label>
      <label>Icon<input aria-label="Transport mode icon" required value={draft.icon} onChange={(event) => updateDraft("icon", event.target.value)} /></label>
      <label>Color<input aria-label="Transport mode color" required pattern="#[0-9A-F]{6}([0-9A-F]{2})?" value={draft.color} onChange={(event) => updateDraft("color", event.target.value.toUpperCase())} /></label>
      <label>Line style<select aria-label="Transport mode line style" value={draft.lineStyle} onChange={(event) => updateDraft("lineStyle", event.target.value as TransportModeInput["lineStyle"])}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option><option value="arc">Arc</option></select></label>
      <button type="submit" disabled={pending}>{editing ? "Save changes" : "Add transport mode"}</button>
      {editing ? <button type="button" onClick={() => { setEditing(null); setDraft(EMPTY); }}>Cancel editing</button> : null}
    </form>
    <ul>{modes.map((mode) => <li
      key={mode.id}
      data-mode-code={mode.code}
      data-mode-label={mode.label}
      data-mode-icon={mode.icon}
      data-mode-color={mode.color}
      data-mode-line-style={mode.lineStyle}
      data-enabled={mode.enabled}
    >
      <span aria-hidden="true" data-mode-icon={mode.icon} style={{ color: mode.color }}>{mode.icon}</span>
      <strong>{mode.label}</strong> <code>{mode.code}</code> <span>{mode.lineStyle}</span>
      {!mode.enabled ? <span role="status">已停用</span> : null}
      {mode.isSystem ? <span>System</span> : <>
        <button type="button" disabled={pending || !mode.enabled} aria-label={`Edit ${mode.label}`} onClick={() => {
          setEditing(mode);
          setDraft({ code: mode.code, label: mode.label, icon: mode.icon, color: mode.color, lineStyle: mode.lineStyle });
        }}>Edit</button>
        <button type="button" disabled={pending || !mode.enabled} aria-label={`Deactivate ${mode.label}`} onClick={() => void deactivate(mode)}>{mode.enabled ? "Deactivate" : "Inactive"}</button>
      </>}
    </li>)}</ul>
  </section>;
}
