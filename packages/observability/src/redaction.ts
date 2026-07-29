const SENSITIVE_KEY =
  /(?:^|[._-])(?:address|authorization|contact|cookie|credential|phone|secret|signature|signed|token|api[._-]?key|provider[._-]?key|url)(?:$|[._-])/iu;
const PHONE =
  /(?<![0-9])(?:\+?[0-9]{1,3}[\s-]?)?(?:[0-9][\s-]?){7,14}(?![0-9])/gu;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const SIGNED_QUERY =
  /([?&](?:x-amz-signature|signature|sig|token|access_token)=)[^&#\s]+/giu;

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/([a-z0-9])([A-Z])/gu, "$1_$2");
  return SENSITIVE_KEY.test(normalized);
}

function redactString(value: string): string {
  return value
    .replace(BEARER, "Bearer [REDACTED]")
    .replace(SIGNED_QUERY, "$1[REDACTED]")
    .replace(PHONE, "[REDACTED]");
}

export function redactTelemetryData(value: unknown, key = ""): unknown {
  if (isSensitiveKey(key)) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactTelemetryData(item, key));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        redactTelemetryData(child, childKey),
      ]),
    );
  }
  return value;
}
