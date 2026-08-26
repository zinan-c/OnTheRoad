import { generateRouteWindow } from "@on-the-road/domain/routing";
import { PostgresExecutor } from "@on-the-road/database/postgres";
import type { JobEvent } from "@on-the-road/database/jobs";
import { mapProviderError, type DirectionsProvider, type RouteResult } from "@on-the-road/providers";

export const ROUTE_PROVIDER_CONCURRENCY = 2;
export const ROUTE_PROVIDER_MAX_ATTEMPTS = 3;
export const ROUTE_PROVIDER_MIN_INTERVAL_MS = 100;
export const ROUTE_PROVIDER_BASE_BACKOFF_MS = 250;
export const ROUTE_PROVIDER_MAX_BACKOFF_MS = 30_000;

type RouteItemRow = {
  id: string;
  trip_day_id: string;
  day_number: number;
  sort_order: number;
  version: number;
  item_type: string;
  transport_mode_code: string | null;
  deleted_at: string | null;
  location_id: string | null;
  location_version: number | null;
  location_status: string | null;
  longitude: number | null;
  latitude: number | null;
  city: string | null;
  district: string | null;
  start_location_id: string | null;
  start_location_version: number | null;
  start_location_status: string | null;
  start_longitude: number | null;
  start_latitude: number | null;
  start_city: string | null;
  start_district: string | null;
  end_location_id: string | null;
  end_location_version: number | null;
  end_location_status: string | null;
  end_longitude: number | null;
  end_latitude: number | null;
  end_city: string | null;
  end_district: string | null;
};

type DayGenerationRow = {
  id: string;
  route_generation: number;
};

type RouteCandidate = {
  kind: string;
  arrivalDayId: string;
  fromItineraryItemId: string;
  toItineraryItemId: string;
  transportModeCode: string;
  sourceVersion: string;
  sourceContext: Record<string, unknown>;
  blockers: string[];
  fromLocation: {
    id: string;
    point: { longitude: number; latitude: number };
    city?: string;
    district?: string;
  } | null;
  toLocation: {
    id: string;
    point: { longitude: number; latitude: number };
    city?: string;
    district?: string;
  } | null;
};

type ResolvedCandidate = RouteCandidate & {
  route: RouteResult | null;
  routeProvider: string | null;
  routeQuality: "actual" | "approximate" | "unknown";
  mapProfile: string;
  routeErrorCode: string | null;
  routeAttempts: number;
};

type RouteEventRow = {
  event_id: string;
  event_type: string;
  aggregate_id: string;
  aggregate_type: string;
  aggregate_version: number;
  schema_version: number;
};

export type RouteResolutionOptions = Readonly<{
  concurrency?: number;
  maxAttempts?: number;
  minIntervalMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  beforeProvider?: () => Promise<boolean>;
}>;

export class PostgresRouteRebuildProcessor {
  readonly #database: PostgresExecutor;
  readonly #beforeCommit: (() => Promise<void>) | undefined;
  readonly #afterGenerationLock: (() => Promise<void>) | undefined;
  readonly #directions: DirectionsProvider;
  readonly #providerName: string;

  constructor(
    databaseUrl: string,
    options: Readonly<{
      beforeCommit?: () => Promise<void>;
      afterGenerationLock?: () => Promise<void>;
      directions: DirectionsProvider;
      providerName: string;
    }>,
  ) {
    this.#database = new PostgresExecutor({ databaseUrl, role: "worker" });
    this.#beforeCommit = options.beforeCommit;
    this.#afterGenerationLock = options.afterGenerationLock;
    this.#directions = options.directions;
    this.#providerName = options.providerName;
  }

