DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM attachment WHERE purpose = 'import_source'
  ) THEN
    RAISE EXCEPTION
      '0013 down migration requires import_source attachments to be archived first';
  END IF;
END;
$$;

DROP TABLE IF EXISTS import_inspect_job;
DROP FUNCTION IF EXISTS mark_import_attachment_scan_clean(
  uuid,
  integer,
  text,
  text,
  text
);

ALTER TABLE attachment
  DROP CONSTRAINT IF EXISTS attachment_import_purpose_check,
  DROP CONSTRAINT IF EXISTS attachment_media_state_check,
  DROP CONSTRAINT IF EXISTS attachment_id_owner_unique;

ALTER TABLE attachment
  DROP COLUMN IF EXISTS scan_completed_at,
  DROP COLUMN IF EXISTS scan_engine,
  DROP COLUMN IF EXISTS source_filename,
  DROP COLUMN IF EXISTS purpose;

ALTER TABLE attachment
  ADD CONSTRAINT attachment_expected_content_type_check
    CHECK (expected_content_type IN ('image/jpeg', 'image/png', 'image/webp')),
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
      AND width > 0
      AND height > 0
      AND thumbnail_key IS NOT NULL
      AND thumbnail_version IS NOT NULL
      AND thumbnail_checksum_sha256 IS NOT NULL
      AND thumbnail_content_type = 'image/png'
      AND thumbnail_content_length > 0
      AND processing_error_code IS NULL
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
      AND processing_error_code IS NOT NULL
    )
  );
