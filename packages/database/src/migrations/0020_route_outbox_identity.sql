CREATE OR REPLACE FUNCTION request_route_rebuild_days(p_day_ids uuid[])
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  day_id uuid;
  day_trip_id uuid;
  generation integer;
  rebuild_event_id text;
BEGIN
  FOR day_id IN
    SELECT DISTINCT days.value
    FROM unnest(p_day_ids) AS days(value)
    WHERE days.value IS NOT NULL
    ORDER BY days.value
  LOOP
    UPDATE trip_day
    SET route_generation = route_generation + 1,
        updated_at = clock_timestamp()
    WHERE id = day_id
    RETURNING trip_id, route_generation
    INTO day_trip_id, generation;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    UPDATE route_segment
    SET status = 'obsolete',
        updated_at = clock_timestamp()
    WHERE trip_id = day_trip_id
      AND status <> 'obsolete'
      AND (
        trip_day_id = day_id
        OR COALESCE(source_context->'dayIds', '[]'::jsonb) ? day_id::text
      );

    rebuild_event_id := concat(
      'route-rebuild:',
      day_id::text,
      ':',
      generation::text
    );
    INSERT INTO job_outbox (
      event_id, event_type, aggregate_type, aggregate_id,
      aggregate_version, schema_version
    )
    VALUES (
      rebuild_event_id,
      'route.rebuild.requested',
      'route_window',
      day_id::text,
      generation,
      1
    )
    ON CONFLICT (event_id) DO NOTHING;
  END LOOP;
END;
$$;
