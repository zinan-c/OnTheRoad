"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  ExportSection,
  ExportSnapshot,
} from "@on-the-road/application/export";
import {
  buildPrintChapters,
  buildPrintManifest,
  type PrintChapter,
  type PrintDay,
  type PrintItem,
} from "./chapters";
import "./print-template.css";

export const PRINT_READY_EVENT = "otr:print-ready";

export function PrintTemplate({
  snapshot,
  sections,
  templateVersion = "m4-print-v1",
  snapshotHash = null,
}: {
  readonly snapshot: ExportSnapshot;
  readonly sections: readonly ExportSection[];
  readonly templateVersion?: string;
  readonly snapshotHash?: string | null;
}) {
  const chapters = useMemo(() => buildPrintChapters(snapshot, sections), [snapshot, sections]);
  const manifest = useMemo(() => buildPrintManifest(snapshot, chapters), [snapshot, chapters]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (typeof document !== "undefined") {
        await document.fonts?.ready;
        await Promise.all([...document.images].map(async (image) => {
          try {
            await image.decode?.();
          } catch {
            // A missing optional image is represented in the snapshot omission list.
          }
        }));
      }
      if (!active) return;
      setReady(true);
      window.dispatchEvent(new CustomEvent(PRINT_READY_EVENT, {
        detail: {
          templateVersion,
          snapshotHash,
          assetIds: manifest.referencedAssetIds,
          missingAssetIds: manifest.missingReferencedAssetIds,
        },
      }));
    })();
    return () => { active = false; };
  }, [manifest.missingReferencedAssetIds, manifest.referencedAssetIds, snapshotHash, templateVersion]);

  return <main
    className="otrPrintDocument"
    data-print-ready={ready ? "ready" : "waiting"}
    data-template-version={templateVersion}
    data-snapshot-hash={snapshotHash ?? undefined}
    data-asset-manifest={JSON.stringify(manifest.referencedAssetIds)}
  >
    {chapters.map((chapter) => <PrintChapterView key={chapter.id} chapter={chapter} />)}
  </main>;
}

function PrintChapterView({ chapter }: { readonly chapter: PrintChapter }) {
  return <section
    className={`otrPrintChapter otrPrintChapter--${chapter.kind}`}
    data-print-section={chapter.section}
    aria-labelledby={`print-heading-${chapter.id}`}
  >
    <h1 id={`print-heading-${chapter.id}`}>{chapter.title}</h1>
    {chapter.kind === "cover" ? <Cover data={chapter.data} /> : null}
    {chapter.kind === "overview" ? <Overview data={chapter.data} /> : null}
    {chapter.kind === "map" ? <MapSection data={chapter.data} /> : null}
    {chapter.kind === "day" ? <DailyItinerary data={chapter.data} /> : null}
    {chapter.kind === "list" ? <ListSection data={chapter.data} /> : null}
    {chapter.kind === "omissions" ? <Omissions data={chapter.data} /> : null}
  </section>;
}

function Cover({ data }: { readonly data: Readonly<Record<string, unknown>> }) {
  return <div className="otrPrintCover"><p>{text(data.name ?? data.title) ?? "未命名旅程"}</p><p>{text(data.startDate) ?? ""}{text(data.endDate) ? ` — ${text(data.endDate)}` : ""}</p></div>;
}

function Overview({ data }: { readonly data: Readonly<Record<string, unknown>> }) {
  const entries = Object.entries(data).filter(([, value]) => ["string", "number"].includes(typeof value));
  return entries.length === 0 ? <p>暂无概览信息。</p> : <dl>{entries.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>;
}

function MapSection({ data }: { readonly data: Readonly<Record<string, unknown>> }) {
  const days = Array.isArray(data.days) ? data.days as readonly PrintDay[] : [];
  const assetId = text(data.assetId);
  return <div className="otrPrintMap" data-map-asset-id={assetId ?? undefined}>
    {assetId ? <p>地图资源：{assetId}</p> : null}
    {days.map((day) => <p key={day.id} data-map-asset-id={day.mapAssetId ?? undefined}>{day.title}：{day.mapAssetId ?? "暂无地图"}</p>)}
    {!assetId && days.length === 0 ? <p>暂无地图资源，详见遗漏清单。</p> : null}
  </div>;
}

function DailyItinerary({ data }: { readonly data: Readonly<Record<string, unknown>> }) {
  const days = Array.isArray(data.days) ? data.days as readonly PrintDay[] : [];
  if (days.length === 0) return <p>暂无每日行程。</p>;
  return <div className="otrPrintDays">{days.map((day) => <article key={day.id} data-day-number={day.dayNumber}><h2>{day.title}{day.date ? ` · ${day.date}` : ""}</h2><ItemList items={day.items} /></article>)}</div>;
}

function ItemList({ items }: { readonly items: readonly PrintItem[] }) {
  return items.length === 0 ? <p>当天没有行程安排。</p> : <ol>{items.map((item) => <li key={item.id}><h3>{item.name}</h3>{item.time ? <p>{item.time}</p> : null}{item.location ? <p>{item.location}</p> : null}{item.description ? <p>{item.description}</p> : null}{item.expense ? <p>Expense: {item.expense}</p> : null}</li>)}</ol>;
}

function ListSection({ data }: { readonly data: Readonly<Record<string, unknown>> }) {
  const items = Array.isArray(data.items) ? data.items : [];
  return items.length === 0 ? <p>暂无内容。</p> : <ul>{items.map((item, index) => <li key={typeof item === "string" ? item : index}>{typeof item === "string" ? item : JSON.stringify(item)}</li>)}</ul>;
}

function Omissions({ data }: { readonly data: Readonly<Record<string, unknown>> }) {
  const items = Array.isArray(data.items) ? data.items : [];
  return items.length === 0 ? <p>没有遗漏资源。</p> : <ul aria-label="遗漏资源">{items.map((item, index) => <li key={index}>{typeof item === "object" && item ? `${String((item as { id?: unknown }).id ?? "resource")}: ${String((item as { omissionReason?: unknown }).omissionReason ?? "未就绪")}` : String(item)}</li>)}</ul>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
