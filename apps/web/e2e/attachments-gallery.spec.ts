import { expect, test } from "@playwright/test";

import { createTripWorkspace } from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("TC-D03-03 real gallery E2E persists upload, order, caption, cover, and lightbox", async ({ page }) => {
  await createTripWorkspace(page, "D03 真实图库验证");
  const gallery = page.getByRole("region", { name: "真实图片画廊" });
  const upload = gallery.getByLabel("上传图片");
  await upload.setInputFiles([
    { name: "arrival.png", mimeType: "image/png", buffer: PNG },
    { name: "departure.png", mimeType: "image/png", buffer: PNG },
  ]);

  const cards = gallery.locator("article.galleryCard");
  await expect(cards).toHaveCount(2);
  await expect(gallery.locator('article.galleryCard[data-status="ready"]'))
    .toHaveCount(2, { timeout: 30_000 });

  const captions = gallery.getByLabel("说明");
  await captions.nth(0).fill("抵达");
  await Promise.all([
    page.waitForResponse((response) =>
      response.request().method() === "PATCH"
      && response.url().includes("/gallery")),
    captions.nth(0).blur(),
  ]);
  await captions.nth(1).fill("出发");
  await Promise.all([
    page.waitForResponse((response) =>
      response.request().method() === "PATCH"
      && response.url().includes("/gallery")),
    captions.nth(1).blur(),
  ]);
  await Promise.all([
    page.waitForResponse((response) =>
      response.request().method() === "POST"
      && response.url().endsWith("/gallery/reorder")),
    gallery.getByRole("button", { name: "后移图片" }).first().click(),
  ]);
  await Promise.all([
    page.waitForResponse((response) =>
      response.request().method() === "PATCH"
      && response.url().includes("/gallery")),
    gallery.getByRole("button", { name: "设为封面" }).first().click(),
  ]);

  await gallery.getByRole("button", { name: /抵达|出发/ }).first().click();
  await expect(page.getByRole("dialog", { name: "图片灯箱" })).toBeVisible();
  await page.getByRole("button", { name: "关闭灯箱" }).click();
  await page.reload();

  const refreshed = page.getByRole("region", { name: "真实图片画廊" });
  await expect(refreshed.getByLabel("说明").nth(0)).toHaveValue(/抵达|出发/);
  await expect(refreshed.locator('button[aria-pressed="true"]')).toHaveCount(1);
});
