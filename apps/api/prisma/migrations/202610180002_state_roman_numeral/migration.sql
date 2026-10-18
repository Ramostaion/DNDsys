ALTER TABLE "TagDefinition" ADD COLUMN "romanNumeral" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CharacterTag" ADD COLUMN "romanNumeral" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TagDefinition" ADD CONSTRAINT "TagDefinition_roman_numeral_valid"
  CHECK ("romanNumeral" IN ('','I','II','III','IV','V','VI','VII','VIII','IX','X'));
ALTER TABLE "CharacterTag" ADD CONSTRAINT "CharacterTag_roman_numeral_valid"
  CHECK ("romanNumeral" IN ('','I','II','III','IV','V','VI','VII','VIII','IX','X'));
