CREATE TABLE "PresentationGroup" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PresentationGroup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PresentationGroup_roomId_sortOrder_idx" ON "PresentationGroup"("roomId","sortOrder");
ALTER TABLE "PresentationGroup" ADD CONSTRAINT "PresentationGroup_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PresentationAsset" ADD CONSTRAINT "PresentationAsset_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PresentationGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PresentationCue" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "groupId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "transition" TEXT NOT NULL DEFAULT 'none',
  "captionOverride" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PresentationCue_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PresentationCue_roomId_sortOrder_idx" ON "PresentationCue"("roomId","sortOrder");
ALTER TABLE "PresentationCue" ADD CONSTRAINT "PresentationCue_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PresentationCue" ADD CONSTRAINT "PresentationCue_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "PresentationAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PresentationCue" ADD CONSTRAINT "PresentationCue_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PresentationGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PresentationSession" ADD COLUMN "activeCueId" TEXT;
ALTER TABLE "PresentationSession" ADD COLUMN "transition" TEXT NOT NULL DEFAULT 'none';
