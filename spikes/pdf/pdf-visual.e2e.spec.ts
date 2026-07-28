import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { generateSpikePdf } from "./src/spike.ts";

const execFileAsync = promisify(execFile);

interface PageEvidence {
  page: number;
  width: number;
  height: number;
  standardDeviation: number;
  edgeMean: number;
  pngBytes: number;
}

async function identify(imagePath: string): Promise<PageEvidence> {
  const { stdout } = await execFileAsync("identify", [
    "-format",
    "%w %h %[fx:standard_deviation] %[fx:(mean)] %b",
    imagePath,
  ]);
  const [width, height, deviation, mean, bytes] = stdout.trim().split(/\s+/);
  return {
    page: 0,
    width: Number(width),
    height: Number(height),
    standardDeviation: Number(deviation),
    edgeMean: Number(mean),
    pngBytes: Number(bytes.replaceAll(/[^0-9]/g, "")),
  };
}

async function edgeMean(imagePath: string, width: number, height: number): Promise<number> {
  const geometries = [
    `${width}x3+0+0`,
    `${width}x3+0+${height - 3}`,
    `3x${height}+0+0`,
    `3x${height}+${width - 3}+0`,
  ];
  const values = await Promise.all(
    geometries.map(async (geometry) => {
      const { stdout } = await execFileAsync("convert", [
        imagePath,
        "-crop",
        geometry,
        "+repage",
        "-format",
        "%[fx:mean]",
        "info:",
      ]);
      return Number(stdout.trim());
    }),
  );
  return Math.min(...values);
}

test("TC-A11-03 renders and inspects every physical page", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "otr-a11-visual-"));
  const pagesDir = path.join(outputDir, "pages");
  await mkdir(pagesDir);
  const result = await generateSpikePdf({ outputDir });

  await execFileAsync("pdftoppm", [
    "-png",
    "-r",
    "110",
    result.pdfPath,
    path.join(pagesDir, "page"),
  ]);
  const images = (await readdir(pagesDir))
    .filter((name) => /^page-\d+\.png$/.test(name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  assert.equal(images.length, 50);

  const evidence: PageEvidence[] = [];
  for (const [index, name] of images.entries()) {
    const imagePath = path.join(pagesDir, name);
    const page = { ...(await identify(imagePath)), page: index + 1 };
    assert.ok(page.width >= 900 && page.width <= 920, `page ${page.page} width`);
    assert.ok(page.height >= 1270 && page.height <= 1300, `page ${page.page} height`);
    assert.ok(
      page.standardDeviation > 0.018,
      `page ${page.page} appears blank: deviation=${page.standardDeviation}`,
    );
    if (page.page > 1) {
      page.edgeMean = await edgeMean(imagePath, page.width, page.height);
      assert.ok(
        page.edgeMean > 0.985,
        `page ${page.page} has possible edge clipping: mean=${page.edgeMean}`,
      );
    }
    evidence.push(page);
  }

  const { stdout: mapPageText } = await execFileAsync("pdftotext", [
    "-f",
    "3",
    "-l",
    "3",
    result.pdfPath,
    "-",
  ]);
  assert.match(mapPageText, /Map fixture © OpenStreetMap contributors/);

  const evidenceDir = process.env.A11_EVIDENCE_DIR;
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await copyFile(result.pdfPath, path.join(evidenceDir, "a11-50-pages.pdf"));
    await writeFile(
      path.join(evidenceDir, "per-page-evidence.json"),
      `${JSON.stringify(
        {
          testCase: "TC-A11-03",
          pageCount: images.length,
          blankPages: evidence.filter((page) => page.standardDeviation <= 0.018),
          clippedPages: evidence.filter(
            (page) => page.page > 1 && page.edgeMean <= 0.985,
          ),
          pages: evidence,
        },
        null,
        2,
      )}\n`,
    );
    await execFileAsync("montage", [
      "-font",
      path.resolve("../../apps/pdf-worker/fonts/NotoSansCJKsc-Regular.otf"),
      "+label",
      ...images.map((name) => path.join(pagesDir, name)),
      "-thumbnail",
      "180x",
      "-tile",
      "5x10",
      "-geometry",
      "+4+4",
      path.join(evidenceDir, "all-pages-contact-sheet.png"),
    ]);
    await copyFile(
      path.join(pagesDir, images[0]),
      path.join(evidenceDir, "page-01-cover.png"),
    );
    await copyFile(
      path.join(pagesDir, images[1]),
      path.join(evidenceDir, "page-02-toc.png"),
    );
    await copyFile(
      path.join(pagesDir, images[2]),
      path.join(evidenceDir, "page-03-map.png"),
    );
  }
});
