import { describe, expect, test } from "vitest";

import { downloadStandardTemplate } from "../../src/modules/imports/template.mjs";
import { STANDARD_COLUMNS, inspectTemplate } from "../../../../packages/importer/src/index.mjs";

describe("TC-E01-03 standard template self-import", () => {
  test("downloads an Excel-readable template mapped to its own standard fields", () => {
    const response = downloadStandardTemplate();

    expect(response).toMatchObject({
      status: 200,
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition":
          'attachment; filename="on-the-road-import-template-v1.0.0.xlsx"',
      },
    });
    expect(inspectTemplate(response.body)).toMatchObject({
      columns: STANDARD_COLUMNS,
      aliasesSheet: true,
      instructionsSheet: true,
    });
  });
});
