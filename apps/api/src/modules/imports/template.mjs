import {
  TEMPLATE_VERSION,
  generateStandardTemplate,
} from "../../../../../packages/importer/src/index.mjs";

export function downloadStandardTemplate() {
  return {
    status: 200,
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition":
        `attachment; filename="on-the-road-import-template-v${TEMPLATE_VERSION}.xlsx"`,
      "cache-control": "private, no-store",
    },
    body: generateStandardTemplate(),
  };
}
