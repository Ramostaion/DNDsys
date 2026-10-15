ALTER TABLE "Room" ADD COLUMN "equipmentSlots" JSONB NOT NULL DEFAULT '["头部","脖颈","胸部","手臂","手","腿部","脚踝","脚","手指1","手指2","手指3","手指4","手指5","手指6","手指7","手指8","手指9","手指10"]'::jsonb;
