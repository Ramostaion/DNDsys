CREATE TABLE "NpcDirectoryState" (
  "roomId" TEXT PRIMARY KEY REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "version" INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE "NpcFolder" (
  "id" TEXT PRIMARY KEY,
  "roomId" TEXT NOT NULL REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "parentId" TEXT REFERENCES "NpcFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" TEXT NOT NULL CHECK (length(btrim("name")) BETWEEN 1 AND 100 AND "name" = btrim("name")),
  "position" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "NpcFolder_roomId_parentId_name_key" ON "NpcFolder"("roomId", "parentId", "name");
CREATE UNIQUE INDEX "NpcFolder_root_name_key" ON "NpcFolder"("roomId", "name") WHERE "parentId" IS NULL;
CREATE INDEX "NpcFolder_roomId_parentId_position_idx" ON "NpcFolder"("roomId", "parentId", "position");
CREATE TABLE "NpcClassification" (
  "characterId" TEXT PRIMARY KEY REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "roomId" TEXT NOT NULL REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "folderId" TEXT NOT NULL REFERENCES "NpcFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "NpcClassification_roomId_folderId_idx" ON "NpcClassification"("roomId", "folderId");
