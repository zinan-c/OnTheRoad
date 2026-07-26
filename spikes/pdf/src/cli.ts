import path from "node:path";

import { generateSpikePdf, inspectPdf, verifyExactToc } from "./spike.ts";

const outputDir = path.resolve(process.argv[2] ?? "artifacts");
const result = await generateSpikePdf({ outputDir, keepIntermediate: true });
const inspection = await inspectPdf(result.pdfPath);
const toc = await verifyExactToc(result.pdfPath, result.toc);
process.stdout.write(
  `${JSON.stringify({ pdfPath: result.pdfPath, inspection, toc }, null, 2)}\n`,
);
