"use client";

import { useState } from "react";

export type GalleryAttachment = {
  readonly id: string;
  readonly status: "pending" | "processing" | "failed" | "ready";
  readonly previewUrl?: string;
  readonly width?: number;
  readonly height?: number;
  readonly caption: string;
  readonly sortOrder: number;
  readonly isCover: boolean;
  readonly progress?: number;
  readonly error?: string;
};

export type GalleryActions = {
  readonly retry: (id: string) => void;
  readonly updateCaption: (id: string, caption: string) => void;
  readonly setCover: (id: string) => void;
  readonly remove: (id: string) => void;
  readonly reorder: (ids: string[]) => void;
};

export function attachmentAspectRatio(attachment: Pick<GalleryAttachment, "width" | "height">): string {
  if (!attachment.width || !attachment.height || attachment.width <= 0 || attachment.height <= 0) return "1 / 1";
  return `${attachment.width} / ${attachment.height}`;
}

export function Gallery({ attachments, actions }: { readonly attachments: readonly GalleryAttachment[]; readonly actions: GalleryActions }) {
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const selected = attachments.find(({ id }) => id === lightboxId);
  return <section aria-label="图片画廊" className="gallery">
    <div className="galleryGrid">
      {attachments.length === 0 ? <p role="status">还没有图片</p> : attachments.map((attachment) => <GalleryCard key={attachment.id} attachment={attachment} actions={actions} open={() => setLightboxId(attachment.id)} />)}
    </div>
    {selected ? <div role="dialog" aria-label="图片灯箱" className="lightbox" onClick={() => setLightboxId(null)}><button type="button" aria-label="关闭灯箱">关闭</button>{selected.previewUrl ? <img src={selected.previewUrl} alt={selected.caption || "行程图片"} style={{ aspectRatio: attachmentAspectRatio(selected) }} /> : <p>图片预览不可用</p>}</div> : null}
  </section>;
}

function GalleryCard({ attachment, actions, open }: { readonly attachment: GalleryAttachment; readonly actions: GalleryActions; readonly open: () => void }) {
  const busy = attachment.status === "pending" || attachment.status === "processing";
  return <article className="galleryCard" data-status={attachment.status}>
    <button type="button" className="galleryPreview" onClick={open} disabled={attachment.status !== "ready"} style={{ aspectRatio: attachmentAspectRatio(attachment) }} aria-label={attachment.caption || "查看图片"}>
      {attachment.previewUrl && attachment.status === "ready" ? <img src={attachment.previewUrl} alt="" /> : <span>{attachment.status === "failed" ? "处理失败" : busy ? `处理中 ${attachment.progress ?? 0}%` : "预览不可用"}</span>}
    </button>
    <label>说明<input value={attachment.caption} onChange={(event) => actions.updateCaption(attachment.id, event.target.value)} /></label>
    {attachment.error ? <p role="alert">{attachment.error}</p> : null}
    <div className="galleryActions">
      {attachment.status === "failed" ? <button type="button" onClick={() => actions.retry(attachment.id)}>重试</button> : null}
      <button type="button" onClick={() => actions.setCover(attachment.id)} aria-pressed={attachment.isCover}>设为封面</button>
      <button type="button" onClick={() => actions.remove(attachment.id)}>删除</button>
    </div>
  </article>;
}
