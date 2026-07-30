\ir ../schema/itinerary.sql
\ir ../schema/accommodation.sql
\ir ../schema/dining.sql

CREATE OR REPLACE FUNCTION itinerary_item_as_json(p_item_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'id', item.id,
    'tripId', item.trip_id,
    'ownerId', item.owner_id,
    'tripDayId', item.trip_day_id,
    'itemType', item.item_type,
    'timeKind', item.time_kind,
    'startTime', CASE
      WHEN item.start_time IS NULL THEN NULL
      ELSE to_char(item.start_time, 'HH24:MI')
    END,
    'endTime', CASE
      WHEN item.end_time IS NULL THEN NULL
      ELSE to_char(item.end_time, 'HH24:MI')
    END,
    'endDayOffset', item.end_day_offset,
    'timeZone', item.time_zone,
    'timePeriod', item.time_period,
    'target', item.target,
    'description', item.description,
    'durationMinutes', item.duration_minutes,
    'destinationId', item.destination_id,
    'locationId', item.location_id,
    'startLocationId', item.start_location_id,
    'endLocationId', item.end_location_id,
    'transportModeCode', item.transport_mode_code,
    'bookingInfoCiphertext', CASE
      WHEN item.booking_info_ciphertext IS NULL THEN NULL
      ELSE encode(item.booking_info_ciphertext, 'base64')
    END,
    'bookingInfoKeyVersion', item.booking_info_key_version,
    'contactInfoCiphertext', CASE
      WHEN item.contact_info_ciphertext IS NULL THEN NULL
      ELSE encode(item.contact_info_ciphertext, 'base64')
    END,
    'contactInfoKeyVersion', item.contact_info_key_version,
    'remark', item.remark,
    'externalSource', item.external_source,
    'externalId', item.external_id,
    'sortOrder', item.sort_order,
    'version', item.version,
    'createdAt', to_char(
      item.created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'updatedAt', to_char(
      item.updated_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'deletedAt', CASE
      WHEN item.deleted_at IS NULL THEN NULL
      ELSE to_char(
        item.deleted_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      )
    END,
    'dining', CASE
      WHEN dining.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'name', dining.name,
        'mealType', dining.meal_type,
        'details', dining.details,
        'locationId', dining.location_id
      )
    END,
    'accommodation', CASE
      WHEN accommodation_row.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'name', accommodation_row.name,
        'details', accommodation_row.details,
        'locationId', accommodation_row.location_id,
        'checkInAt', CASE
          WHEN accommodation_row.check_in_at IS NULL THEN NULL
          ELSE to_char(
            accommodation_row.check_in_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )
        END,
        'checkOutAt', CASE
          WHEN accommodation_row.check_out_at IS NULL THEN NULL
          ELSE to_char(
            accommodation_row.check_out_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )
        END,
        'bookingInfoCiphertext', CASE
          WHEN accommodation_row.booking_info_ciphertext IS NULL THEN NULL
          ELSE encode(accommodation_row.booking_info_ciphertext, 'base64')
        END,
        'bookingInfoKeyVersion', accommodation_row.booking_info_key_version,
        'contactInfoCiphertext', CASE
          WHEN accommodation_row.contact_info_ciphertext IS NULL THEN NULL
          ELSE encode(accommodation_row.contact_info_ciphertext, 'base64')
        END,
        'contactInfoKeyVersion', accommodation_row.contact_info_key_version
      )
    END
  )
  FROM itinerary_item item
  LEFT JOIN dining_item dining
    ON dining.itinerary_item_id = item.id
  LEFT JOIN accommodation accommodation_row
    ON accommodation_row.itinerary_item_id = item.id
  WHERE item.id = p_item_id;
$$;

