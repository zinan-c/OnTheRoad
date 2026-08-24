// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { generatedOperations } from "@on-the-road/contracts";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

import { LoginForm } from "./login-form";

afterEach(() => {
  cleanup();
  replace.mockReset();
  vi.restoreAllMocks();
});

test("posts credentials without persisting the password and routes forced change", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
    JSON.stringify({ mustChangePassword: true }),
    { status: 200, headers: { "content-type": "application/json" } },
  ));
  window.history.replaceState({}, "", "/login?returnTo=%2Ftrips");
  const user = userEvent.setup();
  render(<LoginForm />);
  await user.type(screen.getByLabelText("用户名"), "adminA");
  await user.type(screen.getByLabelText("密码"), "Admin_1234");
  await user.click(screen.getByRole("button", { name: "登录" }));

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining(generatedOperations.createPasswordSession.path),
    expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ username: "adminA", password: "Admin_1234" }),
    }),
  );
  expect(replace).toHaveBeenCalledWith("/account/change-password?returnTo=%2Ftrips");
  expect(document.body.textContent).not.toContain("Admin_1234");
});

test("uses one generic error for rejected credentials", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    type: "about:blank",
    title: "Invalid credentials",
    status: 401,
    code: "IDENTITY_INVALID_CREDENTIALS",
    traceId: "login-test",
    errors: [],
  }), { status: 401, headers: { "content-type": "application/problem+json" } }));
  const user = userEvent.setup();
  render(<LoginForm />);
  await user.type(screen.getByLabelText("用户名"), "adminA");
  await user.type(screen.getByLabelText("密码"), "wrong-password");
  await user.click(screen.getByRole("button", { name: "登录" }));
  expect((await screen.findByRole("alert")).textContent).toContain("用户名或密码错误");
});
