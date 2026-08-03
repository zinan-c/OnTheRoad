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
             'transportModeCode', segment.transport_mode_code,
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
}
