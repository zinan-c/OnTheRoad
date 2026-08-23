import type { ProviderCapability } from "./providers.js";

export type ProviderErrorCode =
  | "PROVIDER_CAPABILITY_UNSUPPORTED"
  | "PROVIDER_ATTRIBUTION_MISSING"
  | "PROVIDER_REQUEST_INVALID"
  | "PROVIDER_CREDENTIALS_MISSING"
  | "PROVIDER_CREDENTIALS_INVALID"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_RESPONSE_INVALID"
  | "PROVIDER_UNAVAILABLE";

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly capability?: ProviderCapability,
    readonly details: Readonly<{
      readonly status?: number;
      readonly retryAfterSeconds?: number;
      readonly provider?: string;
    }> = {},
  ) {
    super(message);
    this.name = "ProviderError";
  }

  get status(): number | undefined { return this.details.status; }

  get retryAfterSeconds(): number | undefined { return this.details.retryAfterSeconds; }
}

export function unsupportedCapability(capability: ProviderCapability): ProviderError {
  return new ProviderError(
    "PROVIDER_CAPABILITY_UNSUPPORTED",
    `Provider capability is unavailable: ${capability}`,
    false,
    capability,
  );
}

export function validateProviderAttribution(value: string): string {
  const attribution = value.trim();
  if (!attribution) {
    throw new ProviderError(
      "PROVIDER_ATTRIBUTION_MISSING",
      "Provider attribution is required",
      false,
    );
  }
  return attribution;
}

export function mapProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  return new ProviderError(
    "PROVIDER_UNAVAILABLE",
    "Provider operation failed",
    true,
  );
}
