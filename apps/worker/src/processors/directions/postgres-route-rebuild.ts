import { generateRouteWindow } from "@on-the-road/domain/routing";
import { PostgresExecutor } from "@on-the-road/database/postgres";
import type { JobEvent } from "@on-the-road/database/jobs";
import type { DirectionsProvider, RouteResult } from "@on-the-road/providers";

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
};

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
    const candidates = generateRouteWindow({
      items: context.items,
      routeGenerations: context.routeGenerations,
    }) as RouteCandidate[];
    const resolvedCandidates = await resolveRouteCandidates(
      candidates,
      this.#directions,
      this.#providerName,
      context.mapProfile,
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
      await markHandled(client, event);
      return true;
    });
    return { eventId: event.eventId, applied };
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
): Promise<ResolvedCandidate[]> {
  return Promise.all(candidates.map(async (candidate) => {
    if (
      candidate.blockers.length > 0
      || !candidate.fromLocation?.point
      || !candidate.toLocation?.point
    ) {
      return { ...candidate, route: null, routeProvider: null, routeQuality: "unknown", mapProfile };
    }
    const route = await directions.route({
      from: { ...candidate.fromLocation.point, crs: "WGS84" },
      to: { ...candidate.toLocation.point, crs: "WGS84" },
      mode: candidate.transportModeCode,
      mapProfile,
      ...(candidate.fromLocation.city ? { city: candidate.fromLocation.city } : {}),
      ...(candidate.toLocation.city ? { cityd: candidate.toLocation.city } : {}),
    });
    return {
      ...candidate,
      route,
      routeProvider: providerName,
      routeQuality: route.kind === "resolved" ? "actual" : "approximate",
      mapProfile,
    };
  }));
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
      resolved ? "resolved" : "pending",
      candidate.sourceVersion,
      JSON.stringify({
        ...candidate.sourceContext,
        blockers: candidate.blockers,
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
): Promise<void> {
  await client.query(
    `UPDATE job_outbox
     SET handled_at = now(),
         locked_until = NULL,
         last_error_code = NULL
     WHERE event_id = $1
       AND event_type = $2`,
    [event.eventId, event.eventType],
  );
}
