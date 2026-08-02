CREATE TABLE IF NOT EXISTS attachment (
  id uuid PRIMARY KEY,
  trip_id uuid,
  owner_id text NOT NULL CHECK (char_length(owner_id) BETWEEN 1 AND 255),
  object_key text NOT NULL UNIQUE
    CHECK (object_key ~ '^attachments/[a-f0-9]{32}/[A-Za-z0-9-]+$'),
  expected_content_type text NOT NULL
    CHECK (expected_content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  expected_content_length bigint NOT NULL
    CHECK (expected_content_length BETWEEN 1 AND 20971520),
  expected_checksum_sha256 text NOT NULL
    CHECK (expected_checksum_sha256 ~ '^[A-Za-z0-9+/]{43}=$'),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'uploaded', 'processing', 'ready', 'failed')),
  object_version text,
  checksum_sha256 text,
  content_type text,
  content_length bigint,
  etag text,
  width integer,
  height integer,
  thumbnail_key text,
  thumbnail_version text,
  thumbnail_checksum_sha256 text,
  thumbnail_content_type text,
  thumbnail_content_length bigint,
  processing_error_code text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (
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
  )
);

ALTER TABLE attachment
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer,
  ADD COLUMN IF NOT EXISTS thumbnail_key text,
  ADD COLUMN IF NOT EXISTS thumbnail_version text,
  ADD COLUMN IF NOT EXISTS thumbnail_checksum_sha256 text,
  ADD COLUMN IF NOT EXISTS thumbnail_content_type text,
  ADD COLUMN IF NOT EXISTS thumbnail_content_length bigint,
  ADD COLUMN IF NOT EXISTS processing_error_code text;

ALTER TABLE attachment
  DROP CONSTRAINT IF EXISTS attachment_status_check,
  DROP CONSTRAINT IF EXISTS attachment_check,
  DROP CONSTRAINT IF EXISTS attachment_media_state_check;

ALTER TABLE attachment
  ADD CONSTRAINT attachment_status_check
    CHECK (status IN ('pending', 'uploaded', 'processing', 'ready', 'failed')),
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
      AND thumbnail_key ~ '^derived/[0-9a-f-]{36}/[A-Za-z0-9-]+$'
      AND thumbnail_version IS NOT NULL
      AND thumbnail_checksum_sha256 ~ '^[A-Za-z0-9+/]{43}=$'
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
      AND processing_error_code ~ '^MEDIA_[A-Z0-9_]+$'
    )
  );