  async process(event: JobEvent): Promise<{ eventId: string; applied: boolean }> {
    const context = await this.#loadContext(event.aggregateId);
    if (!(await this.#isCoordinator(event, context))) {
      await markSkipped(this.#database, event);
      return { eventId: event.eventId, applied: false };
    }
    const candidates = generateRouteWindow({
      items: context.items,
      routeGenerations: context.routeGenerations,
    }) as RouteCandidate[];
    const resolvedCandidates = await resolveRouteCandidates(
      candidates,
      this.#directions,
      this.#providerName,
      context.mapProfile,
      {
        beforeProvider: () => this.#isCurrentGeneration(event, context),
      },
    );
    await this.#beforeCommit?.();

    const applied = await this.#database.transaction(async (client) => {
      const inbox = await client.query(
        `INSERT INTO job_inbox (consumer_name, event_id, schema_version)
         VALUES ('route-rebuild-worker', $1, $2)
         ON CONFLICT (consumer_name, event_id) DO NOTHING
         RETURNING event_id`,
        [event.eventId, event.schemaVersion],
      );
      if (inbox.rowCount === 0) return false;

      const referencedItemIds = [...new Set(resolvedCandidates.flatMap((candidate) => [
        candidate.fromItineraryItemId,
        candidate.toItineraryItemId,
      ]))].sort();
      if (referencedItemIds.length > 0) {
        await client.query(
          `SELECT id
           FROM itinerary_item
           WHERE trip_id = $1::uuid
             AND id = ANY($2::uuid[])
           ORDER BY id
           FOR KEY SHARE`,
          [context.tripId, referencedItemIds],
        );
      }

      const lockedDays = (await client.query<DayGenerationRow>(
        `SELECT id, route_generation
         FROM trip_day
         WHERE trip_id = $1::uuid
         ORDER BY id
         FOR UPDATE`,
        [context.tripId],
      )).rows;
      const currentGenerations = Object.fromEntries(
        lockedDays.map(({ id, route_generation }) => [id, route_generation]),
      );
      if (!sameGenerations(context.routeGenerations, currentGenerations)) {
        await markHandled(client, event);
        await markSupersededRouteEvents(client, context.tripId, currentGenerations, false);
        return false;
      }
      await this.#afterGenerationLock?.();

      await client.query(
        `UPDATE route_segment
         SET status = 'obsolete', updated_at = now()
         WHERE trip_id = $1::uuid
           AND status <> 'obsolete'`,
        [context.tripId],
      );
      for (const candidate of resolvedCandidates) {
        await insertCandidate(client, context, candidate);
      }
      const routeErrorCode = resolvedCandidates.find(({ routeErrorCode }) => routeErrorCode)?.routeErrorCode ?? null;
      await markHandled(client, event, routeErrorCode);
      await markSupersededRouteEvents(client, context.tripId, currentGenerations);
      return true;
    });
    return { eventId: event.eventId, applied };
  }

