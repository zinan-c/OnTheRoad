CREATE TABLE IF NOT EXISTS attachment (
  id uuid PRIMARY KEY,
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
    CHECK (status IN ('pending', 'uploaded')),
  object_version text,
  checksum_sha256 text,
  content_type text,
  content_length bigint,
  etag text,
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
      status = 'uploaded'
      AND object_version IS NOT NULL
      AND checksum_sha256 = expected_checksum_sha256
      AND content_type = expected_content_type
      AND content_length = expected_content_length
      AND etag IS NOT NULL
      AND completed_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS attachment_owner_created_idx
  ON attachment (owner_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS attachment_pending_expiry_idx
  ON attachment (expires_at, id)
  WHERE status = 'pending';

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
