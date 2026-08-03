WITH schema_objects AS (
  SELECT
    'column|' || ns.nspname || '|' || cls.relname || '|' || attr.attnum
      || '|' || attr.attname
      || '|' || pg_catalog.format_type(attr.atttypid, attr.atttypmod)
      || '|' || attr.attnotnull
      || '|' || attr.attidentity::text
      || '|' || attr.attgenerated::text
      || '|' || COALESCE(pg_catalog.pg_get_expr(def.adbin, def.adrelid), '') AS definition
  FROM pg_catalog.pg_attribute AS attr
  JOIN pg_catalog.pg_class AS cls ON cls.oid = attr.attrelid
  JOIN pg_catalog.pg_namespace AS ns ON ns.oid = cls.relnamespace
  LEFT JOIN pg_catalog.pg_attrdef AS def
    ON def.adrelid = attr.attrelid AND def.adnum = attr.attnum
  WHERE ns.nspname = 'public'
    AND cls.relkind IN ('r', 'p', 'v', 'm', 'S')
    AND attr.attnum > 0
    AND NOT attr.attisdropped

  UNION ALL

  SELECT
    'constraint|' || ns.nspname || '|' || cls.relname || '|' || con.conname
      || '|' || pg_catalog.pg_get_constraintdef(con.oid, true)
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS cls ON cls.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS ns ON ns.oid = cls.relnamespace
  WHERE ns.nspname = 'public'

  UNION ALL

  SELECT
    'index|' || ns.nspname || '|' || cls.relname || '|' || idx.relname
      || '|' || pg_catalog.pg_get_indexdef(index_meta.indexrelid)
  FROM pg_catalog.pg_index AS index_meta
  JOIN pg_catalog.pg_class AS cls ON cls.oid = index_meta.indrelid
  JOIN pg_catalog.pg_class AS idx ON idx.oid = index_meta.indexrelid
  JOIN pg_catalog.pg_namespace AS ns ON ns.oid = cls.relnamespace
  WHERE ns.nspname = 'public'

  UNION ALL

  SELECT
    'routine|' || ns.nspname || '|' || proc.oid::regprocedure::text
      || '|' || pg_catalog.pg_get_functiondef(proc.oid)
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_namespace AS ns ON ns.oid = proc.pronamespace
  WHERE ns.nspname = 'public'
    AND proc.prokind IN ('f', 'p')

  UNION ALL

  SELECT
    'trigger|' || ns.nspname || '|' || cls.relname || '|' || trigger.tgname
      || '|' || pg_catalog.pg_get_triggerdef(trigger.oid, true)
  FROM pg_catalog.pg_trigger AS trigger
  JOIN pg_catalog.pg_class AS cls ON cls.oid = trigger.tgrelid
  JOIN pg_catalog.pg_namespace AS ns ON ns.oid = cls.relnamespace
  WHERE ns.nspname = 'public'
    AND NOT trigger.tgisinternal

  UNION ALL

  SELECT
    'policy|' || schemaname || '|' || tablename || '|' || policyname
      || '|' || permissive || '|' || roles::text || '|' || cmd
      || '|' || COALESCE(qual, '') || '|' || COALESCE(with_check, '')
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'

  UNION ALL

  SELECT
    'view|' || ns.nspname || '|' || cls.relname
      || '|' || pg_catalog.pg_get_viewdef(cls.oid, true)
  FROM pg_catalog.pg_class AS cls
  JOIN pg_catalog.pg_namespace AS ns ON ns.oid = cls.relnamespace
  WHERE ns.nspname = 'public'
    AND cls.relkind IN ('v', 'm')

  UNION ALL

  SELECT
    'enum|' || ns.nspname || '|' || type.typname || '|'
      || string_agg(enum.enumlabel, ',' ORDER BY enum.enumsortorder)
  FROM pg_catalog.pg_type AS type
  JOIN pg_catalog.pg_namespace AS ns ON ns.oid = type.typnamespace
  JOIN pg_catalog.pg_enum AS enum ON enum.enumtypid = type.oid
  WHERE ns.nspname = 'public'
  GROUP BY ns.nspname, type.typname
)
SELECT md5(string_agg(definition, E'\n' ORDER BY definition)), count(*)
FROM schema_objects;