  async #isCoordinator(
    event: JobEvent,
    context: { tripId: string; routeGenerations: Record<string, number> },
  ): Promise<boolean> {
    // A day event is stale as soon as a newer generation is committed. This
    // check happens before any provider call, which prevents a burst of old
    // events from re-routing the same trip in parallel.
    if (context.routeGenerations[event.aggregateId] !== Number(event.aggregateVersion)) return false;
    const coordinator = (await this.#database.query<RouteEventRow>(
      `SELECT event.event_id,
              event.event_type,
              event.aggregate_id,
              event.aggregate_type,
              event.aggregate_version::integer,
              event.schema_version
       FROM job_outbox event
       JOIN trip_day day ON day.id::text = event.aggregate_id
       WHERE event.event_type = 'route.rebuild.requested'
         AND event.handled_at IS NULL
         AND day.trip_id = $1::uuid
         AND event.aggregate_version = day.route_generation
       ORDER BY event.created_at, event.event_id
       LIMIT 1`,
      [context.tripId],
    )).rows[0];
    return coordinator?.event_id === event.eventId;
  }

  async #isCurrentGeneration(
    event: JobEvent,
    context: { tripId: string; routeGenerations: Record<string, number> },
  ): Promise<boolean> {
    const current = (await this.#database.query<DayGenerationRow>(
      `SELECT id, route_generation
       FROM trip_day
       WHERE trip_id = $1::uuid
       ORDER BY id`,
      [context.tripId],
    )).rows;
    return sameGenerations(
      context.routeGenerations,
      Object.fromEntries(current.map(({ id, route_generation }) => [id, route_generation])),
    ) && context.routeGenerations[event.aggregateId] === Number(event.aggregateVersion);
  }

  close(): Promise<void> {
    return this.#database.close();
  }

  async #loadContext(dayId: string) {
    const day = (await this.#database.query<{ trip_id: string; owner_id: string; map_profile: string }>(
      `SELECT day.trip_id, trip.owner_id, trip.map_profile
       FROM trip_day day
       JOIN trip ON trip.id = day.trip_id
       WHERE day.id = $1::uuid`,
      [dayId],
    )).rows[0];
    if (!day) throw new Error("ROUTE_REBUILD_DAY_NOT_FOUND");
    const generations = (await this.#database.query<DayGenerationRow>(
      `SELECT id, route_generation
       FROM trip_day
       WHERE trip_id = $1::uuid
       ORDER BY id`,
      [day.trip_id],
    )).rows;
    const rows = (await this.#database.query<RouteItemRow>(
      `SELECT
         item.id, item.trip_day_id, day.day_number, item.sort_order,
         item.version, item.item_type, item.transport_mode_code,
         item.deleted_at,
         location.id AS location_id, location.version AS location_version,
         location.geocoding_status AS location_status,
         ST_X(location.geom::geometry) AS longitude,
         ST_Y(location.geom::geometry) AS latitude,
         location.city,
         location.district,
         start_location.id AS start_location_id,
         start_location.version AS start_location_version,
         start_location.geocoding_status AS start_location_status,
         ST_X(start_location.geom::geometry) AS start_longitude,
         ST_Y(start_location.geom::geometry) AS start_latitude,
         start_location.city AS start_city,
         start_location.district AS start_district,
         end_location.id AS end_location_id,
         end_location.version AS end_location_version,
         end_location.geocoding_status AS end_location_status,
         ST_X(end_location.geom::geometry) AS end_longitude,
         ST_Y(end_location.geom::geometry) AS end_latitude,
         end_location.city AS end_city,
         end_location.district AS end_district
       FROM itinerary_item item
       JOIN trip_day day ON day.id = item.trip_day_id
       LEFT JOIN location ON location.id = item.location_id
       LEFT JOIN location start_location ON start_location.id = item.start_location_id
       LEFT JOIN location end_location ON end_location.id = item.end_location_id
       WHERE item.trip_id = $1::uuid
         AND item.deleted_at IS NULL
       ORDER BY day.day_number, item.sort_order, item.id`,
      [day.trip_id],
    )).rows;
    return {
      tripId: day.trip_id,
      ownerId: day.owner_id,
      mapProfile: day.map_profile,
      routeGenerations: Object.fromEntries(
        generations.map(({ id, route_generation }) => [id, route_generation]),
      ),
      items: rows.map((row) => ({
        id: row.id,
        tripDayId: row.trip_day_id,
        dayNumber: row.day_number,
        sortOrder: row.sort_order,
        version: row.version,
        itemType: row.item_type,
        transportModeCode: row.transport_mode_code ?? undefined,
        deletedAt: row.deleted_at,
        location: routeLocation(
          row.location_id,
          row.location_version,
          row.location_status,
          row.longitude,
          row.latitude,
          row.city,
          row.district,
        ),
        startLocation: routeLocation(
          row.start_location_id,
          row.start_location_version,
          row.start_location_status,
          row.start_longitude,
          row.start_latitude,
          row.start_city,
          row.start_district,
        ),
        endLocation: routeLocation(
          row.end_location_id,
          row.end_location_version,
          row.end_location_status,
          row.end_longitude,
          row.end_latitude,
          row.end_city,
          row.end_district,
        ),
      })),
    };
  }
}