CREATE OR REPLACE FUNCTION create_itinerary_item(
  p_owner_id text,
  p_trip_id uuid,
  p_input jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  new_item_id uuid;
  next_sort_order integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM trip
    WHERE id = p_trip_id
      AND owner_id = p_owner_id
      AND status <> 'deleted'
  ) THEN
    RAISE EXCEPTION 'ITINERARY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM trip_day
    WHERE id = (p_input->>'tripDayId')::uuid
      AND trip_id = p_trip_id
  ) THEN
    RAISE EXCEPTION 'ITINERARY_REFERENCE_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_input->>'tripDayId', 0));
  SELECT COALESCE(max(sort_order) + 1024, 1024)
  INTO next_sort_order
  FROM itinerary_item
  WHERE trip_day_id = (p_input->>'tripDayId')::uuid
    AND deleted_at IS NULL;

  BEGIN
    INSERT INTO itinerary_item (
      trip_id, owner_id, trip_day_id, item_type, time_kind,
      start_time, end_time, end_day_offset, time_zone, time_period,
      target, description, duration_minutes, destination_id, location_id,
      start_location_id, end_location_id, transport_mode_code,
      booking_info_ciphertext, booking_info_key_version,
      contact_info_ciphertext, contact_info_key_version,
      remark, external_source, external_id, sort_order
    )
    VALUES (
      p_trip_id,
      p_owner_id,
      (p_input->>'tripDayId')::uuid,
      p_input->>'itemType',
      p_input->>'timeKind',
      NULLIF(p_input->>'startTime', '')::time,
      NULLIF(p_input->>'endTime', '')::time,
      (p_input->>'endDayOffset')::smallint,
      NULLIF(p_input->>'timeZone', ''),
      NULLIF(p_input->>'timePeriod', ''),
      NULLIF(p_input->>'target', ''),
      NULLIF(p_input->>'description', ''),
      NULLIF(p_input->>'durationMinutes', '')::integer,
      NULLIF(p_input->>'destinationId', '')::uuid,
      NULLIF(p_input->>'locationId', '')::uuid,
      NULLIF(p_input->>'startLocationId', '')::uuid,
      NULLIF(p_input->>'endLocationId', '')::uuid,
      NULLIF(p_input->>'transportModeCode', ''),
      CASE
        WHEN nullif(p_input->>'bookingInfoCiphertext', '') IS NULL THEN NULL
        ELSE decode(p_input->>'bookingInfoCiphertext', 'base64')
      END,
      NULLIF(p_input->>'bookingInfoKeyVersion', ''),
      CASE
        WHEN nullif(p_input->>'contactInfoCiphertext', '') IS NULL THEN NULL
        ELSE decode(p_input->>'contactInfoCiphertext', 'base64')
      END,
      NULLIF(p_input->>'contactInfoKeyVersion', ''),
      NULLIF(p_input->>'remark', ''),
      NULLIF(p_input->>'externalSource', ''),
      NULLIF(p_input->>'externalId', ''),
      next_sort_order
    )
    RETURNING id INTO new_item_id;

    IF p_input->'dining' IS NOT NULL
      AND p_input->'dining' <> 'null'::jsonb
    THEN
      INSERT INTO dining_item (
        itinerary_item_id, trip_id, meal_type, name, details, location_id
      )
      VALUES (
        new_item_id,
        p_trip_id,
        NULLIF(p_input->'dining'->>'mealType', ''),
        p_input->'dining'->>'name',
        NULLIF(p_input->'dining'->>'details', ''),
        NULLIF(p_input->'dining'->>'locationId', '')::uuid
      );
    END IF;

    IF p_input->'accommodation' IS NOT NULL
      AND p_input->'accommodation' <> 'null'::jsonb
    THEN
      INSERT INTO accommodation (
        itinerary_item_id, trip_id, location_id, name, details,
        check_in_at, check_out_at,
        booking_info_ciphertext, booking_info_key_version,
        contact_info_ciphertext, contact_info_key_version
      )
      VALUES (
        new_item_id,
        p_trip_id,
        NULLIF(p_input->'accommodation'->>'locationId', '')::uuid,
        p_input->'accommodation'->>'name',
        NULLIF(p_input->'accommodation'->>'details', ''),
        NULLIF(p_input->'accommodation'->>'checkInAt', '')::timestamptz,
        NULLIF(p_input->'accommodation'->>'checkOutAt', '')::timestamptz,
        CASE
          WHEN nullif(
            p_input->'accommodation'->>'bookingInfoCiphertext',
            ''
          ) IS NULL THEN NULL
          ELSE decode(
            p_input->'accommodation'->>'bookingInfoCiphertext',
            'base64'
          )
        END,
        NULLIF(p_input->'accommodation'->>'bookingInfoKeyVersion', ''),
        CASE
          WHEN nullif(
            p_input->'accommodation'->>'contactInfoCiphertext',
            ''
          ) IS NULL THEN NULL
          ELSE decode(
            p_input->'accommodation'->>'contactInfoCiphertext',
            'base64'
          )
        END,
        NULLIF(p_input->'accommodation'->>'contactInfoKeyVersion', '')
      );
    END IF;
  EXCEPTION
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'ITINERARY_REFERENCE_MISMATCH' USING ERRCODE = 'P0001';
  END;

  INSERT INTO itinerary_item_audit (
    itinerary_item_id, trip_id, owner_id, action, version, changes
  )
  VALUES (
    new_item_id,
    p_trip_id,
    p_owner_id,
    'itinerary.created',
    1,
    jsonb_build_object(
      'itemType', p_input->>'itemType',
      'tripDayId', p_input->>'tripDayId'
    )
  );
  RETURN itinerary_item_as_json(new_item_id);
