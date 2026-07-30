import { expect, test } from "vitest";

import { createReferenceDataResponse } from "../../src/modules/system/reference-data.mjs";
import { parseReferenceDataResponse } from "@on-the-road/contracts";

test("TC-B01-03 reference API round-trips through the generated client parser", () => {
  const response = createReferenceDataResponse();
  const parsed = parseReferenceDataResponse(response);

  expect(parsed).toEqual(response);
  expect(parsed.currencies).toHaveLength(15);
  expect(parsed.transportModes).toHaveLength(22);
  expect(parsed.costCategories).toHaveLength(9);
  expect(parsed.currencyAliases).toEqual({ RMB: "CNY" });
});
