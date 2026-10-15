import type { SheetField } from './sheet.js';

export function resourceField(fields: SheetField[], kind: 'health' | 'shield') {
  const resources = fields.filter((field) => field.isResource && field.maxFieldId);
  return (
    resources.find((field) => field.resourceKind === kind) ||
    (kind === 'health' ? resources.find((field) => field.resourceKind !== 'shield') : undefined)
  );
}

// Built-in shield fields use existing fieldValues storage and calculation, including old rooms.
// Add fields to a copy; never overwrite an existing custom field or mutate the saved schema.
export function withShieldFields(fields: SheetField[]): SheetField[] {
  if (resourceField(fields, 'shield')) return fields;
  const next = [...fields];
  const unique = (base: string) => {
    let id = base,
      suffix = 2;
    while (next.some((field) => field.fieldId === id)) id = `${base}_${suffix++}`;
    return id;
  };
  const maxFieldId = unique('dnd_shield_max');
  next.push({
    fieldId: maxFieldId,
    name: '护盾上限',
    type: 'number',
    defaultValue: 0,
    min: 0,
    group: '护盾',
    sort: -30,
    visibility: 'ALL',
    editableBy: 'GM',
  });
  next.push({
    fieldId: unique('dnd_shield'),
    name: '当前护盾',
    type: 'number',
    defaultValue: 0,
    min: 0,
    group: '护盾',
    sort: -29,
    visibility: 'ALL',
    editableBy: 'GM',
    isResource: true,
    resourceKind: 'shield',
    maxFieldId,
  });
  return next;
}

export function resourceSummary(current: unknown, maximum: unknown) {
  return typeof current === 'number' &&
    typeof maximum === 'number' &&
    Number.isFinite(current) &&
    Number.isFinite(maximum)
    ? { current, maximum, percent: maximum > 0 ? Math.max(0, Math.min(100, (current / maximum) * 100)) : 0 }
    : null;
}
