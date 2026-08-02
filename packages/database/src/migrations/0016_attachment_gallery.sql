ALTER TABLE attachment
  ADD COLUMN IF NOT EXISTS trip_id uuid,
  ADD COLUMN IF NOT EXISTS itinerary_item_id uuid,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS caption text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_cover boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE attachment
  DROP CONSTRAINT IF EXISTS attachment_gallery_sort_order_check,
  DROP CONSTRAINT IF EXISTS attachment_gallery_caption_check;

ALTER TABLE attachment
  ADD CONSTRAINT attachment_gallery_sort_order_check CHECK (sort_order >= 0),
  ADD CONSTRAINT attachment_gallery_caption_check CHECK (char_length(caption) <= 2000);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attachment_gallery_trip_fk') THEN
    ALTER TABLE attachment
      ADD CONSTRAINT attachment_gallery_trip_fk
      FOREIGN KEY (trip_id) REFERENCES trip(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attachment_gallery_item_fk') THEN
    ALTER TABLE attachment
      ADD CONSTRAINT attachment_gallery_item_fk
      FOREIGN KEY (itinerary_item_id, trip_id)
      REFERENCES itinerary_item(id, trip_id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS attachment_gallery_item_idx
  ON attachment (owner_id, itinerary_item_id, sort_order, id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS attachment_gallery_cover_uq
  ON attachment (itinerary_item_id)
  WHERE is_cover AND deleted_at IS NULL AND itinerary_item_id IS NOT NULL;
