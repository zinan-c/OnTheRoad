ALTER TABLE attachment
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'media',
  ADD COLUMN IF NOT EXISTS source_filename text,
  ADD COLUMN IF NOT EXISTS scan_engine text,
  ADD COLUMN IF NOT EXISTS scan_completed_at timestamptz;

ALTER TABLE attachment
  DROP CONSTRAINT IF EXISTS attachment_expected_content_type_check,
  DROP CONSTRAINT IF EXISTS attachment_media_state_check,
  DROP CONSTRAINT IF EXISTS attachment_import_purpose_check;

ALTER TABLE attachment
  ADD CONSTRAINT attachment_import_purpose_check CHECK (
    (
      purpose = 'media'
      AND source_filename IS NULL
      AND expected_content_type IN ('image/jpeg', 'image/png', 'image/webp')
    )
    OR
    (
      purpose = 'import_source'
      AND (
        (
          source_filename ~* '\.xlsx$'
          AND expected_content_type =
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        OR
        (
          source_filename ~* '\.xls$'
          AND expected_content_type = 'application/vnd.ms-excel'
        )
        OR
        (
          source_filename ~* '\.csv$'
          AND expected_content_type = 'text/csv'
        )
      )
    )
  ),
  ADD CONSTRAINT attachment_media_state_check CHECK (
    (
      status = 'pending'
      AND object_version IS NULL
      AND checksum_sha256 IS NULL
      AND content_type IS NULL
      AND content_length IS NULL
      AND etag IS NULL
      AND completed_at IS NULL
      AND width IS NULL
      AND height IS NULL
      AND thumbnail_key IS NULL
      AND processing_error_code IS NULL
    )
    OR
    (
      status IN ('uploaded', 'processing')
      AND object_version IS NOT NULL
      AND checksum_sha256 = expected_checksum_sha256
      AND content_type = expected_content_type
      AND content_length = expected_content_length
      AND etag IS NOT NULL
      AND completed_at IS NOT NULL
      AND width IS NULL
      AND height IS NULL
      AND thumbnail_key IS NULL
      AND processing_error_code IS NULL
    )
    OR
    (
      status = 'ready'
      AND object_version IS NOT NULL
      AND checksum_sha256 = expected_checksum_sha256
      AND content_type = expected_content_type
      AND content_length = expected_content_length
      AND etag IS NOT NULL
      AND completed_at IS NOT NULL
      AND processing_error_code IS NULL
      AND (
        (
          purpose = 'media'
          AND width > 0
          AND height > 0
          AND thumbnail_key ~ '^derived/[0-9a-f-]{36}/[A-Za-z0-9-]+$'
          AND thumbnail_version IS NOT NULL
          AND thumbnail_checksum_sha256 ~ '^[A-Za-z0-9+/]{43}=$'
          AND thumbnail_content_type = 'image/png'
          AND thumbnail_content_length > 0
        )
        OR
        (
          purpose = 'import_source'
          AND width IS NULL
          AND height IS NULL
          AND thumbnail_key IS NULL
          AND thumbnail_version IS NULL
          AND thumbnail_checksum_sha256 IS NULL
          AND thumbnail_content_type IS NULL
          AND thumbnail_content_length IS NULL
          AND char_length(btrim(scan_engine)) > 0
          AND scan_completed_at IS NOT NULL
        )
      )
    )
    OR
    (
      status = 'failed'
      AND object_version IS NOT NULL
      AND checksum_sha256 = expected_checksum_sha256
      AND content_type = expected_content_type
      AND content_length = expected_content_length
      AND etag IS NOT NULL
      AND completed_at IS NOT NULL
      AND width IS NULL
      AND height IS NULL
      AND thumbnail_key IS NULL
      AND processing_error_code ~ '^[A-Z][A-Z0-9_]+$'
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'attachment_id_owner_unique'
      AND conrelid = 'attachment'::regclass
  ) THEN
    ALTER TABLE attachment
      ADD CONSTRAINT attachment_id_owner_unique UNIQUE (id, owner_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION mark_import_attachment_scan_clean(
  p_attachment_id uuid,
  p_expected_version integer,
  p_object_version text,
  p_checksum_sha256 text,
  p_scan_engine text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  updated_id uuid;
BEGIN
  IF p_scan_engine IS NULL OR btrim(p_scan_engine) = '' THEN
    RAISE EXCEPTION 'IMPORT_SCAN_ENGINE_REQUIRED'
      USING ERRCODE = '23514';
  END IF;

  UPDATE attachment
  SET
    status = 'ready',
    scan_engine = p_scan_engine,
    scan_completed_at = now(),
    version = version + 1,
    updated_at = now()
  WHERE id = p_attachment_id
    AND purpose = 'import_source'
    AND status = 'uploaded'
    AND version = p_expected_version
    AND object_version = p_object_version
    AND checksum_sha256 = p_checksum_sha256
  RETURNING id INTO updated_id;

  IF updated_id IS NULL THEN
    RAISE EXCEPTION 'IMPORT_SCAN_VERSION_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  RETURN attachment_as_json(updated_id)
    || jsonb_build_object(
      'purpose', 'import_source',
      'scanEngine', p_scan_engine,
      'scanCompletedAt', (
        SELECT to_char(
          scan_completed_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        )
        FROM attachment
        WHERE id = updated_id
      )
    );
END;
$$;

\ir ../schema/import-inspect.sql
