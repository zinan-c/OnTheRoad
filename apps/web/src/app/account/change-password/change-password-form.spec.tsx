// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const { replace, getCurrentSession } = vi.hoisted(() => ({ replace: vi.fn(), getCurrentSession: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

vi.mock("../../../features/identity/auth-gate", () => ({
  getCurrentSession,
  loginHref: (value: string) => `/login?returnTo=${encodeURIComponent(value)}`,
  safeReturnTo: (value: string | null | undefined) => value ?? "/trips",
}));

import { ChangePasswordForm } from "./change-password-form";

afterEach(() => {
  cleanup();
  replace.mockReset();
  getCurrentSession.mockReset();
  vi.restoreAllMocks();
});

test("changes the forced password without putting it in a URL or local storage", async () => {
  getCurrentSession.mockResolvedValue({
    principal: { id: "principal-a" },
    account: { username: "adminA", role: "admin", mustChangePassword: true },
  });
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
    JSON.stringify({ mustChangePassword: false }),
    { status: 200, headers: { "content-type": "application/json" } },
  ));
  window.history.replaceState({}, "", "/account/change-password?returnTo=%2Ftrips");
  const user = userEvent.setup();
  render(<ChangePasswordForm />);
  await user.type(await screen.findByLabelText("新密码"), "New_Admin_1234!");
  await user.type(screen.getByLabelText("确认新密码"), "New_Admin_1234!");
  await user.click(screen.getByRole("button", { name: "保存新密码" }));

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/api/v1/identity/password"),
    expect.objectContaining({
      method: "PUT",
      credentials: "include",
      body: JSON.stringify({ password: "New_Admin_1234!" }),
    }),
  );
  expect(replace).toHaveBeenCalledWith("/trips");
  expect(window.location.href).not.toContain("New_Admin_1234");
});
