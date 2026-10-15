-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "attackProfiles" JSONB NOT NULL DEFAULT '[]';


-- CreateTable
CREATE TABLE "DiceRoll" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT,
    "expression" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "total" INTEGER NOT NULL,
    "details" JSONB NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiceRoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CombatEncounter" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "round" INTEGER NOT NULL DEFAULT 1,
    "turnIndex" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "CombatEncounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Combatant" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "initiative" INTEGER NOT NULL,

    CONSTRAINT "Combatant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CombatEvent" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "encounterId" TEXT,
    "userId" TEXT NOT NULL,
    "actorId" TEXT,
    "targetId" TEXT,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CombatEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiceRoll_roomId_createdAt_idx" ON "DiceRoll"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "CombatEncounter_roomId_status_idx" ON "CombatEncounter"("roomId", "status");

-- CreateIndex
CREATE INDEX "Combatant_encounterId_initiative_idx" ON "Combatant"("encounterId", "initiative");

-- CreateIndex
CREATE UNIQUE INDEX "Combatant_encounterId_characterId_key" ON "Combatant"("encounterId", "characterId");

-- CreateIndex
CREATE INDEX "CombatEvent_roomId_createdAt_idx" ON "CombatEvent"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "CombatEvent_encounterId_createdAt_idx" ON "CombatEvent"("encounterId", "createdAt");

-- AddForeignKey
ALTER TABLE "DiceRoll" ADD CONSTRAINT "DiceRoll_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiceRoll" ADD CONSTRAINT "DiceRoll_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiceRoll" ADD CONSTRAINT "DiceRoll_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatEncounter" ADD CONSTRAINT "CombatEncounter_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combatant" ADD CONSTRAINT "Combatant_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "CombatEncounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combatant" ADD CONSTRAINT "Combatant_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatEvent" ADD CONSTRAINT "CombatEvent_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatEvent" ADD CONSTRAINT "CombatEvent_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "CombatEncounter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatEvent" ADD CONSTRAINT "CombatEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatEvent" ADD CONSTRAINT "CombatEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatEvent" ADD CONSTRAINT "CombatEvent_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A room can run only one active encounter.
CREATE UNIQUE INDEX "CombatEncounter_one_active_per_room" ON "CombatEncounter" ("roomId") WHERE "status" = 'ACTIVE';
