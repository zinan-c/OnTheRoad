\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS postgis;

DO $$
BEGIN
  IF PostGIS_Version() IS NULL THEN
    RAISE EXCEPTION 'PostGIS extension did not initialize';
  END IF;
END;
$$;
