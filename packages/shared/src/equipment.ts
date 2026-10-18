export const DEFAULT_EQUIPMENT_SLOTS = [
  '主手',
  '副手',
  '头部',
  '胸部',
  '背包',
  '手臂',
  '手部',
  '腿部',
  '鞋',
  '饰品1',
  '饰品2',
  '饰品3',
  '饰品4',
];
export function isWearable(kind: string) {
  return kind === '装备' || kind === '饰品' || kind === '双手武器' || kind === '背包';
}
export function withBackpackSlot(slots: string[]) {
  return slots.includes('胸部') && !slots.includes('背包')
    ? slots.flatMap((slot) => (slot === '胸部' ? [slot, '背包'] : [slot]))
    : slots;
}
export function normalizeEquipmentSlots(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return [
    ...new Set(
      values.flatMap((v) =>
        typeof v === 'string'
          ? v
              .split(/[,，、;；\n]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      ),
    ),
  ];
}
export function isHandSlot(slot: string) {
  return slot === '主手' || slot === '副手';
}
export function equipmentFitsSlot(compatibleSlots: unknown, slot: string, kind?: string) {
  if (kind === '背包') return slot === '背包';
  if (slot === '背包') return false;
  if (kind === '双手武器') return isHandSlot(slot);
  const allowed = normalizeEquipmentSlots(compatibleSlots);
  if (!allowed.length || allowed.includes(slot)) return true;
  if (slot === '手部' && allowed.includes('手')) return true;
  if (slot === '胸部' && allowed.includes('护甲')) return true;
  if (slot === '鞋' && allowed.some((name) => name === '脚' || name === '脚踝')) return true;
  if (
    /^饰品[1-4]$/.test(slot) &&
    allowed.some((name) => name === '饰品' || name === '脖颈' || /^手指(?:\d+)?$/.test(name))
  )
    return true;
  if (/^饰品[1-4]$/.test(slot) && allowed.includes(slot.replace('饰品', '饰品 '))) return true;
  return slot.startsWith('手指') && allowed.includes('手指');
}

/** A two-handed weapon is one physical equipped instance reserving both hand slots. */
export function equipmentAtSlot<T extends { id: string; slot: string; entryId: string }>(
  equipment: T[],
  inventory: { id: string; item: { kind: string } }[],
  slot: string,
): T | undefined {
  return (
    equipment.find((e) => e.slot === slot) ||
    (isHandSlot(slot)
      ? equipment.find(
          (e) =>
            isHandSlot(e.slot) && inventory.some((entry) => entry.id === e.entryId && entry.item.kind === '双手武器'),
        )
      : undefined)
  );
}
export function equipmentConflicts<T extends { id: string; slot: string; entryId: string }>(
  equipment: T[],
  inventory: { id: string; item: { kind: string } }[],
  slot: string,
  incomingKind?: string,
): T[] {
  if (incomingKind === '双手武器' && isHandSlot(slot)) return equipment.filter((e) => isHandSlot(e.slot));
  const worn = equipmentAtSlot(equipment, inventory, slot);
  return worn ? [worn] : [];
}
