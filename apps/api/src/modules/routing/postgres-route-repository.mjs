import { PostgresExecutor } from "@on-the-road/database/postgres";

export class PostgresRouteRepository {
  /** @param {{executor?: any, databaseUrl?: string}} options */
  constructor({ executor, databaseUrl } = {}) {
    this.database = executor ?? new PostgresExecutor({
      databaseUrl,
      role: "api",
    });
  }

  /** @param {string} ownerId @param {string} tripId */
  list(ownerId, tripId) {
    return this.database.json(
      `SELECT COALESCE(
         jsonb_agg(
           jsonb_build_object(
             'id', segment.id,
             'tripDayId', segment.trip_day_id,
             'kind', segment.segment_kind,
             'fromItineraryItemId', segment.from_itinerary_item_id,
             'toItineraryItemId', segment.to_itinerary_item_id,
             'fromLocationId', segment.from_location_id,
             'toLocationId', segment.to_location_id,
             'transportModeCode', segment.transport_mode_code,
             'provider', segment.route_provider,
             'quality', segment.route_quality,
             'status', segment.status,
             'geometry', CASE
               WHEN segment.route_geometry IS NULL THEN NULL
               ELSE ST_AsGeoJSON(segment.route_geometry)::jsonb
             END,
             'sourceVersion', segment.source_version,
             'sourceContext', segment.source_context
           )
           ORDER BY day.day_number, segment.created_at, segment.id
         ),
         '[]'::jsonb
       )
       FROM route_segment segment
       JOIN trip_day day ON day.id = segment.trip_day_id
       WHERE segment.trip_id = $2::uuid
         AND segment.owner_id = $1
         AND segment.status <> 'obsolete'`,
      [ownerId, tripId],
    );
  }

  /** @param {string} ownerId @param {string} tripId */
  status(ownerId, tripId) {
    return this.database.json(
      `WITH days AS (
         SELECT day.id, day.day_number, day.route_generation
         FROM trip_day day
         JOIN trip ON trip.id = day.trip_id
         WHERE day.trip_id = $2::uuid
           AND trip.owner_id = $1
           AND trip.status <> 'deleted'
       ),
       pending_event_days AS (
         SELECT DISTINCT day.id
         FROM days day
         JOIN job_outbox event ON event.aggregate_id = day.id::text
         WHERE event.event_type = 'route.rebuild.requested'
           AND event.handled_at IS NULL
       ),
       active_segments AS (
         SELECT
           segment.trip_day_id,
           segment.status,
           CASE
             WHEN jsonb_typeof(segment.source_context->'blockers') = 'array'
               THEN jsonb_array_length(segment.source_context->'blockers')
             ELSE 0
           END AS blocker_count,
           segment.source_context
         FROM route_segment segment
         WHERE segment.trip_id = $2::uuid
           AND segment.owner_id = $1
           AND segment.status <> 'obsolete'
       ),
       stale_days AS (
         SELECT DISTINCT day.id
         FROM days day
         JOIN active_segments segment
           ON (segment.source_context->'routeGenerations') ? (day.id::text)
         WHERE ((segment.source_context->'routeGenerations'->> (day.id::text))::integer)
             IS DISTINCT FROM day.route_generation
       ),
       pending_segment_days AS (
         SELECT DISTINCT segment.trip_day_id AS id
         FROM active_segments segment
         WHERE segment.status = 'resolving'
            OR (segment.status = 'pending' AND segment.blocker_count = 0)
       ),
       pending_days AS (
         SELECT id FROM pending_event_days
         UNION
         SELECT id FROM stale_days
         UNION
         SELECT id FROM pending_segment_days
       )
       SELECT jsonb_build_object(
         'status', CASE
           WHEN EXISTS (SELECT 1 FROM pending_days) THEN 'loading'
           ELSE 'done'
         END,
         'generations', COALESCE(
           (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'dayId', day.id,
                 'dayNumber', day.day_number,
                 'routeGeneration', day.route_generation
               )
               ORDER BY day.day_number
             )
             FROM days day
           ),
           '[]'::jsonb
         ),
         'pendingDays', (SELECT count(*) FROM pending_days),
         'blockedSegments', (
           SELECT count(*)
           FROM active_segments
           WHERE status = 'pending' AND blocker_count > 0
         ),
         'failedSegments', (
           SELECT count(*)
           FROM active_segments
           WHERE status = 'failed'
         ),
         'pollAfterMs', 1500
       )`,
      [ownerId, tripId],
    );
  }
}
