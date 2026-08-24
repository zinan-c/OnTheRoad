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
      && response.url().endsWith("/gallery/reorder")
      && response.ok()),
    gallery.getByRole("button", { name: "后移图片" }).first().click(),
  ]);

  const cardForCaption = (scope: typeof gallery, caption: string) =>
    scope.locator("article.galleryCard").filter({
      has: page.getByRole("button", { name: caption, exact: true }),
    });
  const domCaptions = (scope: typeof gallery) =>
    scope.locator("article.galleryCard .galleryPreview")
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));

  await expect.poll(() => domCaptions(gallery)).toEqual(["出发", "抵达"]);
  const coverCard = cardForCaption(gallery, "出发");
  await Promise.all([
    page.waitForResponse((response) =>
      response.request().method() === "PATCH"
      && response.url().includes("/gallery")
      && response.ok()),
    coverCard.getByRole("button", { name: "设为封面" }).click(),
  ]);
  await expect(coverCard.getByRole("button", { name: "设为封面" }))
    .toHaveAttribute("aria-pressed", "true");

  await coverCard.getByRole("button", { name: "出发", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "图片灯箱" })).toBeVisible();
  await page.getByRole("button", { name: "关闭灯箱" }).click();
  await page.reload();

  const refreshed = page.getByRole("region", { name: "真实图片画廊" });
  await expect(refreshed.locator('article.galleryCard[data-status="ready"]')).toHaveCount(2);
  await expect.poll(() => domCaptions(refreshed)).toEqual(["出发", "抵达"]);
  await expect(cardForCaption(refreshed, "出发").getByLabel("说明")).toHaveValue("出发");
  await expect(cardForCaption(refreshed, "抵达").getByLabel("说明")).toHaveValue("抵达");
  await expect(cardForCaption(refreshed, "出发").getByRole("button", { name: "设为封面" }))
    .toHaveAttribute("aria-pressed", "true");
});
