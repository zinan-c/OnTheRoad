import { IdentityService } from "./service.mjs";
import { IdentityConfigurationError } from "./errors.mjs";

/** @param {unknown} value */
function enabled(value) {
  return value === "true";
}

/** @param {Readonly<Record<string, string | undefined>>} environment @param {string} name */
function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new IdentityConfigurationError(
      "IDENTITY_CONFIGURATION_REQUIRED",
      `${name} is required`,
    );
  }
  return value;
}

/** @param {Readonly<Record<string, string | undefined>>} environment */
export function createIdentityService(environment) {
  const runtime = environment.NODE_ENV?.trim() || "development";
  return new IdentityService({
    environment: runtime,
    developmentIdentityEnabled: enabled(environment.OTR_DEV_IDENTITY_ENABLED),
    appOrigin: required(environment, "OTR_APP_ORIGIN"),
    signingKeys: {
      active: {
        id: required(environment, "OTR_SESSION_SIGNING_KEY_ID"),
        secret: required(environment, "OTR_SESSION_SIGNING_KEY"),
      },
      ...(environment.OTR_SESSION_PREVIOUS_KEY_ID?.trim()
        && environment.OTR_SESSION_PREVIOUS_SIGNING_KEY?.trim()
        ? {
            previous: {
              id: environment.OTR_SESSION_PREVIOUS_KEY_ID.trim(),
              secret: environment.OTR_SESSION_PREVIOUS_SIGNING_KEY.trim(),
            },
          }
        : {}),
    },
  });
}