END;
$$;

CREATE OR REPLACE FUNCTION update_itinerary_item(
  p_owner_id text,
  p_trip_id uuid,
  p_item_id uuid,
  p_expected_version integer,
  p_input jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  current_item itinerary_item%ROWTYPE;
  next_version integer;
BEGIN
  SELECT * INTO current_item
  FROM itinerary_item
  WHERE id = p_item_id
    AND trip_id = p_trip_id
    AND owner_id = p_owner_id
    AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITINERARY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF current_item.version <> p_expected_version THEN
    RAISE EXCEPTION 'ITINERARY_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  next_version := current_item.version + 1;
  BEGIN
    UPDATE itinerary_item
    SET
      item_type = p_input->>'itemType',
      time_kind = p_input->>'timeKind',
      start_time = NULLIF(p_input->>'startTime', '')::time,
      end_time = NULLIF(p_input->>'endTime', '')::time,
      end_day_offset = (p_input->>'endDayOffset')::smallint,
      time_zone = NULLIF(p_input->>'timeZone', ''),
      time_period = NULLIF(p_input->>'timePeriod', ''),
      target = NULLIF(p_input->>'target', ''),
      description = NULLIF(p_input->>'description', ''),
      duration_minutes = NULLIF(p_input->>'durationMinutes', '')::integer,
      destination_id = NULLIF(p_input->>'destinationId', '')::uuid,
      location_id = NULLIF(p_input->>'locationId', '')::uuid,
      start_location_id = NULLIF(p_input->>'startLocationId', '')::uuid,
      end_location_id = NULLIF(p_input->>'endLocationId', '')::uuid,
      transport_mode_code = NULLIF(p_input->>'transportModeCode', ''),
      booking_info_ciphertext = CASE
        WHEN nullif(p_input->>'bookingInfoCiphertext', '') IS NULL THEN NULL
        ELSE decode(p_input->>'bookingInfoCiphertext', 'base64')
      END,
      booking_info_key_version = NULLIF(p_input->>'bookingInfoKeyVersion', ''),
      contact_info_ciphertext = CASE
        WHEN nullif(p_input->>'contactInfoCiphertext', '') IS NULL THEN NULL
        ELSE decode(p_input->>'contactInfoCiphertext', 'base64')
      END,
      contact_info_key_version = NULLIF(p_input->>'contactInfoKeyVersion', ''),
      remark = NULLIF(p_input->>'remark', ''),
      external_source = NULLIF(p_input->>'externalSource', ''),
      external_id = NULLIF(p_input->>'externalId', ''),
      version = next_version,
      updated_at = clock_timestamp()
    WHERE id = p_item_id;

    DELETE FROM dining_item WHERE itinerary_item_id = p_item_id;
    IF p_input->'dining' IS NOT NULL
      AND p_input->'dining' <> 'null'::jsonb
    THEN
      INSERT INTO dining_item (
        itinerary_item_id, trip_id, meal_type, name, details, location_id
      )
      VALUES (
        p_item_id,
        p_trip_id,
        NULLIF(p_input->'dining'->>'mealType', ''),
        p_input->'dining'->>'name',
        NULLIF(p_input->'dining'->>'details', ''),
        NULLIF(p_input->'dining'->>'locationId', '')::uuid
      );
    END IF;

    DELETE FROM accommodation WHERE itinerary_item_id = p_item_id;
    IF p_input->'accommodation' IS NOT NULL
      AND p_input->'accommodation' <> 'null'::jsonb
    THEN
      INSERT INTO accommodation (
        itinerary_item_id, trip_id, location_id, name, details,
        check_in_at, check_out_at,
        booking_info_ciphertext, booking_info_key_version,
        contact_info_ciphertext, contact_info_key_version
      )
      VALUES (
        p_item_id,
        p_trip_id,
        NULLIF(p_input->'accommodation'->>'locationId', '')::uuid,
        p_input->'accommodation'->>'name',
        NULLIF(p_input->'accommodation'->>'details', ''),
        NULLIF(p_input->'accommodation'->>'checkInAt', '')::timestamptz,
        NULLIF(p_input->'accommodation'->>'checkOutAt', '')::timestamptz,
        CASE
          WHEN nullif(
            p_input->'accommodation'->>'bookingInfoCiphertext',
            ''
          ) IS NULL THEN NULL
          ELSE decode(
            p_input->'accommodation'->>'bookingInfoCiphertext',
            'base64'
          )
        END,
        NULLIF(p_input->'accommodation'->>'bookingInfoKeyVersion', ''),
        CASE
          WHEN nullif(
            p_input->'accommodation'->>'contactInfoCiphertext',
            ''
          ) IS NULL THEN NULL
          ELSE decode(
            p_input->'accommodation'->>'contactInfoCiphertext',
            'base64'
          )
        END,
        NULLIF(p_input->'accommodation'->>'contactInfoKeyVersion', '')
      );
    END IF;
  EXCEPTION
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'ITINERARY_REFERENCE_MISMATCH' USING ERRCODE = 'P0001';
  END;

  INSERT INTO itinerary_item_audit (
    itinerary_item_id, trip_id, owner_id, action, version, changes
  )
  VALUES (
    p_item_id,
    p_trip_id,
    p_owner_id,
    'itinerary.updated',
    next_version,
    jsonb_build_object('itemType', p_input->>'itemType')
  );
  RETURN itinerary_item_as_json(p_item_id);
END;
$$;

CREATE OR REPLACE FUNCTION delete_itinerary_item(
  p_owner_id text,
  p_trip_id uuid,
  p_item_id uuid,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  current_item itinerary_item%ROWTYPE;
BEGIN
  SELECT * INTO current_item
  FROM itinerary_item
  WHERE id = p_item_id
    AND trip_id = p_trip_id
    AND owner_id = p_owner_id
    AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITINERARY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF current_item.version <> p_expected_version THEN
    RAISE EXCEPTION 'ITINERARY_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  UPDATE itinerary_item
  SET
    deleted_at = clock_timestamp(),
    version = version + 1,
    updated_at = clock_timestamp()
  WHERE id = p_item_id;

  INSERT INTO itinerary_item_audit (
    itinerary_item_id, trip_id, owner_id, action, version, changes
  )
  VALUES (
    p_item_id,
    p_trip_id,
    p_owner_id,
    'itinerary.deleted',
    current_item.version + 1,
    '{}'::jsonb
  );
  RETURN itinerary_item_as_json(p_item_id);
END;
$$;

CREATE OR REPLACE FUNCTION copy_itinerary_item(
  p_owner_id text,
  p_trip_id uuid,
  p_item_id uuid,
  p_target_day_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  source_json jsonb;
  copied_json jsonb;
BEGIN
  SELECT itinerary_item_as_json(item.id)
  INTO source_json
  FROM itinerary_item item
  WHERE item.id = p_item_id
    AND item.trip_id = p_trip_id
    AND item.owner_id = p_owner_id
    AND item.deleted_at IS NULL;
  IF source_json IS NULL THEN
    RAISE EXCEPTION 'ITINERARY_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM trip_day
    WHERE id = p_target_day_id AND trip_id = p_trip_id
  ) THEN
    RAISE EXCEPTION 'ITINERARY_REFERENCE_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  source_json := source_json
    || jsonb_build_object(
      'tripDayId', p_target_day_id,
      'externalSource', NULL,
      'externalId', NULL
    );
  copied_json := create_itinerary_item(p_owner_id, p_trip_id, source_json);
  UPDATE itinerary_item_audit
  SET
    action = 'itinerary.copied',
    changes = jsonb_build_object('sourceItemId', p_item_id)
  WHERE audit_id = (
    SELECT max(audit_id)
    FROM itinerary_item_audit
    WHERE itinerary_item_id = (copied_json->>'id')::uuid
  );
  RETURN copied_json;
END;
$$;
