ALTER TABLE "DrawingOperation" ADD COLUMN "historyId" TEXT;

CREATE TABLE "DrawingHistory" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "mapId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'APPLIED',
  "changes" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DrawingHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DrawingHistory_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DrawingHistory_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DrawingHistory_roomId_userId_mapId_state_createdAt_idx"
  ON "DrawingHistory"("roomId", "userId", "mapId", "state", "createdAt");