export async function resolveRouteCandidates(
  candidates: RouteCandidate[],
  directions: DirectionsProvider,
  providerName: string,
  mapProfile: string,
  options: RouteResolutionOptions = {},
): Promise<ResolvedCandidate[]> {
  const concurrency = positiveInteger(options.concurrency, ROUTE_PROVIDER_CONCURRENCY);
  const maxAttempts = positiveInteger(options.maxAttempts, ROUTE_PROVIDER_MAX_ATTEMPTS);
  const minIntervalMs = nonNegativeInteger(options.minIntervalMs, ROUTE_PROVIDER_MIN_INTERVAL_MS);
  const baseBackoffMs = nonNegativeInteger(options.baseBackoffMs, ROUTE_PROVIDER_BASE_BACKOFF_MS);
  const maxBackoffMs = nonNegativeInteger(options.maxBackoffMs, ROUTE_PROVIDER_MAX_BACKOFF_MS);
  const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  let nextProviderRequestAt = 0;
  const resolved = new Array<ResolvedCandidate>(candidates.length);

  async function waitForProviderSlot(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, nextProviderRequestAt - now);
    nextProviderRequestAt = Math.max(now, nextProviderRequestAt) + minIntervalMs;
    if (wait > 0) await sleep(wait);
  }

  async function resolveCandidate(candidate: RouteCandidate): Promise<ResolvedCandidate> {
    if (
      candidate.blockers.length > 0
      || !candidate.fromLocation?.point
      || !candidate.toLocation?.point
    ) {
      return {
        ...candidate,
        route: null,
        routeProvider: null,
        routeQuality: "unknown",
        mapProfile,
        routeErrorCode: null,
        routeAttempts: 0,
      };
    }
    const request = {
      from: { ...candidate.fromLocation.point, crs: "WGS84" as const },
      to: { ...candidate.toLocation.point, crs: "WGS84" as const },
      mode: candidate.transportModeCode,
      mapProfile,
      ...(candidate.fromLocation.city ? { city: candidate.fromLocation.city } : {}),
      ...(candidate.toLocation.city ? { cityd: candidate.toLocation.city } : {}),
    };
    let lastErrorCode: string | null = null;
    let attemptsUsed = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attemptsUsed = attempt;
      if (options.beforeProvider && !(await options.beforeProvider())) {
        return {
          ...candidate,
          route: null,
          routeProvider: null,
          routeQuality: "unknown",
          mapProfile,
          routeErrorCode: null,
          routeAttempts: 0,
        };
      }
      try {
        await waitForProviderSlot();
        const route = await directions.route(request);
        return {
          ...candidate,
          route,
          routeProvider: providerName,
          routeQuality: route.kind === "resolved" ? "actual" : "approximate",
          mapProfile,
          routeErrorCode: null,
          routeAttempts: attempt,
        };
      } catch (error) {
        const providerError = mapProviderError(error);
        lastErrorCode = providerError.code;
        if (!providerError.retryable || attempt >= maxAttempts) break;
        const retryAfterMs = providerError.retryAfterSeconds === undefined
          ? 0
          : Math.max(0, providerError.retryAfterSeconds * 1_000);
        const exponentialMs = Math.min(maxBackoffMs, baseBackoffMs * 2 ** (attempt - 1));
        await sleep(Math.min(maxBackoffMs, Math.max(retryAfterMs, exponentialMs)));
      }
    }
    return {
      ...candidate,
      route: null,
      routeProvider: providerName,
      routeQuality: "unknown",
      mapProfile,
      routeErrorCode: lastErrorCode,
      routeAttempts: attemptsUsed,
    };
  }

  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= candidates.length) return;
      resolved[index] = await resolveCandidate(candidates[index]!);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, candidates.length) },
    () => worker(),
  ));
  return resolved;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value >= 0 ? value : fallback;
}

function routeLocation(
  id: string | null,
  version: number | null,
  geocodingStatus: string | null,
  longitude: number | null,
  latitude: number | null,
  city: string | null,
  district: string | null,
) {
  if (!id) return null;
  return {
    id,
    version: version ?? 1,
    geocodingStatus,
    point: longitude === null || latitude === null
      ? null
      : { longitude, latitude, crs: "WGS84" },
    ...(city ? { city } : {}),
    ...(district ? { district } : {}),
  };
}

