ALTER TABLE "TagDefinition" ADD COLUMN "customFields" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "CharacterTag" ADD COLUMN "customFields" JSONB NOT NULL DEFAULT '[]';
-- Only future states default to public; existing private states keep their visibility.
ALTER TABLE "TagDefinition" ALTER COLUMN "defaultVisibility" SET DEFAULT 'PUBLIC';
ALTER TABLE "CharacterTag" ALTER COLUMN "visibility" SET DEFAULT 'PUBLIC';
ALTER TABLE "Room" ALTER COLUMN "equipmentSlots" SET DEFAULT '["主手","副手","头部","胸部","背包","手臂","手部","腿部","鞋","饰品1","饰品2","饰品3","饰品4"]';
UPDATE "Room" SET "equipmentSlots" = "equipmentSlots" || '["背包"]'::jsonb,
  "version" = "version" + 1
WHERE "equipmentSlots" @> '["胸部"]'::jsonb AND NOT "equipmentSlots" @> '["背包"]'::jsonb;
