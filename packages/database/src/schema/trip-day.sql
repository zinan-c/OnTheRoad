CREATE TABLE IF NOT EXISTS trip_day (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  day_number integer NOT NULL CHECK (day_number > 0),
  date date NOT NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_workday boolean NOT NULL,
  workday_override boolean,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  route_generation integer NOT NULL DEFAULT 0 CHECK (route_generation >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, day_number),
  UNIQUE (trip_id, date)
);

CREATE INDEX IF NOT EXISTS trip_day_trip_date_idx ON trip_day (trip_id, date);

CREATE OR REPLACE FUNCTION insert_trip_date_days(
  p_trip_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO trip_day (
    trip_id, day_number, date, day_of_week, is_workday
  )
  SELECT
    p_trip_id,
    series.ordinality::integer,
    series.value::date,
    extract(dow FROM series.value)::smallint,
    extract(isodow FROM series.value) BETWEEN 1 AND 5
  FROM generate_series(p_start_date, p_end_date, interval '1 day')
    WITH ORDINALITY AS series(value, ordinality)
  ON CONFLICT (trip_id, date) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION generate_trip_days_after_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM insert_trip_date_days(NEW.id, NEW.start_date, NEW.end_date);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_generate_days_after_insert ON trip;
CREATE TRIGGER trip_generate_days_after_insert
AFTER INSERT ON trip
FOR EACH ROW EXECUTE FUNCTION generate_trip_days_after_insert();

SELECT insert_trip_date_days(id, start_date, end_date)
FROM trip;

CREATE OR REPLACE FUNCTION guard_trip_date_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.start_date, NEW.end_date) IS DISTINCT FROM (OLD.start_date, OLD.end_date)
    AND current_setting('otr.date_change_context', true) <> 'apply'
  THEN
    RAISE EXCEPTION 'DATE_CHANGE_USE_PREVIEW_APPLY' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_guard_date_update ON trip;
CREATE TRIGGER trip_guard_date_update
BEFORE UPDATE OF start_date, end_date ON trip
FOR EACH ROW EXECUTE FUNCTION guard_trip_date_update();

CREATE OR REPLACE FUNCTION trip_day_content_summary(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result jsonb := '{}'::jsonb;
BEGIN
  IF to_regclass('public.itinerary_item') IS NOT NULL THEN
    EXECUTE $query$
      SELECT COALESCE(
        jsonb_object_agg(
          day.date::text,
          day.content
        ),
        '{}'::jsonb
      )
      FROM (
        SELECT
          td.date,
          jsonb_agg(
            jsonb_build_object('type', 'item', 'id', item.id)
            ORDER BY item.id
          ) AS content
        FROM trip_day td
        JOIN itinerary_item item ON item.trip_day_id = td.id
        WHERE td.trip_id = $1
          AND COALESCE(item.deleted_at IS NULL, true)
        GROUP BY td.date
      ) day
    $query$ INTO result USING p_trip_id;
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION trip_date_context(p_owner_id text, p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'version', t.version,
    'startDate', to_char(t.start_date, 'YYYY-MM-DD'),
    'endDate', to_char(t.end_date, 'YYYY-MM-DD'),
    'totalDays', t.total_days,
    'days', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', td.id,
          'dayNumber', td.day_number,
          'date', to_char(td.date, 'YYYY-MM-DD'),
          'dayOfWeek', td.day_of_week,
          'isWorkday', td.is_workday,
          'workdayOverride', td.workday_override,
          'version', td.version
        )
        ORDER BY td.day_number
      ) FILTER (WHERE td.id IS NOT NULL),
      '[]'::jsonb
    ),
    'contentByDate', trip_day_content_summary(t.id)
  )
  INTO result
  FROM trip t
  LEFT JOIN trip_day td ON td.trip_id = t.id
  WHERE t.id = p_trip_id
    AND t.owner_id = p_owner_id
    AND t.status <> 'deleted'
  GROUP BY t.id;

  IF result IS NULL THEN
    RAISE EXCEPTION 'TRIP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION apply_trip_date_range(
  p_owner_id text,
  p_trip_id uuid,
  p_expected_version integer,
  p_start_date date,
  p_end_date date,
  p_confirm_destructive boolean
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  current_trip trip%ROWTYPE;
  blocked jsonb;
BEGIN
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'INVALID_DATE_RANGE' USING ERRCODE = '22007';
  END IF;

  SELECT * INTO current_trip
  FROM trip
  WHERE id = p_trip_id AND owner_id = p_owner_id AND status <> 'deleted'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRIP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF current_trip.version <> p_expected_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
  INTO blocked
  FROM jsonb_each(trip_day_content_summary(p_trip_id)) entry
  WHERE entry.key::date < p_start_date OR entry.key::date > p_end_date;
  IF blocked <> '{}'::jsonb AND NOT p_confirm_destructive THEN
    RAISE EXCEPTION 'DATE_CHANGE_CONFIRMATION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('otr.date_change_context', 'apply', true);
  UPDATE trip
  SET
    start_date = p_start_date,
    end_date = p_end_date,
    version = version + 1,
    updated_at = clock_timestamp()
  WHERE id = p_trip_id;

  DELETE FROM trip_day
  WHERE trip_id = p_trip_id
    AND (date < p_start_date OR date > p_end_date);

  UPDATE trip_day
  SET day_number = day_number + 100000
  WHERE trip_id = p_trip_id;

  PERFORM insert_trip_date_days(p_trip_id, p_start_date, p_end_date);

  WITH expected AS (
    SELECT
      series.value::date AS date,
      series.ordinality::integer AS day_number,
      extract(dow FROM series.value)::smallint AS day_of_week,
      extract(isodow FROM series.value) BETWEEN 1 AND 5 AS is_workday
    FROM generate_series(p_start_date, p_end_date, interval '1 day')
      WITH ORDINALITY AS series(value, ordinality)
  )
  UPDATE trip_day td
  SET
    day_number = expected.day_number,
    day_of_week = expected.day_of_week,
    is_workday = COALESCE(td.workday_override, expected.is_workday),
    version = td.version + 1,
    updated_at = clock_timestamp()
  FROM expected
  WHERE td.trip_id = p_trip_id AND td.date = expected.date;

  INSERT INTO trip_audit (trip_id, owner_id, action, version, changes)
  SELECT
    p_trip_id,
    p_owner_id,
    'trip.updated',
    version,
    jsonb_build_object(
      'startDate', to_char(p_start_date, 'YYYY-MM-DD'),
      'endDate', to_char(p_end_date, 'YYYY-MM-DD')
    )
  FROM trip WHERE id = p_trip_id;

  RETURN trip_date_context(p_owner_id, p_trip_id);
END;
$$;
