import { connect } from "node:net";

import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { loadProcessConfig } from "@on-the-road/config/env";
import { createReferenceDataResponse } from "./modules/system/reference-data.mjs";
import { minimumCompatibleSchemaVersion } from "@on-the-road/database";
import { PostgresExecutor } from "@on-the-road/database/postgres";
import { CandidateTokenSigner } from "@on-the-road/domain/location";
import { CoordinateAdjustmentService } from "@on-the-road/application/location";
import { IMPORT_CONTENT_TYPES, S3ObjectStorage } from "@on-the-road/storage";
import { RedisGeocodingStateStore } from "@on-the-road/providers/geocoding";

import { AttachmentGalleryService, AttachmentUploadService, PostgresAttachmentRepository } from "./modules/attachments/index.mjs";
import { ExpenseService, PostgresExpenseRepository } from "./modules/expenses/index.mjs";
import {
  IdentityService,
  PostgresLocalAccountStore,
  RedisIdentityStore,
} from "./modules/identity/index.mjs";
import { ItineraryCipher } from "./modules/itinerary/encryption.mjs";
import { PostgresItineraryRepository } from "./modules/itinerary/postgres-repository.mjs";
import {
  ItineraryOrderService,
  PostgresItineraryOrderRepository,
} from "./modules/itinerary/reorder.mjs";
import { ItineraryService } from "./modules/itinerary/service.mjs";
import { PostgresTransportModeRepository } from "./modules/itinerary/transport-mode-postgres-repository.mjs";
import { TransportModeService } from "./modules/itinerary/transport-modes.js";
import { PostgresLocationRepository } from "./modules/locations/postgres-repository.mjs";
import { createConfiguredLocationSearchApi } from "./modules/locations/search.js";
import { LocationService } from "./modules/locations/service.mjs";
import { LocationCoordinatesApi } from "./modules/locations/coordinates.js";
import { PostgresCoordinateRepository } from "./modules/locations/coordinates-postgres.mjs";
import { PostgresTripRepository } from "./modules/trips/postgres-repository.mjs";
import { PostgresTripDayRepository } from "./modules/trips/postgres-day-repository.mjs";
import { TripDateChangeService } from "./modules/trips/date-change.mjs";
import { TripService } from "./modules/trips/service.mjs";
import { ImportMappingService, PostgresImportMappingRepository } from "./modules/imports/mapping.mjs";
import { ImportPreviewService, PostgresImportPreviewRepository } from "./modules/imports/preview.mjs";
import { PostgresImportTransport } from "./modules/imports/postgres-upload.mjs";
import { PostgresImportCommitTransport } from "./modules/imports/commit.mjs";
import { PostgresImportMediaTaskService } from "./modules/imports/media-tasks.mjs";
import { PostgresImportGeocodeService } from "./modules/imports/geocode.mjs";
import { PostgresImportUnresolvedLocationService } from "./modules/imports/unresolved.mjs";
import { PostgresRouteRepository } from "./modules/routing/postgres-route-repository.mjs";
import { PostgresExportService } from "./modules/exports/service.mjs";
import { EXPORT_QUEUE_NAME } from "@on-the-road/application/export";

export interface ImportTransport {
  createUpload(input: Record<string, unknown>): Promise<unknown> | unknown;
  completeUpload(input: Record<string, unknown>): Promise<unknown> | unknown;
  queueInspection(input: Record<string, unknown>): Promise<unknown> | unknown;
  getJob(input: Record<string, unknown>): Promise<unknown> | unknown;
}

export interface OidcProvider {
  readonly issuer: string;
  authorizationUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
  }): string;
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<{ issuer: string; subject: string; nonce: string }>;
}

export interface ApiRuntime {
  readonly appOrigin: string;
  readonly environment: string;
  readonly identity: IdentityService;
  readonly oidcProvider?: OidcProvider;
  readonly trips: TripService;
  readonly tripDates: TripDateChangeService;
  readonly itinerary: ItineraryService;
  readonly itineraryOrder: ItineraryOrderService;
  readonly transportModes: TransportModeService;
  readonly locations: LocationService;
  readonly locationCoordinates: LocationCoordinatesApi;
  readonly locationSearch: ReturnType<typeof createConfiguredLocationSearchApi>;
  readonly mapCapabilities?: Readonly<{
    readonly map: boolean;
    readonly geocoding: boolean;
    readonly reverseGeocoding: boolean;
    readonly directions: boolean;
    readonly staticMaps: boolean;
  }>;
  readonly expenses: ExpenseService;
  readonly attachments: AttachmentUploadService;
  readonly gallery: AttachmentGalleryService;
  readonly imports?: ImportTransport;
  readonly importCommit?: PostgresImportCommitTransport;
  readonly importMediaTasks?: PostgresImportMediaTaskService;
  readonly importGeocode?: PostgresImportGeocodeService;
  readonly importUnresolved?: PostgresImportUnresolvedLocationService;
  readonly importMapping?: ImportMappingService;
  readonly importPreview: ImportPreviewService;
  readonly routes: PostgresRouteRepository;
  readonly exports: PostgresExportService;
  readonly e2eWriteGuard?: Readonly<{
    readonly token: string;
    readonly databaseName: string;
  }>;
  referenceData(): unknown;
  checkReadiness(): Promise<Record<string, boolean>>;
  close(): Promise<void>;
}

