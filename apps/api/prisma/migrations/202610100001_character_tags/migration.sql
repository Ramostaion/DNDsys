CREATE UNIQUE INDEX "Character_id_roomId_key" ON "Character"("id", "roomId");

CREATE TABLE "TagDefinition" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "icon" TEXT NOT NULL DEFAULT 'clue',
  "color" TEXT NOT NULL DEFAULT '#c69452',
  "templateDescription" TEXT NOT NULL DEFAULT '',
  "defaultVisibility" TEXT NOT NULL DEFAULT 'GM_ONLY',
  "defaultPriority" INTEGER NOT NULL DEFAULT 0,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TagDefinition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TagDefinition_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TagDefinition_id_roomId_key" ON "TagDefinition"("id", "roomId");
CREATE INDEX "TagDefinition_roomId_isArchived_idx" ON "TagDefinition"("roomId", "isArchived");

CREATE TABLE "CharacterTag" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "tagDefinitionId" TEXT NOT NULL,
  "detailsMarkdown" TEXT NOT NULL DEFAULT '',
  "visibility" TEXT NOT NULL DEFAULT 'GM_ONLY',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CharacterTag_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CharacterTag_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CharacterTag_characterId_roomId_fkey" FOREIGN KEY ("characterId", "roomId") REFERENCES "Character"("id", "roomId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CharacterTag_tagDefinitionId_roomId_fkey" FOREIGN KEY ("tagDefinitionId", "roomId") REFERENCES "TagDefinition"("id", "roomId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CharacterTag_characterId_tagDefinitionId_key" ON "CharacterTag"("characterId", "tagDefinitionId");
CREATE INDEX "CharacterTag_roomId_characterId_idx" ON "CharacterTag"("roomId", "characterId");
CREATE INDEX "CharacterTag_tagDefinitionId_idx" ON "CharacterTag"("tagDefinitionId");
