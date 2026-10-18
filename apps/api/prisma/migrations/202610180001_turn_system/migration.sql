ALTER TABLE "Room" ADD COLUMN "initiativePresetId" TEXT;
ALTER TABLE "Character" ADD COLUMN "initiativeConfig" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "TagDefinition" ADD COLUMN "defaultDurationTurns" INTEGER;
ALTER TABLE "CharacterTag" ADD COLUMN "remainingTurns" INTEGER;
ALTER TABLE "TagDefinition" ADD CONSTRAINT "TagDefinition_duration_positive" CHECK ("defaultDurationTurns" IS NULL OR "defaultDurationTurns" > 0);
ALTER TABLE "CharacterTag" ADD CONSTRAINT "CharacterTag_duration_positive" CHECK ("remainingTurns" IS NULL OR "remainingTurns" > 0);
CREATE TABLE "InitiativePreset" (
  "id" TEXT PRIMARY KEY, "roomId" TEXT NOT NULL REFERENCES "Room"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL, "weights" JSONB NOT NULL, "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "InitiativePreset_roomId_idx" ON "InitiativePreset"("roomId");
CREATE TABLE "TurnSession" (
  "id" TEXT PRIMARY KEY, "roomId" TEXT NOT NULL REFERENCES "Room"("id") ON DELETE CASCADE,
  "mapId" TEXT REFERENCES "Map"("id") ON DELETE SET NULL, "mapName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE', "round" INTEGER NOT NULL DEFAULT 1, "totalRounds" INTEGER,
  "currentCharacterId" TEXT, "participants" JSONB NOT NULL, "lastTransition" JSONB NOT NULL DEFAULT '{}',
  "lastAdvancedAt" TIMESTAMP(3), "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "TurnSession_roomId_status_idx" ON "TurnSession"("roomId","status");
CREATE UNIQUE INDEX "TurnSession_one_live_room" ON "TurnSession"("roomId") WHERE "status" <> 'ENDED';
ALTER TABLE "TurnSession" ADD CONSTRAINT "TurnSession_round_positive" CHECK ("round" > 0 AND ("totalRounds" IS NULL OR "totalRounds" > 0));
