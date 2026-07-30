/** @param {{apiOrigin: string, returnTo?: string}} options */
export function createIdentityLinks({ apiOrigin, returnTo = "/" }) {
  const origin = new URL(apiOrigin).origin;
  const login = new URL("/identity/login", origin);
  const safeReturnTo =
    typeof returnTo === "string"
    && returnTo.startsWith("/")
    && !returnTo.startsWith("//")
      ? returnTo
      : "/";
  login.searchParams.set("returnTo", safeReturnTo);
  return Object.freeze({
    loginHref: login.href,
    logoutHref: new URL("/identity/logout", origin).href,
  });
}
