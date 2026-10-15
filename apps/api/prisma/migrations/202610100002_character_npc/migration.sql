ALTER TABLE "Character" ADD COLUMN "isNpc" BOOLEAN NOT NULL DEFAULT false;

-- Existing unassigned hidden characters were presented as hidden NPCs in the old UI.
UPDATE "Character" SET "isNpc" = true WHERE "visibility" = 'GM' AND "ownerId" IS NULL;
