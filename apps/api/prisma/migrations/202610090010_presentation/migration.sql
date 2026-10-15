CREATE TABLE "PresentationAsset" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "storageName" TEXT NOT NULL,
  "screenName" TEXT NOT NULL,
  "thumbName" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "caption" TEXT NOT NULL DEFAULT '',
  "gmNotes" TEXT NOT NULL DEFAULT '',
  "tags" JSONB NOT NULL DEFAULT '[]',
  "groupId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "canReplay" BOOLEAN NOT NULL DEFAULT false,
  "revealedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PresentationAsset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PresentationAsset_roomId_sortOrder_idx" ON "PresentationAsset"("roomId","sortOrder");
ALTER TABLE "PresentationAsset" ADD CONSTRAINT "PresentationAsset_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PresentationSession" (
  "roomId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'idle',
  "activeAssetId" TEXT,
  "requestedMode" TEXT NOT NULL DEFAULT 'floating',
  "allowHistory" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PresentationSession_pkey" PRIMARY KEY ("roomId")
);
ALTER TABLE "PresentationSession" ADD CONSTRAINT "PresentationSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
