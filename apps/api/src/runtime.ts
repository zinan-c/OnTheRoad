import { connect } from "node:net";

import { Redis } from "ioredis";

import { loadProcessConfig } from "@on-the-road/config/env";
import { createReferenceDataResponse } from "./modules/system/reference-data.mjs";
import { PostgresExecutor } from "@on-the-road/database/postgres";
import { CandidateTokenSigner } from "@on-the-road/domain/location";
import { S3ObjectStorage } from "@on-the-road/storage";

import { AttachmentGalleryService, AttachmentUploadService, PostgresAttachmentRepository } from "./modules/attachments/index.mjs";
import { ExpenseService, PostgresExpenseRepository } from "./modules/expenses/index.mjs";
import { IdentityService, RedisIdentityStore } from "./modules/identity/index.mjs";
import { ItineraryCipher } from "./modules/itinerary/encryption.mjs";
import { PostgresItineraryRepository } from "./modules/itinerary/postgres-repository.mjs";
import {
  ItineraryOrderService,
  PostgresItineraryOrderRepository,
} from "./modules/itinerary/reorder.mjs";
import { ItineraryService } from "./modules/itinerary/service.mjs";
import { PostgresLocationRepository } from "./modules/locations/postgres-repository.mjs";
import { createConfiguredLocationSearchApi } from "./modules/locations/search.js";
import { LocationService } from "./modules/locations/service.mjs";
import { PostgresTripRepository } from "./modules/trips/postgres-repository.mjs";
import { PostgresTripDayRepository } from "./modules/trips/postgres-day-repository.mjs";
import { TripDateChangeService } from "./modules/trips/date-change.mjs";
import { TripService } from "./modules/trips/service.mjs";
import { ImportMappingService, InMemoryImportMappingRepository } from "./modules/imports/mapping.mjs";

export interface ImportTransport {
  createUpload(input: Record<string, unknown>): Promise<unknown> | unknown;
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
  readonly locations: LocationService;
  readonly locationSearch: ReturnType<typeof createConfiguredLocationSearchApi>;
  readonly expenses: ExpenseService;
  readonly attachments: AttachmentUploadService;
  readonly gallery: AttachmentGalleryService;
  readonly imports?: ImportTransport;
  readonly importMapping?: ImportMappingService;
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

async function storageReachable(endpoint: URL): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_000);
  try {
    const response = await fetch(endpoint, {
      method: "HEAD",
      signal: controller.signal,
    });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function createProductionRuntime(
  environment: Readonly<Record<string, string | undefined>>,
): ApiRuntime {
  const config = loadProcessConfig("api", environment);
  if (!config.server) throw new Error("API server configuration is required.");
  const server = config.server;
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
  const locations = new LocationService({
    repository: new PostgresLocationRepository({ executor: database }),
    candidateSigner: new CandidateTokenSigner({
      secret: environment.OTR_CANDIDATE_SIGNING_KEY?.trim()
        || server.sessionSecret,
    }),
  });
  const locationSearch = createConfiguredLocationSearchApi(environment);
  const expenses = new ExpenseService(new PostgresExpenseRepository({ executor: database }));
  const storage = new S3ObjectStorage({
    endpoint: server.storage.endpoint.href,
    region: environment.OBJECT_STORAGE_REGION?.trim() || "us-east-1",
    bucket: server.storage.bucket,
    accessKey: server.storage.accessKey,
    secretKey: server.storage.secretKey,
  });
  const attachmentRepository = new PostgresAttachmentRepository({
    executor: database,
  });
  const attachments = new AttachmentUploadService({
    storage,
    repository: attachmentRepository,
  });
  const gallery = new AttachmentGalleryService(attachmentRepository);
  const importMapping = new ImportMappingService(new InMemoryImportMappingRepository());

  return {
    appOrigin: config.urls.app.origin,
    environment: config.environment,
    identity,
    trips,
    tripDates,
    itinerary,
    itineraryOrder,
    locations,
    locationSearch,
    expenses,
    attachments,
    gallery,
    importMapping,
    referenceData: createReferenceDataResponse,
    async checkReadiness() {
      const checks: Record<string, boolean> = {
        database: false,
        schema: false,
        redis: false,
        storage: false,
        clamav: false,
        mapProvider: true,
      };
      try {
        await database.query("SELECT 1");
        checks.database = true;
        const result = await database.query<{ compatible: boolean }>(`
          SELECT COALESCE(max(version), 0) >= 13
            AND bool_and(status = 'applied') AS compatible
          FROM otr_schema_migration
        `);
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
