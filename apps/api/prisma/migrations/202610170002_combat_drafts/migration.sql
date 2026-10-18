CREATE TABLE "CombatDraft" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "eventId" TEXT NOT NULL,
    "actorId" TEXT,
    "targetId" TEXT,
    "privateRecord" BOOLEAN NOT NULL DEFAULT false,
    "fingerprint" TEXT NOT NULL DEFAULT '',
    "adjudication" JSONB NOT NULL DEFAULT '{}',
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "recordId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CombatDraft_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CombatDraft_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CombatDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CombatDraft_roomId_state_expiresAt_idx" ON "CombatDraft"("roomId", "state", "expiresAt");
