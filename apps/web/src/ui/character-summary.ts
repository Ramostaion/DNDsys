import type { Snapshot } from '../api';
import { resourceField, resourceSummary } from '@dnd/shared';

export function characterHealth(snap: Snapshot, character: any) {
  const values = character.derived?.values || {};
  if (!snap.room.sheetMode) {
    const current = character.currentHp,
      maximum = values.血量上限;
    return resourceSummary(current, maximum);
  }
  const fields = (snap.room.sheetSchema || []).filter(
    (field: any) =>
      field.isResource &&
      field.resourceKind !== 'shield' &&
      field.maxFieldId &&
      typeof values[field.fieldId] === 'number' &&
      typeof values[field.maxFieldId] === 'number',
  );
  const field = resourceField(fields, 'health');
  if (!field) return null;
  const current = values[field.fieldId],
    maximum = values[field.maxFieldId!];
  return resourceSummary(current, maximum);
}

export function characterShield(snap: Snapshot, character: any) {
  const values = character.derived?.values || {};
  const field = resourceField(snap.room.sheetSchema || [], 'shield');
  return field ? resourceSummary(values[field.fieldId], values[field.maxFieldId!]) : null;
}
