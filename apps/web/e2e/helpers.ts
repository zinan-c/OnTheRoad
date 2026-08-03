import { expect, type Page } from "@playwright/test";

export const apiOrigin = "http://localhost:3001";

export async function createTripWorkspace(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("link", { name: "创建我的旅行" }).click();
  await page.getByLabel("旅行名称").fill(name);
  await page.getByRole("button", { name: "创建旅行" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/u);
  const tripId = page.url().split("/").at(-1)!;
  await page.evaluate(async ({ tripId, apiOrigin }) => {
    const request = async (path: string, init?: RequestInit) => {
      const response = await fetch(`${apiOrigin}/api/v1${path}`, {
        ...init,
        credentials: "include",
        headers: { accept: "application/json", ...init?.headers },
      });
      if (!response.ok) throw new Error(`${response.status} ${path}: ${await response.text()}`);
      return response.status === 204 ? undefined : await response.json();
    };
    const days = await request(`/trips/${tripId}/days`) as { id: string }[];
    for (let index = 0; index < 3; index += 1) {
      await request(`/trips/${tripId}/days/${days[0].id}/itinerary-items`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemType: "attraction", timeKind: "period", timePeriod: "morning", target: `地点${index + 1}` }) });
    }
  }, { tripId, apiOrigin });
  await page.reload();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByRole("button", { name: "地点1", exact: true })).toBeVisible();
  return tripId;
}
