"use client";

import { useCallback, useEffect, useState } from "react";
import { Gallery, type GalleryAttachment } from "./gallery";

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";

export function TripGallery({
  tripId,
  itemId,
}: {
  readonly tripId: string;
  readonly itemId: string;
}) {
  const [attachments, setAttachments] = useState<GalleryAttachment[]>([]);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(
      `${API_ORIGIN}/api/v1/trips/${tripId}/itinerary-items/${itemId}/gallery`,
      { credentials: "include", cache: "no-store" },
    );
    if (response.ok) setAttachments(await response.json());
  }, [tripId, itemId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!attachments.some(({ status }) =>
      ["pending", "uploaded", "processing"].includes(status))) return;
    const timer = setInterval(() => void refresh(), 1_000);
    return () => clearInterval(timer);
  }, [attachments, refresh]);

  async function update(id: string, patch: Record<string, unknown>) {
    const current = attachments.find((attachment) => attachment.id === id);
    if (!current) return;
    const response = await fetch(
      `${API_ORIGIN}/api/v1/trips/${tripId}/attachments/${id}/gallery`,
      {
        method: "PATCH",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "if-match": String(current.version ?? 1),
        },
        body: JSON.stringify(patch),
      },
    );
    if (response.ok) {
      const updated = await response.json();
      if (patch.isCover === true) {
        await refresh();
      } else {
        setAttachments((items) =>
          items.map((item) => item.id === id ? { ...item, ...updated } : item));
      }
    } else if (response.status === 409) {
      await refresh();
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        setUploadStatus(`正在准备 ${file.name}`);
        const checksumSha256 = await digestBase64(file);
        const sessionResponse = await fetch(
          `${API_ORIGIN}/api/v1/trips/${tripId}/attachments/upload-sessions`,
          {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              itineraryItemId: itemId,
              contentType: file.type,
              contentLength: file.size,
              checksumSha256,
            }),
          },
        );
        if (!sessionResponse.ok) throw new Error(`上传会话失败：${sessionResponse.status}`);
        const session = await sessionResponse.json() as {
          attachmentId: string;
          uploadUrl: string;
          headers: Record<string, string>;
        };
        setAttachments((items) => [...items, {
          id: session.attachmentId,
          status: "pending",
          caption: "",
          sortOrder: items.length,
          isCover: false,
          progress: 0,
          version: 1,
        }]);
        await uploadWithProgress(
          session.uploadUrl,
          session.headers,
          file,
          (progress) => setAttachments((items) =>
            items.map((item) => item.id === session.attachmentId
              ? { ...item, progress }
              : item)),
        );
        const complete = await fetch(
          `${API_ORIGIN}/api/v1/trips/${tripId}/attachments/${session.attachmentId}/complete`,
          { method: "POST", credentials: "include" },
        );
        if (!complete.ok) throw new Error(`上传确认失败：${complete.status}`);
        setUploadStatus(`${file.name} 已上传，正在安全处理`);
        await refresh();
      } catch (error) {
        setUploadStatus(error instanceof Error ? error.message : "图片上传失败");
      }
    }
  }

  async function reorder(orderedIds: string[]) {
    const response = await fetch(
      `${API_ORIGIN}/api/v1/trips/${tripId}/itinerary-items/${itemId}/gallery/reorder`,
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderedIds,
          expectedVersions: Object.fromEntries(
            attachments.map(({ id, version }) => [id, version ?? 1]),
          ),
        }),
      },
    );
    if (response.ok) setAttachments(await response.json());
    else await refresh();
  }

  return <section aria-label="真实图片画廊">
    <label>
      上传图片
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={(event) => {
          void upload(event.target.files);
          event.target.value = "";
        }}
      />
    </label>
    {uploadStatus ? <p role="status">{uploadStatus}</p> : null}
    <Gallery
      attachments={attachments}
      actions={{
        retry: (id) => {
          void fetch(
            `${API_ORIGIN}/api/v1/trips/${tripId}/attachments/${id}/retry`,
            { method: "POST", credentials: "include" },
          ).then(() => refresh());
        },
        updateCaption: (id, caption) => void update(id, { caption }),
        setCover: (id) => void update(id, { isCover: true }),
        remove: async (id) => {
          const response = await fetch(
            `${API_ORIGIN}/api/v1/trips/${tripId}/attachments/${id}/gallery`,
            { method: "DELETE", credentials: "include" },
          );
          if (response.ok) {
            setAttachments((items) => items.filter((item) => item.id !== id));
          }
        },
        reorder: (ids) => void reorder(ids),
      }}
    />
  </section>;
}

async function digestBase64(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function uploadWithProgress(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLocaleLowerCase("en-US") !== "content-length") {
        request.setRequestHeader(name, value);
      }
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onerror = () => reject(new Error("图片上传中断，可稍后重试"));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`图片上传失败：${request.status}`));
    };
    request.send(file);
  });
}