function reachable(host: string, port: number, timeoutMs = 1_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export async function storageReachable(
  endpoint: URL,
  request: typeof fetch = fetch,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_000);
  try {
    const response = await request(new URL("/minio/health/ready", endpoint), {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Browser E2E is allowed to mutate only a disposable, explicitly named
 * database. Keeping this check in the API composition root makes an unsafe
 * external-stack configuration fail before any request can be served.
 */
export function assertE2eWriteDatabase(
  databaseUrl: URL,
  environment: Readonly<Record<string, string | undefined>>,
): { readonly token: string; readonly databaseName: string } | undefined {
  if (environment.OTR_E2E_MODE?.trim() !== "1") return undefined;
  const token = environment.OTR_E2E_WRITE_TOKEN?.trim() ?? "";
  if (token.length < 32) {
    throw new Error("OTR_E2E_WRITE_TOKEN must contain at least 32 characters.");
  }
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//u, ""));
  if (
    databaseName !== "on_the_road_playwright_e2e"
    && !/^on_the_road_e2e_[a-z0-9-]+$/u.test(databaseName)
  ) {
    throw new Error(
      "OTR_E2E_MODE requires a disposable database named on_the_road_playwright_e2e or on_the_road_e2e_<run-id>.",
    );
  }
  return { token, databaseName };
}

export function createProductionRuntime(
  environment: Readonly<Record<string, string | undefined>>,
): ApiRuntime {
  const config = loadProcessConfig("api", environment);
  if (!config.server) throw new Error("API server configuration is required.");
  const server = config.server;
  const e2eWriteGuard = assertE2eWriteDatabase(server.databaseUrl, environment);
  const database = new PostgresExecutor({
    databaseUrl: server.databaseUrl.href,
    role: "api",
  });
  const redis = new Redis(server.redisUrl.href, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  const identity = new IdentityService({
    environment: config.environment,
    developmentIdentityEnabled: config.environment === "development",
    appOrigin: config.urls.app.origin,
    signingKeys: {
      active: {
        id: environment.OTR_SESSION_SIGNING_KEY_ID?.trim() || "runtime-v1",
        secret: environment.OTR_SESSION_SIGNING_KEY?.trim()
          || server.sessionSecret,
      },
    },
    localIssuer: environment.OTR_LOCAL_IDENTITY_ISSUER?.trim()
      || "https://identity.on-the-road.local",
    accountStore: new PostgresLocalAccountStore({ executor: database }),
    store: new RedisIdentityStore(redis),
  });
  const trips = new TripService(new PostgresTripRepository({ executor: database }));
  const tripDates = new TripDateChangeService(
    new PostgresTripDayRepository({ executor: database }),
  );
  const itinerary = new ItineraryService(
    new PostgresItineraryRepository({ executor: database }),
    new ItineraryCipher({
      activeKey: {
        id: environment.OTR_ITINERARY_KEY_ID?.trim() || "runtime-v1",
        secret: environment.OTR_ITINERARY_KEY?.trim()
          || server.sessionSecret,
      },
    }),
  );
  const itineraryOrder = new ItineraryOrderService(
    new PostgresItineraryOrderRepository({ executor: database }),
  );
  const transportModes = new TransportModeService(
    new PostgresTransportModeRepository({ executor: database }),
  );
  const locationRepository = new PostgresLocationRepository({ executor: database });
  const locations = new LocationService({
    repository: locationRepository,
    candidateSigner: new CandidateTokenSigner({
      secret: environment.OTR_CANDIDATE_SIGNING_KEY?.trim()
        || server.sessionSecret,
    }),
  });
  const locationCoordinates = new LocationCoordinatesApi(
    new CoordinateAdjustmentService(
      new PostgresCoordinateRepository({ locationRepository }),
    ),
  );
  const geocodingStore = new RedisGeocodingStateStore({
    get: (key) => redis.get(key),
    set: (key, value, options) => redis.set(key, value, "EX", options.EX),
    eval: (script, options) => redis.eval(
      script,
      options.keys.length,
      ...options.keys,
      ...options.arguments,
    ),
  });
  const onlineProfile = config.map.profile !== "fixture";
  const publicProvider = config.map.profile === "cn_primary"
    ? "amap"
    : config.map.profile === "international_primary"
      ? "mapbox"
      : "hybrid";
  const geocodingPolicy = config.map.profile === "cn_primary"
    ? {
      cacheTtlSeconds: config.map.amap.cacheTtlSeconds,
      rateLimitRps: config.map.amap.rateLimitRps,
    }
    : {
      cacheTtlSeconds: config.map.mapbox.cacheTtlSeconds,
      rateLimitRps: config.map.mapbox.rateLimitRps,
    };
  const locationSearch = createConfiguredLocationSearchApi(environment, {
    ...(onlineProfile ? {
      policy: {
        store: geocodingStore,
        cacheTtlSeconds: geocodingPolicy.cacheTtlSeconds,
        bucket: {
          capacity: 1,
          refillPerSecond: geocodingPolicy.rateLimitRps,
        },
        bucketKey: publicProvider,
        maxRetries: 1,
      },
    } : {}),
  });
  const expenses = new ExpenseService(new PostgresExpenseRepository({ executor: database }));
  const storage = new S3ObjectStorage({
    endpoint: server.storage.endpoint.href,
    region: environment.OBJECT_STORAGE_REGION?.trim() || "us-east-1",
    bucket: server.storage.bucket,
    accessKey: server.storage.accessKey,
    secretKey: server.storage.secretKey,
  });
  const importStorage = new S3ObjectStorage({
    endpoint: server.storage.endpoint.href,
    region: environment.OBJECT_STORAGE_REGION?.trim() || "us-east-1",
    bucket: server.storage.bucket,
    accessKey: server.storage.accessKey,
    secretKey: server.storage.secretKey,
    allowedContentTypes: IMPORT_CONTENT_TYPES,
  });
  const attachmentRepository = new PostgresAttachmentRepository({
    executor: database,
    storage,
  });
  const attachments = new AttachmentUploadService({
    storage,
    repository: attachmentRepository,
    queue: redis,
  });
  const gallery = new AttachmentGalleryService(attachmentRepository);
  const importMapping = new ImportMappingService(new PostgresImportMappingRepository({ executor: database, queue: redis }));
  const importPreview = new ImportPreviewService(new PostgresImportPreviewRepository({ executor: database }));
  const imports = new PostgresImportTransport({ database, storage: importStorage, queue: redis });
  const importCommit = new PostgresImportCommitTransport({ database, queue: redis });
  const importMediaTasks = new PostgresImportMediaTaskService({ database, queue: redis });
  const importGeocode = new PostgresImportGeocodeService({
    database,
    queue: redis,
    provider: locationSearch.capabilities().provider,
    batchEnabled: config.map.profile === "fixture",
  });
  const importUnresolved = new PostgresImportUnresolvedLocationService({
    database,
    candidateSigner: new CandidateTokenSigner({
      secret: environment.OTR_CANDIDATE_SIGNING_KEY?.trim() || server.sessionSecret,
    }),
  });
  const routes = new PostgresRouteRepository({ executor: database });
  const exportQueue = new Queue(EXPORT_QUEUE_NAME, { connection: redis });
  const exports = new PostgresExportService({ database, queue: exportQueue });

  return {
    appOrigin: config.urls.app.origin,
    environment: config.environment,
    identity,
    trips,
    tripDates,
    itinerary,
    itineraryOrder,
    transportModes,
    locations,
    locationCoordinates,
    locationSearch,
    mapCapabilities: config.map.providerCapabilities,
    expenses,
    attachments,
    gallery,
    imports,
    importCommit,
    importMediaTasks,
    importGeocode,
    importUnresolved,
    importMapping,
    importPreview,
    routes,
    exports,
    ...(e2eWriteGuard ? { e2eWriteGuard } : {}),
    referenceData: createReferenceDataResponse,
    async checkReadiness() {
      const checks: Record<string, boolean> = {
        database: false,
        schema: false,
        redis: false,
        storage: false,
        clamav: false,
        mapProvider: Object.values(config.map.providerCapabilities).every(Boolean),
      };
      try {
        await database.query("SELECT 1");
        checks.database = true;
        const result = await database.query<{ compatible: boolean }>(`
          SELECT COALESCE(max(version), 0) >= $1
            AND bool_and(status = 'applied') AS compatible
          FROM otr_schema_migration
        `, [minimumCompatibleSchemaVersion]);
        checks.schema = result.rows[0]?.compatible === true;
      } catch {
        checks.database = false;
        checks.schema = false;
      }
      try {
        if (redis.status === "wait") await redis.connect();
        checks.redis = await redis.ping() === "PONG";
      } catch {
        checks.redis = false;
      }
      checks.storage = await storageReachable(server.storage.endpoint);
      checks.clamav = await reachable(
        server.clamav.host,
        server.clamav.port,
      );
      return checks;
    },
    async close() {
      await exportQueue.close();
      if (redis.status !== "end") {
        try {
          await redis.quit();
        } catch {
          redis.disconnect();
        }
      }
      await database.close();
    },
  };
}
