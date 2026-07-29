\ir ../schema/reference-data.sql

-- Values are upserted by src/seeds/reference-data.mjs from the versioned
-- @on-the-road/config source. Keeping values out of this migration prevents
-- config, API, importer, and PDF copies from drifting.
