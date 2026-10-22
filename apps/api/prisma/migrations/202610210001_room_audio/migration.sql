ALTER TABLE "PresentationSession" ADD COLUMN "audioRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PresentationSession" ADD COLUMN "audio" JSONB NOT NULL DEFAULT '{}';
CREATE TABLE "RoomAudioTrack" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "storageName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "bytes" INTEGER NOT NULL,
  "duration" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoomAudioTrack_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RoomAudioTrack_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RoomAudioTrack_roomId_createdAt_idx" ON "RoomAudioTrack"("roomId", "createdAt");
