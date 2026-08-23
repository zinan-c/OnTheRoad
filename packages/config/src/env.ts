export const PROCESS_ROLES = [
  "web",
  "api",
  "worker",
  "pdf-worker",
] as const;

export type ProcessRole = (typeof PROCESS_ROLES)[number];
export type RuntimeEnvironment = "development" | "test" | "production";
export type RuntimeProfile = "dev" | "qa" | "release";
export type ServiceMode = "native" | "container" | "remote";
export type MapProfile =
  | "fixture"
  | "cn_primary"
  | "international_primary"
  | "hybrid";
export type MapLayerId = "amap-street" | "amap-satellite" | "amap-satellite-labels";
export type MapClientProvider = "fixture" | "amap";

export interface ConfigIssue {
  readonly field: string;
  readonly code:
    | "REQUIRED"
    | "INVALID_BOOLEAN"
    | "INVALID_ENUM"
    | "INVALID_INTEGER"
    | "INVALID_NUMBER"
    | "INVALID_URL"
    | "INSECURE_PRODUCTION_VALUE"
    | "CONFLICTING_CAPABILITY";
  readonly message: string;
}

export class ConfigValidationError extends Error {
  readonly code = "CONFIG_VALIDATION_FAILED";

  constructor(readonly issues: readonly ConfigIssue[]) {
    super(`Configuration validation failed for ${issues.length} field(s)`);
    this.name = "ConfigValidationError";
  }

  toJSON(): {
    readonly name: string;
    readonly code: string;
    readonly issues: readonly ConfigIssue[];
  } {
    return {
      name: this.name,
      code: this.code,
      issues: this.issues,
    };
  }
}

export interface ProcessConfig {
  readonly role: ProcessRole;
  readonly environment: RuntimeEnvironment;
  readonly profile: RuntimeProfile;
  readonly serviceModes: Readonly<Record<string, ServiceMode>>;
  readonly urls: {
    readonly app: URL;
    readonly api: URL;
  };
  readonly ports: {
    readonly web: number;
    readonly api: number;
  };
  readonly map: {
    readonly profile: MapProfile;
    readonly defaultLayer: MapLayerId;
    readonly amap: {
      readonly directionsBaseUrl: URL;
      readonly directionsTimeoutMs: number;
      readonly directionsAttribution: string;
      readonly staticMapBaseUrl: URL;
      readonly staticMapAttribution: string;
      readonly timeoutMs: number;
      readonly rateLimitRps: number;
      readonly cacheTtlSeconds: number;
      readonly drivingStrategy: number;
      readonly jsApiKeyConfigured: boolean;
      readonly securityJsCodeConfigured: boolean;
    };
    readonly client: {
      readonly provider: MapClientProvider;
      readonly engine: "maplibre" | "amap-js";
      readonly jsApiKey?: string;
      readonly securityJsCode?: string;
      readonly defaultLayer: MapLayerId;
      readonly attribution: string;
    };
    readonly nominatim: {
      readonly baseUrl: URL;
      readonly userAgentConfigured: boolean;
      readonly contactConfigured: boolean;
      readonly timeoutMs: number;
      readonly rateLimitRps: number;
      readonly cacheTtlSeconds: number;
    };
    readonly here: {
      readonly geocodeEndpoint: URL;
      readonly discoverEndpoint: URL;
      readonly reverseGeocodeEndpoint: URL;
    };
    readonly providerCredentialsConfigured: {
      readonly amap: boolean;
      readonly nominatim: boolean;
      readonly here: boolean;
    };
    readonly capabilities: {
      readonly autocomplete: boolean;
      readonly batchGeocoding: boolean;
      readonly explicitSearch: boolean;
      readonly offlineMap: true;
    };
    readonly providerCapabilities: {
      readonly map: boolean;
      readonly geocoding: boolean;
      readonly reverseGeocoding: boolean;
      readonly directions: boolean;
      readonly staticMaps: boolean;
    };
    readonly liveSmoke: boolean;
  };
  readonly server?: {
    readonly databaseUrl: URL;
    readonly redisUrl: URL;
    readonly sessionSecret: string;
    readonly storage: {
      readonly endpoint: URL;
      readonly accessKey: string;
      readonly secretKey: string;
      readonly bucket: string;
    };
    readonly clamav: {
      readonly host: string;
      readonly port: number;
    };
    readonly providerCredentials: {
      readonly amapApiKey?: string;
      readonly hereApiKey?: string;
    };
  };
}

