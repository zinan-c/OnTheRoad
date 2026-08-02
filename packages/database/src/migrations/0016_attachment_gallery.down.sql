DROP INDEX IF EXISTS attachment_gallery_cover_uq;
DROP INDEX IF EXISTS attachment_gallery_item_idx;
ALTER TABLE attachment
  DROP CONSTRAINT IF EXISTS attachment_gallery_item_fk,
  DROP CONSTRAINT IF EXISTS attachment_gallery_trip_fk,
  DROP CONSTRAINT IF EXISTS attachment_gallery_caption_check,
  DROP CONSTRAINT IF EXISTS attachment_gallery_sort_order_check,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS is_cover,
  DROP COLUMN IF EXISTS caption,
  DROP COLUMN IF EXISTS sort_order,
  DROP COLUMN IF EXISTS itinerary_item_id,
  DROP COLUMN IF EXISTS trip_id;