function sameGenerations(
  expected: Record<string, number>,
  current: Record<string, number>,
): boolean {
  const expectedEntries = Object.entries(expected).sort();
  const currentEntries = Object.entries(current).sort();
  return JSON.stringify(expectedEntries) === JSON.stringify(currentEntries);
}

async function insertCandidate(
  client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  context: { tripId: string; ownerId: string },
  candidate: ResolvedCandidate,
): Promise<void> {
  const resolved = candidate.route !== null;
  const geometry = candidate.route ? {
    type: candidate.route.geometry.type,
    coordinates: candidate.route.geometry.coordinates.map((point) => [point.longitude, point.latitude]),
  } : null;
  await client.query(
    `INSERT INTO route_segment (
       trip_id, owner_id, trip_day_id, segment_kind,
       from_itinerary_item_id, to_itinerary_item_id,
       from_location_id, to_location_id, transport_mode_code,
       route_geometry, route_provider, route_quality, status,
       source_version, source_context
     ) VALUES (
       $1::uuid, $2, $3::uuid, $4,
       $5::uuid, $6::uuid, $7::uuid, $8::uuid, $9,
       CASE WHEN $10::jsonb IS NULL THEN NULL ELSE
         ST_SetSRID(ST_GeomFromGeoJSON($10::jsonb), 4326)
       END,
       $11, $12, $13, $14, $15::jsonb
     )`,
    [
      context.tripId,
      context.ownerId,
      candidate.arrivalDayId,
      candidate.kind,
      candidate.fromItineraryItemId,
      candidate.toItineraryItemId,
      candidate.fromLocation?.id ?? null,
      candidate.toLocation?.id ?? null,
      candidate.transportModeCode,
      geometry ? JSON.stringify(geometry) : null,
      candidate.routeProvider,
      candidate.routeQuality,
      resolved ? "resolved" : candidate.routeErrorCode ? "failed" : "pending",
      candidate.sourceVersion,
      JSON.stringify({
        ...candidate.sourceContext,
        blockers: candidate.blockers,
        ...(candidate.routeErrorCode ? {
          routeErrorCode: candidate.routeErrorCode,
          routeAttempts: candidate.routeAttempts,
        } : {}),
        ...(candidate.route ? {
          attribution: candidate.route.attribution,
          mapProfile: candidate.mapProfile,
          providerMode: candidate.route.mode,
        } : {}),
      }),
    ],
  );
}

async function markHandled(
  client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  event: JobEvent,
  lastErrorCode: string | null = null,
): Promise<void> {
  await client.query(
    `UPDATE job_outbox
     SET handled_at = now(),
         locked_until = NULL,
         last_error_code = $3
     WHERE event_id = $1
       AND event_type = $2`,
    [event.eventId, event.eventType, lastErrorCode],
  );
}

async function markSkipped(database: PostgresExecutor, event: JobEvent): Promise<void> {
  await database.transaction(async (client) => {
    await client.query(
      `INSERT INTO job_inbox (consumer_name, event_id, schema_version)
       VALUES ('route-rebuild-worker', $1, $2)
       ON CONFLICT (consumer_name, event_id) DO NOTHING`,
      [event.eventId, event.schemaVersion],
    );
    await markHandled(client, event);
  });
}

async function markSupersededRouteEvents(
  client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  tripId: string,
  generations: Record<string, number>,
  includeCurrent = true,
): Promise<void> {
  const dayIds = Object.keys(generations);
  if (dayIds.length === 0) return;
  await client.query(
    `UPDATE job_outbox event
     SET handled_at = now(),
         locked_until = NULL,
         last_error_code = NULL
     FROM trip_day day
     WHERE event.event_type = 'route.rebuild.requested'
       AND event.aggregate_id = day.id::text
       AND day.trip_id = $1::uuid
       AND day.id = ANY($2::uuid[])
       AND event.aggregate_version ${includeCurrent ? "<=" : "<"} day.route_generation
       AND event.handled_at IS NULL`,
    [tripId, dayIds],
  );
}
