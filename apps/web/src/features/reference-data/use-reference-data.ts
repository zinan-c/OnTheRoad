"use client";

import { getReferenceData } from "@on-the-road/config/reference-data";
import { useEffect, useState } from "react";

export type ReferenceCurrency = {
  readonly code: string;
  readonly label: string;
  readonly aliases: readonly string[];
};

export type ReferenceCategory = {
  readonly code: string;
  readonly label: string;
};

export type ProductReferenceData = {
  readonly currencies: readonly ReferenceCurrency[];
  readonly costCategories: readonly ReferenceCategory[];
  readonly currencyAliases: Readonly<Record<string, string>>;
};

const shared = getReferenceData() as ProductReferenceData;
const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:3001";

export function useReferenceData(): ProductReferenceData {
  const [referenceData, setReferenceData] = useState<ProductReferenceData>(shared);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${API_ORIGIN}/api/v1/system/reference-data`, {
      credentials: "include",
      signal: controller.signal,
    }).then(async (response) => {
      if (response.ok) setReferenceData(await response.json() as ProductReferenceData);
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  return referenceData;
}
