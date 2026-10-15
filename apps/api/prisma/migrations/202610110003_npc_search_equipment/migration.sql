ALTER TABLE "Character" ADD COLUMN "allowSearch" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Room" ALTER COLUMN "equipmentSlots" SET DEFAULT '["头部","胸部","手臂","手部","腿部","鞋","饰品1","饰品2","饰品3","饰品4"]';

-- Only convert the original default layout. GM-created custom layouts stay intact.
-- Surplus worn items are unequipped, never removed from InventoryEntry.
DO $$
DECLARE
  old_slots jsonb := '["头部","脖颈","胸部","手臂","手","腿部","脚踝","脚","手指1","手指2","手指3","手指4","手指5","手指6","手指7","手指8","手指9","手指10"]';
  new_slots jsonb := '["头部","胸部","手臂","手部","腿部","鞋","饰品1","饰品2","饰品3","饰品4"]';
  r record; c record; e record; target text; occupied text[]; number integer;
BEGIN
  FOR r IN SELECT "id" FROM "Room" WHERE "equipmentSlots" = old_slots LOOP
    FOR c IN SELECT "id" FROM "Character" WHERE "roomId" = r.id LOOP
      occupied := ARRAY[]::text[];
      FOR e IN SELECT "id","slot" FROM "EquippedItem" WHERE "characterId" = c.id ORDER BY CASE WHEN "slot"='脚' THEN 0 ELSE 1 END,"slot","id" LOOP
        target := CASE e.slot WHEN '手' THEN '手部' WHEN '脚' THEN '鞋' WHEN '脚踝' THEN '鞋' ELSE e.slot END;
        IF e.slot='脖颈' OR e.slot ~ '^手指[0-9]+$' THEN
          target := NULL;
          FOR number IN 1..4 LOOP
            IF NOT ('饰品'||number)=ANY(occupied) THEN target := '饰品'||number; EXIT; END IF;
          END LOOP;
        END IF;
        IF target IS NULL OR target=ANY(occupied) OR NOT new_slots ? target THEN
          DELETE FROM "EquippedItem" WHERE "id"=e.id;
        ELSE
          UPDATE "EquippedItem" SET "slot"=target WHERE "id"=e.id;
          occupied := array_append(occupied,target);
        END IF;
      END LOOP;
    END LOOP;
    UPDATE "Room" SET "equipmentSlots"=new_slots,"version"="version"+1 WHERE "id"=r.id;
  END LOOP;
END $$;
