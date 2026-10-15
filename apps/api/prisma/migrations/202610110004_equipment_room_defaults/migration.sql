-- v3.0 created rooms with a second, five-slot default layout.
DO $$
DECLARE r record; c record; e record; target text; occupied text[];
BEGIN
  FOR r IN SELECT "id" FROM "Room" WHERE "equipmentSlots" = '["主手","副手","护甲","饰品 1","饰品 2"]'::jsonb LOOP
    FOR c IN SELECT "id" FROM "Character" WHERE "roomId"=r.id LOOP
      occupied := ARRAY[]::text[];
      FOR e IN SELECT "id","slot" FROM "EquippedItem" WHERE "characterId"=c.id ORDER BY CASE "slot" WHEN '主手' THEN 0 WHEN '副手' THEN 2 ELSE 1 END,"id" LOOP
        target := CASE e.slot WHEN '主手' THEN '手部' WHEN '副手' THEN '手部' WHEN '护甲' THEN '胸部' WHEN '饰品 1' THEN '饰品1' WHEN '饰品 2' THEN '饰品2' ELSE e.slot END;
        IF target=ANY(occupied) THEN DELETE FROM "EquippedItem" WHERE "id"=e.id;
        ELSE UPDATE "EquippedItem" SET "slot"=target WHERE "id"=e.id; occupied := array_append(occupied,target);
        END IF;
      END LOOP;
    END LOOP;
    UPDATE "Room" SET "equipmentSlots"='["头部","胸部","手臂","手部","腿部","鞋","饰品1","饰品2","饰品3","饰品4"]',"version"="version"+1 WHERE "id"=r.id;
  END LOOP;
END $$;
