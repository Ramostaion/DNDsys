import { resourceField } from './character-resources.js';

type MemberAccess = { role: string; permissions?: unknown };
type CharacterAccess = {
  id?: string;
  ownerId: string | null;
  visibility?: string;
  isNpc?: boolean;
  allowSearch?: boolean;
  healthCurrent?: number | null;
};

export function characterIsIncapacitated(character: CharacterAccess): boolean {
  return (
    typeof character.healthCurrent === 'number' &&
    Number.isFinite(character.healthCurrent) &&
    character.healthCurrent <= 0
  );
}

export function canLootCharacterInventory(
  member: MemberAccess | undefined,
  character: CharacterAccess,
  userId: string,
): boolean {
  return Boolean(
    member &&
      !character.isNpc &&
      character.ownerId &&
      character.visibility !== 'GM' &&
      characterIsIncapacitated(character) &&
      (member.role === 'GM' || character.ownerId !== userId),
  );
}

export function canExchangeWithFallenCharacter(
  member: MemberAccess | undefined,
  source: CharacterAccess,
  target: CharacterAccess,
  userId: string,
): boolean {
  if (!member) return false;
  if (member.role === 'GM') return true;
  const ownActive = (c: CharacterAccess) =>
    c.ownerId === userId && !c.isNpc && c.visibility !== 'GM' && !characterIsIncapacitated(c);
  const sourceFallen = canLootCharacterInventory(member, source, userId),
    targetFallen = canLootCharacterInventory(member, target, userId);
  if (source.id && source.id === target.id) return sourceFallen;
  return (sourceFallen && ownActive(target)) || (ownActive(source) && targetFallen);
}

export function canControlCharacter(
  member: MemberAccess | undefined,
  character: CharacterAccess,
  userId: string,
): boolean {
  if (!member) return false;
  if (member.role === 'GM') return true;
  if (character.visibility === 'GM' || character.isNpc) return false;
  const permissions = member.permissions as Record<string, unknown> | undefined;
  return character.ownerId === userId || permissions?.editAllCharacters === true;
}

export function canViewCharacterInventory(
  member: MemberAccess | undefined,
  character: CharacterAccess,
  userId: string,
  allowOthers = false,
): boolean {
  if (!member) return false;
  if (member.role === 'GM') return true;
  if (character.visibility === 'GM') return false;
  if (character.isNpc)
    return (
      character.allowSearch !== false &&
      typeof character.healthCurrent === 'number' &&
      Number.isFinite(character.healthCurrent) &&
      character.healthCurrent <= 0
    );
  if (characterIsIncapacitated(character) && character.ownerId) return character.ownerId !== userId;
  return character.ownerId === userId || allowOthers;
}

// Use the configured health resource, never the unused legacy HP column in a custom sheet.
export function characterCurrentHealth(
  room: { sheetMode?: boolean; sheetSchema?: unknown },
  character: { currentHp?: number; derived?: unknown },
): number | null {
  const values = (character.derived as { values?: Record<string, unknown> } | undefined)?.values || {};
  const fields = Array.isArray(room.sheetSchema) ? room.sheetSchema : [];
  const visibleResources = fields.filter(
    (field) =>
      field.isResource &&
      field.resourceKind !== 'shield' &&
      field.maxFieldId &&
      typeof values[field.fieldId] === 'number' &&
      typeof values[field.maxFieldId] === 'number',
  );
  const health = resourceField(visibleResources, 'health');
  const current = room.sheetMode ? (health ? values[health.fieldId] : null) : character.currentHp;
  return typeof current === 'number' && Number.isFinite(current) ? current : null;
}
