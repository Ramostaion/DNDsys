-- CreateTable
CREATE TABLE "PrivateClue" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "sharedByUserId" TEXT,
    "sharedByName" TEXT,
    "rootClueId" TEXT,
    "title" TEXT NOT NULL,
    "bodyMarkdown" TEXT NOT NULL DEFAULT '',
    "gmNote" TEXT NOT NULL DEFAULT '',
    "characterLabel" TEXT NOT NULL DEFAULT '',
    "allowForward" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateClue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClueDelivery" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "clueId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "savedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClueDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClueAttachment" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storageName" TEXT NOT NULL,
    "thumbName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClueAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClueAttachmentLink" (
    "clueId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ClueAttachmentLink_pkey" PRIMARY KEY ("clueId","attachmentId")
);

-- CreateIndex
CREATE INDEX "PrivateClue_roomId_senderUserId_createdAt_idx" ON "PrivateClue"("roomId", "senderUserId", "createdAt");

-- CreateIndex
CREATE INDEX "PrivateClue_rootClueId_idx" ON "PrivateClue"("rootClueId");

-- CreateIndex
CREATE INDEX "ClueDelivery_roomId_recipientUserId_createdAt_idx" ON "ClueDelivery"("roomId", "recipientUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClueDelivery_clueId_recipientUserId_key" ON "ClueDelivery"("clueId", "recipientUserId");

-- CreateIndex
CREATE INDEX "ClueAttachment_roomId_uploadedByUserId_idx" ON "ClueAttachment"("roomId", "uploadedByUserId");

-- CreateIndex
CREATE INDEX "ClueAttachmentLink_attachmentId_idx" ON "ClueAttachmentLink"("attachmentId");

-- AddForeignKey
ALTER TABLE "PrivateClue" ADD CONSTRAINT "PrivateClue_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClueDelivery" ADD CONSTRAINT "ClueDelivery_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClueDelivery" ADD CONSTRAINT "ClueDelivery_clueId_fkey" FOREIGN KEY ("clueId") REFERENCES "PrivateClue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClueAttachment" ADD CONSTRAINT "ClueAttachment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClueAttachmentLink" ADD CONSTRAINT "ClueAttachmentLink_clueId_fkey" FOREIGN KEY ("clueId") REFERENCES "PrivateClue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClueAttachmentLink" ADD CONSTRAINT "ClueAttachmentLink_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "ClueAttachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
