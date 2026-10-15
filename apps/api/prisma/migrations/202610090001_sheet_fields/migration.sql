-- Add configurable room field definitions and per-character raw values without changing legacy columns.
ALTER TABLE "Room" ADD COLUMN "sheetSchema" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Character" ADD COLUMN "fieldValues" JSONB NOT NULL DEFAULT '{}';
