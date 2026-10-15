ALTER TABLE "Room" ALTER COLUMN "equipmentSlots" SET DEFAULT '["主手","副手","头部","胸部","手臂","手部","腿部","鞋","饰品1","饰品2","饰品3","饰品4"]'::jsonb;

-- Extend the previous default only. Existing equipment and custom layouts stay intact.
UPDATE "Room"
SET "equipmentSlots" = '["主手","副手"]'::jsonb || "equipmentSlots", "version" = "version" + 1
WHERE "equipmentSlots" = '["头部","胸部","手臂","手部","腿部","鞋","饰品1","饰品2","饰品3","饰品4"]'::jsonb;