type EnvironmentInput = Readonly<Record<string, string | undefined>>;
type MutableEnvironment = Record<string, string | undefined>;

const SECRET_FIELD =
  /(?:KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL|CONTACT|DATABASE_URL|REDIS_URL)/iu;
const DEVELOPMENT_CREDENTIAL = /(?:change[-_]?me|local|development|dev-only)/iu;
const VALID_ENVIRONMENTS = new Set<RuntimeEnvironment>([
  "development",
  "test",
  "production",
]);
const VALID_PROFILES = new Set<RuntimeProfile>(["dev", "qa", "release"]);
const SERVICE_MODE_FIELDS = [
  "POSTGRES",
  "REDIS",
  "MINIO",
  "CLAMAV",
  "API",
  "WEB",
  "WORKER",
  "PDF_WORKER",
] as const;
const VALID_MAP_PROFILES = new Set<MapProfile>([
  "fixture",
  "cn_primary",
  "international_primary",
  "hybrid",
]);
const VALID_MAP_LAYERS = new Set<MapLayerId>([
  "amap-street",
  "amap-satellite",
  "amap-satellite-labels",
]);

function issue(
  issues: ConfigIssue[],
  field: string,
  code: ConfigIssue["code"],
  message: string,
): void {
  issues.push({ field, code, message });
}

function required(
  input: EnvironmentInput,
  issues: ConfigIssue[],
  field: string,
): string {
  const value = input[field]?.trim();
  if (!value) {
    issue(issues, field, "REQUIRED", `${field} is required`);
    return "";
  }
  return value;
}

function optionalBoolean(
  input: EnvironmentInput,
  issues: ConfigIssue[],
  field: string,
  fallback: boolean,
): boolean {
  const value = input[field]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  issue(issues, field, "INVALID_BOOLEAN", `${field} must be true or false`);
  return fallback;
}

function optionalFlag(
  input: EnvironmentInput,
  issues: ConfigIssue[],
  field: string,
  fallback: boolean,
): boolean {
  const value = input[field]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  issue(issues, field, "INVALID_BOOLEAN", `${field} must be 1, 0, true or false`);
  return fallback;
}

function optionalInteger(
  input: EnvironmentInput,
  issues: ConfigIssue[],
  field: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = input[field]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    issue(
      issues,
      field,
      "INVALID_INTEGER",
      `${field} must be an integer between ${minimum} and ${maximum}`,
    );
    return fallback;
  }
  return value;
}

function optionalNumber(
  input: EnvironmentInput,
  issues: ConfigIssue[],
  field: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = input[field]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    issue(
      issues,
      field,
      "INVALID_NUMBER",
      `${field} must be a number between ${minimum} and ${maximum}`,
    );
    return fallback;
  }
  return value;
}

function parsedUrl(
  value: string,
  issues: ConfigIssue[],
  field: string,
  protocols: readonly string[],
): URL {
  try {
    const url = new URL(value);
    if (!protocols.includes(url.protocol)) throw new Error("protocol");
    return url;
  } catch {
    issue(
      issues,
      field,
      "INVALID_URL",
      `${field} must be an absolute ${protocols.join(" or ")} URL`,
    );
    return new URL("http://invalid.local");
  }
}

function assertOfficialAmapEndpoint(
  url: URL,
  issues: ConfigIssue[],
  field: string,
  profile: MapProfile,
): void {
  if (profile === "cn_primary" && url.hostname !== "restapi.amap.com") {
    issue(
      issues,
      field,
      "INVALID_URL",
      `${field} must use the official AMap Web Service host`,
    );
  }
}

function collectSecretValues(
  value: unknown,
  values: Set<string>,
  key = "",
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectSecretValues(item, values, key);
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) {
      collectSecretValues(child, values, childKey);
    }
    return;
  }
  if (SECRET_FIELD.test(key) && typeof value === "string" && value) {
    values.add(value);
  }
}

