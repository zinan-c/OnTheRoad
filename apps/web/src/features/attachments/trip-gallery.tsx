"use client";

import { useEffect, useState } from "react";
import { Gallery, type GalleryAttachment } from "./gallery";

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";

export function TripGallery({ tripId, itemId }: { readonly tripId: string; readonly itemId: string }) {
  const [attachments, setAttachments] = useState<GalleryAttachment[]>([]);
  useEffect(() => { void fetch(`${API_ORIGIN}/api/v1/trips/${tripId}/itinerary-items/${itemId}/gallery`, { credentials: "include", cache: "no-store" }).then((response) => response.ok ? response.json() : []).then(setAttachments); }, [tripId, itemId]);
  async function update(id: string, patch: Record<string, unknown>) {
    const current = attachments.find((attachment) => attachment.id === id);
    if (!current) return;
    const response = await fetch(`${API_ORIGIN}/api/v1/trips/${tripId}/attachments/${id}/gallery`, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json", "if-match": String(current.version ?? 1) }, body: JSON.stringify(patch) });
    if (response.ok) { const updated = await response.json(); setAttachments((items) => items.map((item) => item.id === id ? { ...item, ...updated } : item)); }
  }
  return <section aria-label="真实图片画廊"><Gallery attachments={attachments} actions={{ retry: () => undefined, updateCaption: (id, caption) => void update(id, { caption }), setCover: (id) => void update(id, { isCover: true }), remove: async (id) => { await fetch(`${API_ORIGIN}/api/v1/trips/${tripId}/attachments/${id}/gallery`, { method: "DELETE", credentials: "include" }); setAttachments((items) => items.filter((item) => item.id !== id)); }, reorder: () => undefined }} /></section>;
}
