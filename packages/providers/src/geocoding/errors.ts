export type GeocoderErrorCode =
  | "PROVIDER_CREDENTIALS_MISSING"
  | "PROVIDER_CREDENTIALS_INVALID"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_RESPONSE_INVALID"
  | "PROVIDER_PROFILE_UNSUPPORTED"
  | "PROVIDER_TRIGGER_UNSUPPORTED";

export class GeocoderError extends Error {
  constructor(
    readonly code: GeocoderErrorCode,
    message: string,
    readonly details: {
      readonly retryable?: boolean;
      readonly retryAfterSeconds?: number;
      readonly status?: number;
      readonly source?: "provider" | "client";
      readonly provider?: "here" | "amap" | "nominatim" | "hybrid" | "fixture";
    } = {},
  ) {
    super(message);
    this.name = "GeocoderError";
  }

  get provider(): "here" | "amap" | "nominatim" | "hybrid" | "fixture" {
    return this.details.provider ?? "here";
  }

  get retryable(): boolean {
    return this.details.retryable ?? false;
  }

  get retryAfterSeconds(): number | undefined {
    return this.details.retryAfterSeconds;
  }

  get status(): number | undefined {
    return this.details.status;
  }

  get source(): "provider" | "client" {
    return this.details.source ?? "provider";
  }
}