function redactValue(value: unknown, secrets: ReadonlySet<string>, key = ""): unknown {
  if (SECRET_FIELD.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    let result = value;
    for (const secret of secrets) result = result.replaceAll(secret, "[REDACTED]");
    return result;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secrets));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        redactValue(child, secrets, childKey),
      ]),
    );
  }
  return value;
}

export function redactSecrets<T>(value: T): T {
  const secrets = new Set<string>();
  collectSecretValues(value, secrets);
  return redactValue(value, secrets) as T;
}

export function loadProcessConfig(
  role: ProcessRole,
  environmentInput: EnvironmentInput,
): ProcessConfig {
  const environment: EnvironmentInput = {
    ...environmentInput,
    ...(environmentInput.DATABASE_URL === undefined && environmentInput.OTR_ENV_DATABASE_URL !== undefined
      ? { DATABASE_URL: environmentInput.OTR_ENV_DATABASE_URL }
      : {}),
    ...(environmentInput.REDIS_URL === undefined && environmentInput.OTR_ENV_REDIS_URL !== undefined
      ? { REDIS_URL: environmentInput.OTR_ENV_REDIS_URL }
      : {}),
    ...(environmentInput.OBJECT_STORAGE_ENDPOINT === undefined && environmentInput.OTR_ENV_OBJECT_STORAGE_ENDPOINT !== undefined
      ? { OBJECT_STORAGE_ENDPOINT: environmentInput.OTR_ENV_OBJECT_STORAGE_ENDPOINT }
      : {}),
    ...(environmentInput.OBJECT_STORAGE_ACCESS_KEY === undefined && environmentInput.OTR_ENV_OBJECT_STORAGE_ACCESS_KEY !== undefined
      ? { OBJECT_STORAGE_ACCESS_KEY: environmentInput.OTR_ENV_OBJECT_STORAGE_ACCESS_KEY }
      : {}),
    ...(environmentInput.OBJECT_STORAGE_SECRET_KEY === undefined && environmentInput.OTR_ENV_OBJECT_STORAGE_SECRET_KEY !== undefined
      ? { OBJECT_STORAGE_SECRET_KEY: environmentInput.OTR_ENV_OBJECT_STORAGE_SECRET_KEY }
      : {}),
    ...(environmentInput.OBJECT_STORAGE_BUCKET === undefined && environmentInput.OTR_ENV_OBJECT_STORAGE_BUCKET !== undefined
      ? { OBJECT_STORAGE_BUCKET: environmentInput.OTR_ENV_OBJECT_STORAGE_BUCKET }
      : {}),
    ...(environmentInput.OBJECT_STORAGE_REGION === undefined && environmentInput.OTR_ENV_OBJECT_STORAGE_REGION !== undefined
      ? { OBJECT_STORAGE_REGION: environmentInput.OTR_ENV_OBJECT_STORAGE_REGION }
      : {}),
    ...(environmentInput.CLAMAV_HOST === undefined && environmentInput.OTR_ENV_CLAMAV_HOST !== undefined
      ? { CLAMAV_HOST: environmentInput.OTR_ENV_CLAMAV_HOST }
      : {}),
    ...(environmentInput.CLAMAV_PORT === undefined && environmentInput.OTR_ENV_CLAMAV_PORT !== undefined
      ? { CLAMAV_PORT: environmentInput.OTR_ENV_CLAMAV_PORT }
      : {}),
    ...(environmentInput.SESSION_SECRET === undefined && environmentInput.OTR_ENV_SESSION_SECRET !== undefined
      ? { SESSION_SECRET: environmentInput.OTR_ENV_SESSION_SECRET }
      : {}),
  };
  const issues: ConfigIssue[] = [];
  if (!PROCESS_ROLES.includes(role)) {
    throw new ConfigValidationError([
      {
        field: "PROCESS_ROLE",
        code: "INVALID_ENUM",
        message: "PROCESS_ROLE is not supported",
      },
    ]);
  }

  const runtimeValue = required(environment, issues, "NODE_ENV");
  const runtime = VALID_ENVIRONMENTS.has(runtimeValue as RuntimeEnvironment)
    ? (runtimeValue as RuntimeEnvironment)
    : "development";
  if (runtimeValue && runtime === "development" && runtimeValue !== "development") {
    issue(
      issues,
      "NODE_ENV",
      "INVALID_ENUM",
      "NODE_ENV must be development, test or production",
    );
  }

  const inferredProfile: RuntimeProfile = runtime === "production" ? "release" : "dev";
  const runtimeProfileValue = environment.OTR_RUNTIME_PROFILE?.trim() || inferredProfile;
  const runtimeProfile = VALID_PROFILES.has(runtimeProfileValue as RuntimeProfile)
    ? runtimeProfileValue as RuntimeProfile
    : inferredProfile;
  if (!VALID_PROFILES.has(runtimeProfileValue as RuntimeProfile)) {
    issue(
      issues,
      "OTR_RUNTIME_PROFILE",
      "INVALID_ENUM",
      "OTR_RUNTIME_PROFILE must be dev, qa or release",
    );
  }
  const serviceModes = Object.fromEntries(SERVICE_MODE_FIELDS.map((service) => {
    const field = `OTR_${runtimeProfile.toUpperCase()}_${service}_MODE`;
    const value = environment[field]?.trim() || "native";
    if (!["native", "container", "remote"].includes(value)) {
      issue(
        issues,
        field,
        "INVALID_ENUM",
        `${field} must be native, container or remote`,
      );
    }
    return [service.toLowerCase(), value as ServiceMode];
  }));

  const appUrl = parsedUrl(
    required(environment, issues, "APP_ORIGIN"),
    issues,
    "APP_ORIGIN",
    ["http:", "https:"],
  );
  const apiUrl = parsedUrl(
    required(environment, issues, "API_BASE_URL"),
    issues,
    "API_BASE_URL",
    ["http:", "https:"],
  );
  const mapProfileValue = required(environment, issues, "MAP_PROFILE");
  const mapProfile = VALID_MAP_PROFILES.has(mapProfileValue as MapProfile)
    ? (mapProfileValue as MapProfile)
    : "fixture";
  if (mapProfileValue && mapProfile === "fixture" && mapProfileValue !== "fixture") {
    issue(
      issues,
      "MAP_PROFILE",
      "INVALID_ENUM",
      "MAP_PROFILE is not supported",
    );
  }

  const autocomplete = optionalBoolean(
    environment,
    issues,
    "MAP_AUTOCOMPLETE_ENABLED",
    false,
  );
  const explicitSearch = optionalBoolean(
    environment,
    issues,
    "MAP_EXPLICIT_SEARCH_ENABLED",
    mapProfile !== "fixture",
  );
  const amapKey = environment.AMAP_API_KEY?.trim() ?? "";
  const amapJsApiKey = environment.AMAP_JS_API_KEY?.trim() ?? "";
  const amapSecurityJsCode = environment.AMAP_JS_SECURITY_CODE?.trim() ?? "";
  const hereKey = environment.OTR_HERE_API_KEY?.trim() ?? "";
  const defaultLayerValue = environment.OTR_MAP_DEFAULT_LAYER?.trim() || "amap-street";
  const defaultLayer = VALID_MAP_LAYERS.has(defaultLayerValue as MapLayerId)
    ? defaultLayerValue as MapLayerId
    : "amap-street";
  if (!VALID_MAP_LAYERS.has(defaultLayerValue as MapLayerId)) {
    issue(issues, "OTR_MAP_DEFAULT_LAYER", "INVALID_ENUM", "OTR_MAP_DEFAULT_LAYER is not supported");
  }
  const amapTimeoutMs = optionalInteger(
    environment,
    issues,
    "OTR_AMAP_TIMEOUT_MS",
    5_000,
    250,
    30_000,
  );
  const amapRateLimitRps = optionalNumber(
    environment,
    issues,
    "OTR_AMAP_RATE_LIMIT_RPS",
    5,
    0.001,
    100,
  );
  const amapCacheTtlSeconds = optionalInteger(
    environment,
    issues,
    "OTR_AMAP_CACHE_TTL_SECONDS",
    86_400,
    1,
    604_800,
  );
  const amapDrivingStrategy = optionalInteger(
    environment,
    issues,
    "OTR_AMAP_DRIVING_STRATEGY",
    0,
    0,
    20,
  );
  const directionsTimeoutMs = optionalInteger(
    environment,
    issues,
    "OTR_DIRECTIONS_TIMEOUT_MS",
    8_000,
    250,
    30_000,
  );
  const liveSmoke = optionalFlag(environment, issues, "OTR_AMAP_LIVE_SMOKE", false);
  const nominatimUserAgent = environment.OTR_NOMINATIM_USER_AGENT?.trim() ?? "";
  const nominatimContact = environment.OTR_NOMINATIM_CONTACT?.trim() ?? "";
  const nominatimTimeoutMs = optionalInteger(
    environment,
    issues,
    "OTR_NOMINATIM_TIMEOUT_MS",
    5_000,
    250,
    30_000,
  );
  const nominatimRateLimitRps = optionalNumber(
    environment,
    issues,
    "OTR_NOMINATIM_RATE_LIMIT_RPS",
    1,
    0.001,
    1,
  );
  const nominatimCacheTtlSeconds = optionalInteger(
    environment,
    issues,
    "OTR_NOMINATIM_CACHE_TTL_SECONDS",
    86_400,
    1,
    604_800,
  );

  if (autocomplete) {
    issue(
      issues,
      "MAP_AUTOCOMPLETE_ENABLED",
      "CONFLICTING_CAPABILITY",
      "Nominatim autocomplete is disabled; use explicit search",
    );
  }

  if (mapProfile === "fixture" && explicitSearch) {
    issue(
      issues,
      autocomplete ? "MAP_AUTOCOMPLETE_ENABLED" : "MAP_EXPLICIT_SEARCH_ENABLED",
      "CONFLICTING_CAPABILITY",
      "fixture profile cannot enable online search capabilities",
    );
  }
  if (
    mapProfile === "cn_primary"
    && !amapKey
  ) {
    issue(
      issues,
      "AMAP_API_KEY",
      "CONFLICTING_CAPABILITY",
      "cn_primary online search requires AMAP_API_KEY",
    );
  }
  if (mapProfile === "cn_primary" && !amapJsApiKey) {
    issue(
      issues,
      "AMAP_JS_API_KEY",
      "CONFLICTING_CAPABILITY",
      "cn_primary online map requires AMAP_JS_API_KEY",
    );
  }
  if (mapProfile === "cn_primary" && !amapSecurityJsCode) {
    issue(
      issues,
      "AMAP_JS_SECURITY_CODE",
      "CONFLICTING_CAPABILITY",
      "cn_primary online map requires AMAP_JS_SECURITY_CODE",
    );
  }
  if (
    (mapProfile === "international_primary" || mapProfile === "hybrid")
    && !nominatimUserAgent
  ) {
    issue(
      issues,
      "OTR_NOMINATIM_USER_AGENT",
      "REQUIRED",
      "online Nominatim search requires OTR_NOMINATIM_USER_AGENT",
    );
  }
  if (
    (mapProfile === "international_primary" || mapProfile === "hybrid")
    && !nominatimContact
  ) {
    issue(
      issues,
      "OTR_NOMINATIM_CONTACT",
      "REQUIRED",
      "online Nominatim search requires OTR_NOMINATIM_CONTACT",
    );
  }
  if (mapProfile === "hybrid" && !amapKey) {
    issue(
      issues,
      "AMAP_API_KEY",
      "CONFLICTING_CAPABILITY",
      "hybrid profile requires AMAP_API_KEY for China",
    );
  }

  const nominatimBaseUrl = parsedUrl(
    environment.OTR_NOMINATIM_BASE_URL?.trim()
      || "https://nominatim.openstreetmap.org",
    issues,
    "OTR_NOMINATIM_BASE_URL",
    ["https:"],
  );

  const hereGeocodeEndpoint = parsedUrl(
    environment.OTR_HERE_GEOCODE_ENDPOINT?.trim()
      || "https://geocode.search.hereapi.com/v1/geocode",
    issues,
    "OTR_HERE_GEOCODE_ENDPOINT",
    ["https:"],
  );
  const hereDiscoverEndpoint = parsedUrl(
    environment.OTR_HERE_DISCOVER_ENDPOINT?.trim()
      || "https://discover.search.hereapi.com/v1/discover",
    issues,
    "OTR_HERE_DISCOVER_ENDPOINT",
    ["https:"],
  );
  const hereReverseEndpoint = parsedUrl(
    environment.OTR_HERE_REVERSE_ENDPOINT?.trim()
      || "https://revgeocode.search.hereapi.com/v1/revgeocode",
    issues,
    "OTR_HERE_REVERSE_ENDPOINT",
    ["https:"],
  );
  const directionsBaseUrl = parsedUrl(
    environment.OTR_DIRECTIONS_BASE_URL?.trim() || "https://restapi.amap.com/",
    issues,
    "OTR_DIRECTIONS_BASE_URL",
    ["https:"],
  );
  assertOfficialAmapEndpoint(directionsBaseUrl, issues, "OTR_DIRECTIONS_BASE_URL", mapProfile);
  const directionsAttribution = environment.OTR_DIRECTIONS_ATTRIBUTION?.trim()
    || "© 高德地图";
  if (mapProfile === "cn_primary" && !directionsAttribution) {
    issue(issues, "OTR_DIRECTIONS_ATTRIBUTION", "REQUIRED", "OTR_DIRECTIONS_ATTRIBUTION is required");
  }
  const staticMapBaseUrl = parsedUrl(
    environment.OTR_STATIC_MAP_BASE_URL?.trim() || "https://restapi.amap.com/v3/staticmap",
    issues,
    "OTR_STATIC_MAP_BASE_URL",
    ["https:"],
  );
  assertOfficialAmapEndpoint(staticMapBaseUrl, issues, "OTR_STATIC_MAP_BASE_URL", mapProfile);
  const staticMapAttribution = environment.OTR_STATIC_MAP_ATTRIBUTION?.trim()
    || "© 高德地图";
  if (mapProfile === "cn_primary" && !staticMapAttribution) {
    issue(issues, "OTR_STATIC_MAP_ATTRIBUTION", "REQUIRED", "OTR_STATIC_MAP_ATTRIBUTION is required");
  }

  let server: ProcessConfig["server"];
  if (role !== "web") {
    const databaseUrl = parsedUrl(
      required(environment, issues, "DATABASE_URL"),
      issues,
      "DATABASE_URL",
      ["postgres:", "postgresql:"],
    );
    const redisUrl = parsedUrl(
      required(environment, issues, "REDIS_URL"),
      issues,
      "REDIS_URL",
      ["redis:", "rediss:"],
    );
    const storageEndpoint = parsedUrl(
      required(environment, issues, "OBJECT_STORAGE_ENDPOINT"),
      issues,
      "OBJECT_STORAGE_ENDPOINT",
      ["http:", "https:"],
    );
    const storageAccessKey = required(
      environment,
      issues,
      "OBJECT_STORAGE_ACCESS_KEY",
    );
    const storageSecretKey = required(
      environment,
      issues,
      "OBJECT_STORAGE_SECRET_KEY",
    );
    const storageBucket = required(
      environment,
      issues,
      "OBJECT_STORAGE_BUCKET",
    );
    const sessionSecret = required(environment, issues, "SESSION_SECRET");
    const clamavHost = required(environment, issues, "CLAMAV_HOST");
    const clamavPort = optionalInteger(
      environment,
      issues,
      "CLAMAV_PORT",
      3310,
      1,
      65_535,
    );

    if (runtime === "production") {
      for (const [field, value] of [
        ["DATABASE_URL", databaseUrl.href],
        ["REDIS_URL", redisUrl.href],
        ["OBJECT_STORAGE_ENDPOINT", storageEndpoint.href],
        ["OBJECT_STORAGE_ACCESS_KEY", storageAccessKey],
        ["OBJECT_STORAGE_SECRET_KEY", storageSecretKey],
        ["SESSION_SECRET", sessionSecret],
        ["AMAP_API_KEY", amapKey],
        ["AMAP_JS_API_KEY", amapJsApiKey],
        ["AMAP_JS_SECURITY_CODE", amapSecurityJsCode],
        ["OTR_HERE_API_KEY", hereKey],
      ] as const) {
        if (value && DEVELOPMENT_CREDENTIAL.test(value)) {
          issue(
            issues,
            field,
            "INSECURE_PRODUCTION_VALUE",
            `${field} uses a development-only pattern`,
          );
        }
      }
    }

    server = {
      databaseUrl,
      redisUrl,
      sessionSecret,
      storage: {
        endpoint: storageEndpoint,
        accessKey: storageAccessKey,
        secretKey: storageSecretKey,
        bucket: storageBucket,
      },
      clamav: {
        host: clamavHost,
        port: clamavPort,
      },
      providerCredentials: {
        ...(amapKey ? { amapApiKey: amapKey } : {}),
        ...(hereKey ? { hereApiKey: hereKey } : {}),
      },
    };
  }

  const webPort = optionalInteger(
    environment,
    issues,
    "WEB_PORT",
    3000,
    1,
    65_535,
  );
  const apiPort = optionalInteger(
    environment,
    issues,
    "API_PORT",
    3001,
    1,
    65_535,
  );
  if (issues.length > 0) throw new ConfigValidationError(issues);

  const amapReady = Boolean(amapKey);
  const clientProvider: MapClientProvider = mapProfile === "cn_primary" ? "amap" : "fixture";
  const clientAttribution = clientProvider === "amap" ? "© 高德地图" : "On The Road fixture";
  const providerCapabilities = {
    map: mapProfile === "fixture" || (mapProfile === "cn_primary" && Boolean(amapJsApiKey && amapSecurityJsCode)),
    geocoding: mapProfile === "fixture"
      || (mapProfile === "cn_primary" && amapReady)
      || ((mapProfile === "international_primary" || mapProfile === "hybrid") && Boolean(nominatimUserAgent && nominatimContact)),
    reverseGeocoding: mapProfile === "fixture"
      || (mapProfile === "cn_primary" && amapReady)
      || ((mapProfile === "international_primary" || mapProfile === "hybrid") && Boolean(nominatimUserAgent && nominatimContact)),
    directions: mapProfile === "fixture" || (mapProfile === "cn_primary" && amapReady),
    staticMaps: mapProfile === "fixture" || (mapProfile === "cn_primary" && amapReady),
  } as const;

  return {
    role,
    environment: runtime,
    profile: runtimeProfile,
    serviceModes,
    urls: {
      app: appUrl,
      api: apiUrl,
    },
    ports: {
      web: webPort,
      api: apiPort,
    },
    map: {
      profile: mapProfile,
      defaultLayer,
      amap: {
        directionsBaseUrl,
        directionsTimeoutMs,
        directionsAttribution,
        staticMapBaseUrl,
        staticMapAttribution,
        timeoutMs: amapTimeoutMs,
        rateLimitRps: amapRateLimitRps,
        cacheTtlSeconds: amapCacheTtlSeconds,
        drivingStrategy: amapDrivingStrategy,
        jsApiKeyConfigured: Boolean(amapJsApiKey),
        securityJsCodeConfigured: Boolean(amapSecurityJsCode),
      },
      client: {
        provider: clientProvider,
        engine: clientProvider === "amap" ? "amap-js" : "maplibre",
        ...(amapJsApiKey && clientProvider === "amap" ? { jsApiKey: amapJsApiKey } : {}),
        ...(amapSecurityJsCode && clientProvider === "amap" ? { securityJsCode: amapSecurityJsCode } : {}),
        defaultLayer,
        attribution: clientAttribution,
      },
      nominatim: {
        baseUrl: nominatimBaseUrl,
        userAgentConfigured: Boolean(nominatimUserAgent),
        contactConfigured: Boolean(nominatimContact),
        timeoutMs: nominatimTimeoutMs,
        rateLimitRps: nominatimRateLimitRps,
        cacheTtlSeconds: nominatimCacheTtlSeconds,
      },
      here: {
        geocodeEndpoint: hereGeocodeEndpoint,
        discoverEndpoint: hereDiscoverEndpoint,
        reverseGeocodeEndpoint: hereReverseEndpoint,
      },
      providerCredentialsConfigured: {
        amap: Boolean(amapKey),
        nominatim: Boolean(nominatimUserAgent && nominatimContact),
        here: Boolean(hereKey),
      },
      capabilities: {
        autocomplete,
        batchGeocoding: false,
        explicitSearch,
        offlineMap: true,
      },
      providerCapabilities,
      liveSmoke,
    },
    ...(server ? { server } : {}),
  };
}

export function environmentFromEntries(
  entries: Iterable<readonly [string, string | undefined]>,
): EnvironmentInput {
  return Object.fromEntries(entries) as MutableEnvironment;
}
