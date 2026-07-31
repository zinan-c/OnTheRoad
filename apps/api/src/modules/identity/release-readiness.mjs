const REQUIRED_STAGING_FIELDS = [
  "OTR_OIDC_ISSUER",
  "OTR_OIDC_CLIENT_ID",
  "OTR_OIDC_CLIENT_SECRET",
  "OTR_OIDC_CALLBACK_URL",
  "OTR_OIDC_POST_LOGOUT_REDIRECT_URL",
  "OTR_APP_ORIGIN",
];

/** @param {Readonly<Record<string, string | undefined>>} environment */
export function inspectStagingIdentityReadiness(environment) {
  const missing = REQUIRED_STAGING_FIELDS.filter(
    (field) => !environment[field]?.trim(),
  );
  const invalid = [];
  for (const field of [
    "OTR_OIDC_ISSUER",
    "OTR_OIDC_CALLBACK_URL",
    "OTR_OIDC_POST_LOGOUT_REDIRECT_URL",
    "OTR_APP_ORIGIN",
  ]) {
    const value = environment[field]?.trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || value.includes("*")) invalid.push(field);
    } catch {
      invalid.push(field);
    }
  }
  if (environment.OTR_DEV_IDENTITY_ENABLED !== "false") {
    invalid.push("OTR_DEV_IDENTITY_ENABLED");
  }
  if (environment.OTR_IDENTITY_STORE !== "redis") {
    invalid.push("OTR_IDENTITY_STORE");
  }
  if (!["staging", "production"].includes(environment.NODE_ENV ?? "")) {
    invalid.push("NODE_ENV");
  }
  return missing.length === 0 && invalid.length === 0
    ? { status: "ready", missing: [], invalid: [] }
    : {
        status: "blocked",
        missing,
        invalid: [...new Set(invalid)],
        reason:
          "Real Staging IdP smoke requires exact HTTPS metadata, externally supplied credentials, Redis identity state, and development identity disabled",
      };
}