CREATE INDEX IF NOT EXISTS attachment_owner_created_idx
  ON attachment (owner_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS attachment_pending_expiry_idx
  ON attachment (expires_at, id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS attachment_uploaded_processing_idx
  ON attachment (updated_at, id)
  WHERE status IN ('uploaded', 'processing');

CREATE OR REPLACE FUNCTION attachment_as_json(p_attachment_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'id', a.id,
    'ownerId', a.owner_id,
    'objectKey', a.object_key,
    'expectedContentType', a.expected_content_type,
    'expectedContentLength', a.expected_content_length,
    'expectedChecksumSha256', a.expected_checksum_sha256,
    'expiresAt', to_char(
      a.expires_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'status', a.status,
    'objectVersion', a.object_version,
    'checksumSha256', a.checksum_sha256,
    'contentType', a.content_type,
    'contentLength', a.content_length,
    'etag', a.etag,
    'width', a.width,
    'height', a.height,
    'thumbnailKey', a.thumbnail_key,
    'thumbnailVersion', a.thumbnail_version,
    'thumbnailChecksumSha256', a.thumbnail_checksum_sha256,
    'thumbnailContentType', a.thumbnail_content_type,
    'thumbnailContentLength', a.thumbnail_content_length,
    'processingErrorCode', a.processing_error_code,
    'version', a.version,
    'createdAt', to_char(
      a.created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'updatedAt', to_char(
      a.updated_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'completedAt', CASE
      WHEN a.completed_at IS NULL THEN NULL
      ELSE to_char(
        a.completed_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      )
    END
  )
  FROM attachment a
  WHERE a.id = p_attachment_id;
$$;

CREATE OR REPLACE FUNCTION create_attachment(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  attachment_id uuid;
BEGIN
  attachment_id := (p_input->>'id')::uuid;
  INSERT INTO attachment (
    id,
    owner_id,
    object_key,
    expected_content_type,
    expected_content_length,
    expected_checksum_sha256,
    expires_at
  )
  VALUES (
    attachment_id,
    p_input->>'ownerId',
    p_input->>'objectKey',
    p_input->>'expectedContentType',
    (p_input->>'expectedContentLength')::bigint,
    p_input->>'expectedChecksumSha256',
    (p_input->>'expiresAt')::timestamptz
  );
  RETURN attachment_as_json(attachment_id);
END;
$$;

CREATE OR REPLACE FUNCTION claim_attachment_processing(p_attachment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE attachment
  SET
    status = 'processing',
    version = version + 1,
    updated_at = clock_timestamp()
  WHERE id = p_attachment_id AND status = 'uploaded';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEDIA_NOT_CLAIMABLE' USING ERRCODE = 'P0001';
  END IF;
  RETURN attachment_as_json(p_attachment_id);
END;
$$;

CREATE OR REPLACE FUNCTION mark_attachment_ready(
  p_attachment_id uuid,
  p_expected_version integer,
  p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE attachment
  SET
    status = 'ready',
    width = (p_metadata->>'width')::integer,
    height = (p_metadata->>'height')::integer,
    thumbnail_key = p_metadata->>'thumbnailKey',
    thumbnail_version = p_metadata->>'thumbnailVersion',
    thumbnail_checksum_sha256 = p_metadata->>'thumbnailChecksumSha256',
    thumbnail_content_type = p_metadata->>'thumbnailContentType',
    thumbnail_content_length = (p_metadata->>'thumbnailContentLength')::bigint,
    processing_error_code = NULL,
    version = version + 1,
    updated_at = clock_timestamp()
  WHERE
    id = p_attachment_id
    AND status = 'processing'
    AND version = p_expected_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEDIA_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;
  RETURN attachment_as_json(p_attachment_id);
END;
$$;

CREATE OR REPLACE FUNCTION mark_attachment_failed(
  p_attachment_id uuid,
  p_expected_version integer,
  p_error_code text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE attachment
  SET
    status = 'failed',
    processing_error_code = p_error_code,
    version = version + 1,
    updated_at = clock_timestamp()
  WHERE
    id = p_attachment_id
    AND status = 'processing'
    AND version = p_expected_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEDIA_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;
  RETURN attachment_as_json(p_attachment_id);
END;
$$;

CREATE OR REPLACE FUNCTION complete_attachment(
  p_owner_id text,
  p_attachment_id uuid,
  p_expected_version integer,
  p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  current_attachment attachment%ROWTYPE;
BEGIN
  SELECT * INTO current_attachment
  FROM attachment
  WHERE id = p_attachment_id AND owner_id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATTACHMENT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF current_attachment.version <> p_expected_version THEN
    RAISE EXCEPTION 'ATTACHMENT_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;
  IF current_attachment.status <> 'pending' THEN
    RAISE EXCEPTION 'UPLOAD_ALREADY_COMPLETED' USING ERRCODE = 'P0001';
  END IF;
  IF current_attachment.expires_at < clock_timestamp() THEN
    RAISE EXCEPTION 'UPLOAD_SESSION_EXPIRED' USING ERRCODE = 'P0001';
  END IF;
  IF
    p_metadata->>'objectKey' <> current_attachment.object_key
    OR p_metadata->>'contentType' <> current_attachment.expected_content_type
    OR (p_metadata->>'contentLength')::bigint
      <> current_attachment.expected_content_length
    OR p_metadata->>'checksumSha256'
      <> current_attachment.expected_checksum_sha256
  THEN
    RAISE EXCEPTION 'UPLOADED_OBJECT_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  UPDATE attachment
  SET
    status = 'uploaded',
    object_version = p_metadata->>'objectVersion',
    checksum_sha256 = p_metadata->>'checksumSha256',
    content_type = p_metadata->>'contentType',
    content_length = (p_metadata->>'contentLength')::bigint,
    etag = p_metadata->>'etag',
    version = version + 1,
    updated_at = clock_timestamp(),
    completed_at = clock_timestamp()
  WHERE id = p_attachment_id;

  RETURN attachment_as_json(p_attachment_id);
END;
$$;
