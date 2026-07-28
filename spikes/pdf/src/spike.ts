import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import {
  access,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const spikeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(spikeDir, "../..");
const fixtureDir = path.join(repoRoot, "packages/test-fixtures/pdf");
const defaultFontPath = path.join(
  repoRoot,
  "apps/pdf-worker/fonts/NotoSansCJKsc-Regular.otf",
);
const expectedFontSha256 =
  "c3a9f5223868ca3a2b2e576d8113713b38e8fd8b08a7534b7f018cdecc34874d";

function compatibleChromiumPath(expected: string): string {
  if (existsSync(expected)) return expected;

  let expectedBrowserDir = path.dirname(expected);
  while (
    !path.basename(expectedBrowserDir).startsWith("chromium-") &&
    path.dirname(expectedBrowserDir) !== expectedBrowserDir
  ) {
    expectedBrowserDir = path.dirname(expectedBrowserDir);
  }
  const cacheRoot = path.dirname(expectedBrowserDir);
  const suffix = path.relative(expectedBrowserDir, expected);
  if (!existsSync(cacheRoot)) return expected;

  for (const directory of readdirSync(cacheRoot)
    .filter((name) => name.startsWith("chromium-"))
    .sort()
    .reverse()) {
    const candidate = path.join(cacheRoot, directory, suffix);
    if (existsSync(candidate)) return candidate;
  }
  return expected;
}

export class ResourceTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceTimeoutError";
  }
}

export interface TocEntry {
  anchor: string;
  label: string;
  page: number;
}

export interface GenerateOptions {
  outputDir: string;
  orientation?: "portrait" | "landscape";
  resourceTimeoutMs?: number;
  injectResourceDelayMs?: number;
  fontPath?: string;
  keepIntermediate?: boolean;
}

interface Fixture {
  fixtureVersion: string;
  title: string;
  subtitle: string;
  chapters: number;
  mapAttribution: string;
  mapAsset: string;
  cjkProbe: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function loadPlaywright(): Promise<any> {
  return require("@playwright/test");
}

async function resolveFont(fontPath?: string): Promise<string> {
  const selected = fontPath ?? process.env.OTR_A11_FONT_PATH ?? defaultFontPath;
  try {
    await access(selected);
    const digest = createHash("sha256")
      .update(await readFile(selected))
      .digest("hex");
    if (digest !== expectedFontSha256) {
      throw new Error(
        `A11_FIXED_FONT_CHECKSUM_MISMATCH: expected ${expectedFontSha256}, got ${digest}`,
      );
    }
    return selected;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("A11_FIXED_FONT_CHECKSUM_MISMATCH")
    ) {
      throw error;
    }
    throw new Error(
      `A11_FIXED_FONT_MISSING: expected Noto Sans CJK SC at ${selected}. ` +
        "Provide OTR_A11_FONT_PATH; system fallback is intentionally rejected.",
    );
  }
}

