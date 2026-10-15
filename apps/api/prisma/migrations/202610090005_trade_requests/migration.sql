CREATE TABLE "TradeRequest" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "sourceOwnerId" TEXT,
  "recipientId" TEXT NOT NULL,
  "sourceCharacterId" TEXT NOT NULL,
  "targetCharacterId" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradeRequest_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "TradeRequest" ADD CONSTRAINT "TradeRequest_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "TradeRequest_roomId_status_idx" ON "TradeRequest"("roomId", "status");
CREATE INDEX "TradeRequest_recipientId_status_idx" ON "TradeRequest"("recipientId", "status");
