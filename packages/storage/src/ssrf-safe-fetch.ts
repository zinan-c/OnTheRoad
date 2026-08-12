import { lookup as defaultLookup } from "node:dns/promises";
import { createHash } from "node:crypto";

export class SsrfSafeFetchError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 422) {
    super(message);
    this.name = "SsrfSafeFetchError";
    this.code = code;
    this.status = status;
  }
}

export type SafeFetchedMedia = Readonly<{
  body: Buffer;
  finalUrl: string;
  contentType: string;
  contentLength: number;
  checksumSha256: string;
  checksumSha256Base64: string;
}>;

type Lookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<readonly { address: string; family: number }[]>;

type SafeFetchOptions = Readonly<{
  fetch?: typeof globalThis.fetch;
  lookup?: Lookup;
  maximumBytes?: number;
  timeoutMs?: number;
  maximumRedirects?: number;
  allowedHosts?: readonly string[];
}>;

const MAXIMUM_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function ipv4Private(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const a = parts[0] ?? 255;
  const b = parts[1] ?? 255;
  return a === 0 || a === 10 || a === 100 && b >= 64 && b <= 127 || a === 127 || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31
    || a === 192 && (b === 0 || b === 2 || b === 168)
    || a === 198 && (b === 18 || b === 19 || b === 51)
    || a === 203 && b === 0
    || a >= 224;
}

function ipv6Private(address: string): boolean {
  const normalized = address.toLowerCase().split("%", 1)[0] ?? address.toLowerCase();
  return normalized === "::1"
    || normalized === "::"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb")
    || normalized.startsWith("ff");
}

function privateAddress(address: string): boolean {
  if (address.includes(".")) return ipv4Private(address);
  return ipv6Private(address);
}

function allowedHost(hostname: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true;
  const normalized = hostname.toLowerCase();
  return allowlist.some((entry) => {
    const candidate = entry.toLowerCase().replace(/^\*\./u, "");
    return normalized === candidate || normalized.endsWith(`.${candidate}`);
  });
}

function parseUrl(value: string, allowlist: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SsrfSafeFetchError("MEDIA_URL_INVALID", "The media URL is invalid.");
  }
  if (!(["http:", "https:"] as readonly string[]).includes(url.protocol)) {
    throw new SsrfSafeFetchError("MEDIA_URL_SCHEME_BLOCKED", "Only HTTP and HTTPS media URLs are allowed.");
  }
  if (url.username || url.password || !url.hostname || !allowedHost(url.hostname, allowlist)) {
    throw new SsrfSafeFetchError("MEDIA_URL_HOST_BLOCKED", "The media URL host is not allowed.");
  }
  return url;
}

async function assertPublicHost(url: URL, lookup: Lookup): Promise<void> {
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => privateAddress(address))) {
    throw new SsrfSafeFetchError("MEDIA_URL_PRIVATE_ADDRESS", "The media URL resolves to a private or reserved address.");
  }
}

async function assertStablePublicHost(url: URL, lookup: Lookup): Promise<void> {
  await assertPublicHost(url, lookup);
  const first = (await lookup(url.hostname, { all: true, verbatim: true }))
    .map(({ address }) => address)
    .sort()
    .join(",");
  const second = (await lookup(url.hostname, { all: true, verbatim: true }))
    .map(({ address }) => address)
    .sort()
    .join(",");
  if (first !== second) {
    throw new SsrfSafeFetchError("MEDIA_URL_DNS_REBINDING", "The media URL DNS answer changed during SSRF validation.");
  }
}

export async function fetchExternalMedia(
  initialUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchedMedia> {
  const request = options.fetch ?? globalThis.fetch;
  const lookup = options.lookup ?? (defaultLookup as unknown as Lookup);
  const maximumBytes = options.maximumBytes ?? MAXIMUM_BYTES;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maximumRedirects = options.maximumRedirects ?? 3;
  const allowlist = options.allowedHosts ?? [];
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new RangeError("maximumBytes must be positive");

  let url = parseUrl(initialUrl, allowlist);
  for (let redirect = 0; redirect <= maximumRedirects; redirect += 1) {
    await assertStablePublicHost(url, lookup);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await request(url, { redirect: "manual", signal: controller.signal });
    } catch (error) {
      throw new SsrfSafeFetchError(
        error instanceof DOMException && error.name === "AbortError"
          ? "MEDIA_URL_TIMEOUT"
          : "MEDIA_URL_FETCH_FAILED",
        "The media URL could not be fetched.",
        502,
      );
    } finally {
      clearTimeout(timer);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === maximumRedirects) {
        throw new SsrfSafeFetchError("MEDIA_URL_REDIRECT_BLOCKED", "The media URL redirect chain is not allowed.");
      }
      url = parseUrl(new URL(location, url).href, allowlist);
      continue;
    }
    if (!response.ok) {
      throw new SsrfSafeFetchError("MEDIA_URL_HTTP_FAILED", `The media URL returned HTTP ${response.status}.`, 502);
    }
    const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (!IMAGE_TYPES.has(contentType)) {
      throw new SsrfSafeFetchError("MEDIA_CONTENT_TYPE_UNSUPPORTED", "The fetched media is not a supported image.");
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isSafeInteger(declaredLength) && declaredLength > maximumBytes) {
      throw new SsrfSafeFetchError("MEDIA_RESPONSE_TOO_LARGE", "The fetched media exceeds the safe size limit.", 413);
    }
    if (!response.body) throw new SsrfSafeFetchError("MEDIA_RESPONSE_EMPTY", "The media response has no body.", 502);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > maximumBytes) {
          await reader.cancel();
          throw new SsrfSafeFetchError("MEDIA_RESPONSE_TOO_LARGE", "The fetched media exceeds the safe size limit.", 413);
        }
        chunks.push(next.value);
      }
    } catch (error) {
      if (error instanceof SsrfSafeFetchError) throw error;
      throw new SsrfSafeFetchError("MEDIA_RESPONSE_READ_FAILED", "The media response could not be read.", 502);
    }
    const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    const digest = createHash("sha256").update(body).digest();
    return {
      body,
      finalUrl: url.href,
      contentType,
      contentLength: body.byteLength,
      checksumSha256: digest.toString("hex"),
      checksumSha256Base64: digest.toString("base64"),
    };
  }
  throw new SsrfSafeFetchError("MEDIA_URL_REDIRECT_BLOCKED", "The media URL redirect chain is not allowed.");
}
