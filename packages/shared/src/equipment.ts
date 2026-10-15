export const DEFAULT_EQUIPMENT_SLOTS = [
  '主手',
  '副手',
  '头部',
  '胸部',
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
  return kind === '装备' || kind === '饰品';
}
export function equipmentFitsSlot(compatibleSlots: unknown, slot: string) {
  const allowed = Array.isArray(compatibleSlots) ? compatibleSlots : [];
  if (!allowed.length || allowed.includes(slot)) return true;
  if (slot === '手部' && allowed.includes('手')) return true;
  if (slot === '手部' && allowed.some((name) => name === '主手' || name === '副手')) return true;
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