async function waitForResources(
  page: any,
  timeoutMs: number,
  injectedDelayMs: number,
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new ResourceTimeoutError(`resources not ready in ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  const readiness = (async () => {
    if (injectedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, injectedDelayMs));
    }
    await page.evaluate(async () => {
      await document.fonts.ready;
      const images = Array.from(document.images);
      await Promise.all(
        images.map(async (image) => {
          if (!image.complete) {
            await new Promise<void>((resolve, reject) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener("error", () => reject(new Error("image failed")), {
                once: true,
              });
            });
          }
          await image.decode();
        }),
      );
    });
  })();
  try {
    await Promise.race([readiness, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function pageChrome(pageNumber: number): string {
  return `
    <header>On The Road · PDF Spike Header</header>
    <footer>上海到舟山 · 第 ${pageNumber} 页 / 50</footer>
  `;
}

function renderHtml(
  fixture: Fixture,
  fontData: string,
  mapData: string,
  toc: TocEntry[] | null,
  orientation: "portrait" | "landscape",
): string {
  const tocEntries = Array.from({ length: fixture.chapters }, (_, index) => {
    const chapter = index + 1;
    const known = toc?.[index];
    const pageNumber = known?.page ?? "—";
    return `<li><span>第 ${chapter.toString().padStart(2, "0")} 节 · 城市与海岛</span><b>${pageNumber}</b></li>`;
  }).join("");
  const machineToc = toc
    ? toc
        .map((entry) => `<i class="machine">TOC_${entry.anchor}_PAGE_${entry.page}</i>`)
        .join("")
    : "";
  const mapMime = fixture.mapAsset.endsWith(".png") ? "image/png" : "image/svg+xml";
  const pageWidth = orientation === "portrait" ? "210mm" : "297mm";
  const pageHeight = orientation === "portrait" ? "296mm" : "209mm";
  const chapters = Array.from({ length: fixture.chapters }, (_, index) => {
    const chapter = index + 1;
    const physicalPage = chapter + 2;
    const anchor = `A11_${chapter.toString().padStart(2, "0")}`;
    const map =
      chapter % 8 === 1
        ? `<figure><img src="data:${mapMime};base64,${mapData}" alt="上海至普陀山固定静态地图"><figcaption>${escapeHtml(fixture.mapAttribution)}</figcaption></figure>`
        : "";
    return `<section class="page chapter">
      ${pageChrome(physicalPage)}
      <span class="machine">ANCHOR_${anchor}</span>
      <p class="eyebrow">DAY ${(chapter % 5) + 1} · CHAPTER ${chapter}</p>
      <h1>第 ${chapter.toString().padStart(2, "0")} 节 · 城市与海岛</h1>
      <p class="lead">${escapeHtml(fixture.cjkProbe)} English typography remains selectable and searchable.</p>
      ${map}
      <div class="card">
        <h2>行程摘要</h2>
        <p>从上海出发，经舟山抵达普陀山。这里包含超长备注、标点、数字 2026，以及用于验证换行的中英混排内容。</p>
        <p>${"海风、码头、步行与轮渡。".repeat(18)}</p>
      </div>
    </section>`;
  }).join("");
  return `<!doctype html>
  <html lang="zh-CN"><head><meta charset="utf-8"><style>
    @font-face { font-family: "NotoSansCJKsc"; src: url(data:font/otf;base64,${fontData}) format("opentype"); font-weight: 100 900; }
    @page { size: A4 ${orientation}; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: white; color: #20302d; font-family: "NotoSansCJKsc"; }
    .page { width: ${pageWidth}; height: ${pageHeight}; padding: 23mm 17mm 20mm; position: relative; overflow: hidden; break-after: page; page-break-after: always; }
    .page:last-child { break-after: auto; page-break-after: auto; }
    header { position: absolute; left: 17mm; right: 17mm; top: 9mm; padding-bottom: 3mm; border-bottom: .3mm solid #9aa8a4; font-size: 9pt; letter-spacing: .08em; }
    footer { position: absolute; left: 17mm; right: 17mm; bottom: 8mm; padding-top: 3mm; border-top: .3mm solid #9aa8a4; text-align: right; font-size: 8pt; }
    .cover { background: #163f3a; color: #fff; display: flex; flex-direction: column; justify-content: center; }
    .cover h1 { font-size: 36pt; line-height: 1.18; margin: 0 0 8mm; }
    .cover p { font-size: 15pt; }
    .toc h1, .chapter h1 { font-size: 25pt; margin: 3mm 0 8mm; }
    .toc ol { columns: 2; column-gap: 10mm; padding: 0; margin: 0; list-style: none; font-size: 8.5pt; }
    .toc li { display: flex; justify-content: space-between; gap: 3mm; padding: 1.2mm 0; border-bottom: .2mm dotted #9aa8a4; break-inside: avoid; }
    .eyebrow { color: #b9472e; font-size: 9pt; font-weight: 700; letter-spacing: .12em; margin: 2mm 0; }
    .lead { font-size: 13pt; line-height: 1.75; }
    .card { border: .35mm solid #b9c5c1; border-radius: 3mm; padding: 5mm; margin-top: 7mm; font-size: 10pt; line-height: 1.65; max-height: 98mm; overflow: hidden; }
    .card h2 { margin: 0 0 2mm; }
    figure { margin: 5mm 0; break-inside: avoid; }
    figure img { width: 100%; height: 72mm; object-fit: contain; border: .3mm solid #b9c5c1; }
    figcaption { font-size: 7.5pt; margin-top: 1mm; }
    .machine { color: transparent; font-size: 1px; line-height: 1px; position: absolute; left: 1mm; top: 1mm; }
  </style></head><body>
    <section class="page cover">${pageChrome(1)}<h1>${escapeHtml(fixture.title)}</h1><p>${escapeHtml(fixture.subtitle)}</p><p>固定字体 · 精确目录 · 静态地图 · 50 页</p></section>
    <section class="page toc">${pageChrome(2)}<h1>目录</h1><ol>${tocEntries}</ol>${machineToc}</section>
    ${chapters}
  </body></html>`;
}

async function renderPdf(
  htmlPath: string,
  pdfPath: string,
  timeoutMs: number,
  injectDelayMs: number,
  orientation: "portrait" | "landscape",
): Promise<void> {
  const { chromium } = await loadPlaywright();
  const executablePath =
    process.env.OTR_A11_CHROMIUM_PATH
    ?? compatibleChromiumPath(chromium.executablePath());
  const disableSandbox = process.env.OTR_A11_DISABLE_CHROMIUM_SANDBOX === "1";
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: disableSandbox
      ? ["--disable-dev-shm-usage", "--no-sandbox"]
      : ["--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, {
      waitUntil: "load",
      timeout: Math.max(timeoutMs, 2_000),
    });
    await waitForResources(page, timeoutMs, injectDelayMs);
    await page.pdf({
      path: pdfPath,
      format: "A4",
      landscape: orientation === "landscape",
      printBackground: true,
      displayHeaderFooter: false,
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }
}

async function pageText(pdfPath: string, page: number): Promise<string> {
  const { stdout } = await execFileAsync("pdftotext", [
    "-f",
    String(page),
    "-l",
    String(page),
    "-layout",
    pdfPath,
    "-",
  ]);
  return stdout;
}

async function deriveToc(pdfPath: string, chapters: number): Promise<TocEntry[]> {
  const result: TocEntry[] = [];
  for (let page = 1; page <= chapters + 2; page += 1) {
    const text = await pageText(pdfPath, page);
    const match = text.match(/ANCHOR_A11_(\d{2})/);
    if (match) {
      const chapter = Number(match[1]);
      result.push({
        anchor: `A11_${match[1]}`,
        label: `第 ${match[1]} 节 · 城市与海岛`,
        page,
      });
      if (chapter !== result.length) {
        throw new Error(`A11_ANCHOR_ORDER_MISMATCH at page ${page}`);
      }
    }
  }
  if (result.length !== chapters) {
    throw new Error(`A11_ANCHORS_MISSING: expected ${chapters}, got ${result.length}`);
  }
  return result;
}

export async function generateSpikePdf(options: GenerateOptions): Promise<{
  pdfPath: string;
  toc: TocEntry[];
}> {
  const timeoutMs = options.resourceTimeoutMs ?? 10_000;
  const injectDelayMs = options.injectResourceDelayMs ?? 0;
  const orientation = options.orientation ?? "portrait";
  await mkdir(options.outputDir, { recursive: true });
  const pdfPath = path.join(options.outputDir, "trip.pdf");
  const draftPdfPath = path.join(options.outputDir, "trip-draft.pdf");
  const draftHtmlPath = path.join(options.outputDir, "trip-draft.html");
  const finalHtmlPath = path.join(options.outputDir, "trip.html");
  await rm(pdfPath, { force: true });

  const fixture = JSON.parse(
    await readFile(path.join(fixtureDir, "fixture.json"), "utf8"),
  ) as Fixture;
  const fontPath = await resolveFont(options.fontPath);
  const [font, map] = await Promise.all([
    readFile(fontPath),
    readFile(path.join(fixtureDir, fixture.mapAsset)),
  ]);
  const fontData = font.toString("base64");
  const mapData = map.toString("base64");

  try {
    await writeFile(
      draftHtmlPath,
      renderHtml(fixture, fontData, mapData, null, orientation),
    );
    await renderPdf(draftHtmlPath, draftPdfPath, timeoutMs, injectDelayMs, orientation);
    const toc = await deriveToc(draftPdfPath, fixture.chapters);
    await writeFile(
      finalHtmlPath,
      renderHtml(fixture, fontData, mapData, toc, orientation),
    );
    await renderPdf(finalHtmlPath, pdfPath, timeoutMs, injectDelayMs, orientation);
    const verification = await verifyExactToc(pdfPath, toc);
    if (verification.mismatches.length > 0) {
      await rm(pdfPath, { force: true });
      throw new Error(`A11_TOC_MISMATCH: ${verification.mismatches.join(", ")}`);
    }
    return { pdfPath, toc };
  } catch (error) {
    await rm(pdfPath, { force: true });
    throw error;
  } finally {
    if (!options.keepIntermediate) {
      await Promise.all([
        rm(draftPdfPath, { force: true }),
        rm(draftHtmlPath, { force: true }),
        rm(finalHtmlPath, { force: true }),
      ]);
    }
  }
}

export async function inspectPdf(pdfPath: string): Promise<{
  pageCount: number;
  pageWidthPoints: number;
  pageHeightPoints: number;
  text: string;
  headerOccurrences: number;
  footerOccurrences: number;
  fontNames: string[];
}> {
  const [{ stdout: info }, { stdout: text }, { stdout: fonts }] = await Promise.all([
    execFileAsync("pdfinfo", [pdfPath]),
    execFileAsync("pdftotext", ["-layout", pdfPath, "-"]),
    execFileAsync("pdffonts", [pdfPath]),
  ]);
  const pageMatch = info.match(/^Pages:\s+(\d+)$/m);
  const sizeMatch = info.match(/^Page size:\s+([\d.]+) x ([\d.]+) pts/m);
  if (!pageMatch) throw new Error("A11_PDFINFO_MISSING_PAGE_COUNT");
  if (!sizeMatch) throw new Error("A11_PDFINFO_MISSING_PAGE_SIZE");
  return {
    pageCount: Number(pageMatch[1]),
    pageWidthPoints: Number(sizeMatch[1]),
    pageHeightPoints: Number(sizeMatch[2]),
    text,
    headerOccurrences: text.match(/On The Road · PDF Spike Header/g)?.length ?? 0,
    footerOccurrences: text.match(/第 \d+ 页 \/ 50/g)?.length ?? 0,
    fontNames: fonts
      .split("\n")
      .slice(2)
      .map((line: string) => line.trim().split(/\s+/)[0])
      .filter(Boolean),
  };
}

export async function verifyExactToc(
  pdfPath: string,
  expected: TocEntry[],
): Promise<{ entries: TocEntry[]; mismatches: string[] }> {
  const tocText = await pageText(pdfPath, 2);
  const entries: TocEntry[] = [];
  const mismatches: string[] = [];
  for (const entry of expected) {
    const marker = new RegExp(`TOC_${entry.anchor}_PAGE_(\\d+)`);
    const printed = tocText.match(marker);
    if (!printed) {
      mismatches.push(`${entry.anchor}:missing-toc-marker`);
      continue;
    }
    const printedPage = Number(printed[1]);
    const physicalText = await pageText(pdfPath, printedPage);
    if (!physicalText.includes(`ANCHOR_${entry.anchor}`)) {
      mismatches.push(`${entry.anchor}:printed-${printedPage}-wrong-physical-page`);
      continue;
    }
    entries.push({ ...entry, page: printedPage });
  }
  return { entries, mismatches };
}
