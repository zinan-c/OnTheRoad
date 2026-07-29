// @ts-nocheck
const REQUIRED_STAGING_FIELDS = [
  "OTR_OIDC_ISSUER",
  "OTR_OIDC_CLIENT_ID",
  "OTR_OIDC_CLIENT_SECRET",
  "OTR_OIDC_CALLBACK_URL",
  "OTR_OIDC_POST_LOGOUT_REDIRECT_URL",
];

export function inspectStagingIdentityReadiness(environment) {
  const missing = REQUIRED_STAGING_FIELDS.filter(
    (field) => !environment[field]?.trim(),
  );
  return missing.length === 0
    ? { status: "ready", missing: [] }
    : {
        status: "blocked",
        missing,
        reason:
          "Real Staging IdP smoke requires registered HTTPS callbacks and externally supplied credentials",
      };
}
