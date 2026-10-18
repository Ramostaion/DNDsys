import type { SheetField } from './sheet.js';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Capacity is derived from authoritative effective values, never from the strength bonus. */
export function inventoryCapacity(
  room: { sheetMode?: boolean; sheetSchema?: unknown },
  character: { inventorySlots?: number; attributes?: unknown; fieldValues?: unknown; derived?: unknown },
) {
  const derived = record(character.derived),
    values = record(derived.values),
    errors = record(derived.errors);
  let strength: unknown;
  if (room.sheetMode) {
    const fields = (Array.isArray(room.sheetSchema) ? room.sheetSchema : []) as SheetField[];
    const numeric = fields.filter((field) => field.type === 'number');
    const named = numeric.filter((field) => field.name.trim() === '力量');
    const aliases = numeric.filter((field) => ['力量', 'str', 'strength'].includes(field.fieldId.toLowerCase()));
    const field =
      numeric.find((field) => field.fieldId === '力量') ||
      (named.length === 1 ? named[0] : aliases.length === 1 ? aliases[0] : undefined);
    if (field && !errors[field.fieldId])
      strength = values[field.fieldId] ?? record(character.fieldValues)[field.fieldId] ?? field.defaultValue;
  } else {
    const attributes = record(character.attributes);
    if (finite(attributes.力量) && !errors.力量) strength = values.力量 ?? attributes.力量;
  }
  const capacity = finite(strength) ? 24 + (strength - 15) * 2 : (character.inventorySlots ?? 24);
  const base = Number.isFinite(capacity) ? Math.max(0, Math.floor(capacity)) : 24;
  const extra = finite(derived.inventoryBonus) ? Math.max(0, Math.floor(derived.inventoryBonus)) : 0;
  return Math.min(2147483647, base + extra);
}

/** Work is bounded by occupied entries, including overflow, rather than total available cells. */
export function firstInventorySpace(capacity: number, entries: readonly { position: number }[]) {
  const occupied = new Set(entries.filter((entry) => entry.position >= 0).map((entry) => entry.position));
  if (occupied.size >= capacity) return undefined;
  let position = 0;
  while (occupied.has(position)) position++;
  return position < capacity ? position : undefined;
}
