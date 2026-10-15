ALTER TABLE "Combatant" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Preserve the visible order and current turn of existing encounters.
WITH positions AS (
  SELECT "id", (ROW_NUMBER() OVER (
    PARTITION BY "encounterId" ORDER BY "initiative" DESC, "id" ASC
  ) - 1)::INTEGER AS position FROM "Combatant"
)
UPDATE "Combatant" SET "sortOrder" = positions.position
FROM positions WHERE "Combatant"."id" = positions."id";
