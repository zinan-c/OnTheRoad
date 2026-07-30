DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM attachment
    WHERE status IN ('processing', 'ready', 'failed')
  ) THEN
    RAISE EXCEPTION
      'Cannot roll back attachment media processing while processed rows exist';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS mark_attachment_failed(uuid, integer, text);
DROP FUNCTION IF EXISTS mark_attachment_ready(uuid, integer, jsonb);
DROP FUNCTION IF EXISTS claim_attachment_processing(uuid);
DROP INDEX IF EXISTS attachment_uploaded_processing_idx;

ALTER TABLE attachment
  DROP CONSTRAINT IF EXISTS attachment_media_state_check,
  DROP CONSTRAINT IF EXISTS attachment_status_check,
  DROP COLUMN IF EXISTS width,
  DROP COLUMN IF EXISTS height,
  DROP COLUMN IF EXISTS thumbnail_key,
  DROP COLUMN IF EXISTS thumbnail_version,
  DROP COLUMN IF EXISTS thumbnail_checksum_sha256,
  DROP COLUMN IF EXISTS thumbnail_content_type,
  DROP COLUMN IF EXISTS thumbnail_content_length,
  DROP COLUMN IF EXISTS processing_error_code;

ALTER TABLE attachment
  ADD CONSTRAINT attachment_status_check
    CHECK (status IN ('pending', 'uploaded')),
  ADD CONSTRAINT attachment_check CHECK (
    (
      status = 'pending'
      AND object_version IS NULL
      AND checksum_sha256 IS NULL
      AND content_type IS NULL
      AND content_length IS NULL
      AND etag IS NULL
      AND completed_at IS NULL
    )
    OR
    (
      status = 'uploaded'
      AND object_version IS NOT NULL
      AND checksum_sha256 = expected_checksum_sha256
      AND content_type = expected_content_type
      AND content_length = expected_content_length
      AND etag IS NOT NULL
      AND completed_at IS NOT NULL
    )
  );
