\set ON_ERROR_STOP on

SELECT 'database|' || current_database() || '|' || oid::text
FROM pg_database
WHERE datname = current_database();

SELECT format(
  'SELECT %L || count(*)::text FROM %I.%I;',
  schemaname || '.' || tablename || '|',
  schemaname,
  tablename
)
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename
\gexec
