ALTER TABLE "Room" ADD COLUMN "publicDiceAvailableAt" TIMESTAMP(3);
ALTER TABLE "DiceRoll" ADD COLUMN "rollerName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "rollerRole" TEXT NOT NULL DEFAULT 'PLAYER';

-- Earlier records never stored the name/role snapshot: retain them with the best available identity.
UPDATE "DiceRoll" AS d SET "rollerName" = u."username",
  "rollerRole" = COALESCE(
    (SELECT m."role" FROM "RoomMember" m WHERE m."roomId" = d."roomId" AND m."userId" = d."userId"),
    CASE WHEN r."ownerId" = d."userId" THEN 'GM' ELSE 'PLAYER' END)
FROM "User" u, "Room" r WHERE u."id" = d."userId" AND r."id" = d."roomId";
