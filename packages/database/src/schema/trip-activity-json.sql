CREATE OR REPLACE FUNCTION trip_as_json(p_trip_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'id', t.id,
    'ownerId', t.owner_id,
    'name', t.name,
    'startDate', to_char(t.start_date, 'YYYY-MM-DD'),
    'endDate', to_char(t.end_date, 'YYYY-MM-DD'),
    'totalDays', t.total_days,
    'travelers', t.travelers,
    'defaultCurrency', t.default_currency,
    'budget', CASE WHEN t.budget IS NULL THEN NULL ELSE to_char(t.budget, 'FM9999999999999990.00') END,
    'timezone', t.timezone,
    'mapProfile', t.map_profile,
    'description', t.description,
    'status', t.status,
    'version', t.version,
    'createdAt', to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'updatedAt', to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'lastActivityAt', to_char(t.last_activity_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'deletedAt', CASE
      WHEN t.deleted_at IS NULL THEN NULL
      ELSE to_char(t.deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    END,
    'destinations', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', d.id,
            'name', d.name,
            'countryCode', d.country_code,
            'city', d.city,
            'region', d.region,
            'sortOrder', d.sort_order,
            'createdAt', to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'updatedAt', to_char(d.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          )
          ORDER BY d.sort_order
        )
        FROM destination d
        WHERE d.trip_id = t.id
      ),
      '[]'::jsonb
    )
  )
  FROM trip t
  WHERE t.id = p_trip_id;
$$;
