import { expect, test } from "@playwright/test";

test("TC-B04-03 creates a Trip through the real HTTP API and restores its session", async ({
  page,
}) => {
  await page.goto("/");
  const capabilityResponse = await page.evaluate(async () => {
    try {
      const response = await fetch("http://localhost:3001/api/v1/system/capabilities", {
        credentials: "include",
      });
      return { ok: response.ok, status: response.status, body: await response.text() };
    } catch (error) {
      return { ok: false, status: 0, body: String(error) };
    }
  });
  expect(capabilityResponse).toMatchObject({ ok: true, status: 200 });
  await expect(page.getByText(/服务已就绪/u)).toBeVisible();
  await page.getByRole("link", { name: "创建我的旅行" }).click();

  await expect(page.getByRole("heading", { name: "创建一段新旅程" })).toBeVisible();
  await page.getByLabel("旅行名称").fill("Playwright 东海之旅");
  await expect(page.getByText("将自动生成 5 天计划")).toBeVisible();
  await page.getByRole("button", { name: "创建旅行" }).click();

  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/u);
  await expect(page.getByRole("heading", { name: "Playwright 东海之旅" })).toBeVisible();
  const tripId = page.url().split("/").at(-1)!;

  const workspace = await page.evaluate(async ({ tripId }) => {
    const request = async (
      path: string,
      init?: RequestInit,
    ): Promise<{ status: number; body: any; etag: string | null }> => {
      const response = await fetch(`http://localhost:3001/api/v1${path}`, {
        ...init,
        credentials: "include",
        headers: {
          accept: "application/json, application/problem+json",
          ...init?.headers,
        },
      });
      return {
        status: response.status,
        body: response.status === 204 ? null : await response.json(),
        etag: response.headers.get("etag"),
      };
    };
    const days = await request(`/trips/${tripId}/days`);
    const firstDayId = days.body[0].id;
    const secondDayId = days.body[1].id;
    const create = (target: string) =>
      request(`/trips/${tripId}/days/${firstDayId}/itinerary-items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemType: "attraction",
          timeKind: "period",
          timePeriod: "morning",
          target,
        }),
      });
    const first = await create("外滩");
    const second = await create("豫园");
    const updated = await request(
      `/trips/${tripId}/itinerary-items/${first.body.id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "if-match": "1",
        },
        body: JSON.stringify({ target: "外滩夜景" }),
      },
    );
    const stale = await request(
      `/trips/${tripId}/itinerary-items/${first.body.id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "if-match": "1",
        },
        body: JSON.stringify({ target: "陈旧写入" }),
      },
    );
    const reordered = await request(
      `/trips/${tripId}/days/${firstDayId}/itinerary-items/reorder`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseVersion: 1,
          orderedIds: [second.body.id, first.body.id],
        }),
      },
    );
    const copied = await request(
      `/trips/${tripId}/itinerary-items/${second.body.id}/copy`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetTripDayId: secondDayId }),
      },
    );
    const deleted = await request(
      `/trips/${tripId}/itinerary-items/${copied.body.id}`,
      {
        method: "DELETE",
        headers: { "if-match": "1" },
      },
    );
    const location = await request(`/trips/${tripId}/locations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputText: "上海外滩" }),
    });
    const adjusted = await request(
      `/trips/${tripId}/locations/${location.body.id}/coordinates`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "if-match": String(location.body.version),
        },
        body: JSON.stringify({
          longitude: 121.49002,
          latitude: 31.24001,
        }),
      },
    );
    const refreshed = await request(
      `/trips/${tripId}/days/${firstDayId}/itinerary-items`,
    );
    return {
      dayCount: days.body.length,
      createStatuses: [first.status, second.status],
      updated,
      stale,
      reordered,
      copied,
      deleted,
      adjusted,
      refreshed,
    };
  }, { tripId });
  expect(workspace.dayCount).toBe(5);
  expect(workspace.createStatuses).toEqual([201, 201]);
  expect(workspace.updated).toMatchObject({
    status: 200,
    body: { target: "外滩夜景", version: 2 },
  });
  expect(workspace.stale).toMatchObject({
    status: 409,
    body: { code: "ITINERARY_VERSION_CONFLICT" },
  });
  expect(workspace.reordered).toMatchObject({ status: 200 });
  expect(workspace.copied).toMatchObject({ status: 201 });
  expect(workspace.deleted).toMatchObject({
    status: 200,
    body: { deletedAt: expect.any(String) },
  });
  expect(workspace.adjusted).toMatchObject({
    status: 200,
    body: {
      status: "resolved",
      manuallyAdjusted: true,
    },
  });
  expect(workspace.refreshed.body.map(({ target }: { target: string }) => target))
    .toEqual(["豫园", "外滩夜景"]);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Playwright 东海之旅" })).toBeVisible();

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("heading", { name: "会话已退出" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "会话已退出" })).toBeVisible();
  await page.getByRole("button", { name: "重新登录" }).click();
  await expect(page.getByRole("heading", { name: "Playwright 东海之旅" })).toBeVisible();
});

test("REVIEW-P1-04 keeps the core creation path usable at the project viewport", async ({
  page,
}, testInfo) => {
  await page.goto("/trips/new");
  await expect(page.getByRole("form", { name: "新建旅行" })).toBeVisible();
  const viewport = page.viewportSize();
  if (testInfo.project.name === "mobile-chromium") {
    expect(viewport?.width).toBeLessThanOrEqual(420);
    await expect(page.getByLabel("旅行名称")).toBeInViewport();
    const submit = page.getByRole("button", { name: "创建旅行" });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
  }
});
