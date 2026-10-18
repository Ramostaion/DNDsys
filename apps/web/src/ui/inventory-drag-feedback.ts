import { create } from 'zustand';
import { equipmentFitsSlot, isWearable, firstInventorySpace, equipmentAtSlot } from '@dnd/shared';
import type { Snapshot } from '../api';
import { canCapability, canTransferInventory } from '../permissions';

export type InventoryDrag = {
  roomId: string;
  characterId?: string;
  entryId?: string;
  itemId?: string;
  sourceSlot?: string;
};
export const useInventoryDrag = create<{ current: InventoryDrag | null; set: (current: InventoryDrag | null) => void }>(
  (set) => ({ current: null, set: (current) => set({ current }) }),
);

/** A local preview only; the existing server operation still validates every drop. */
export function inventoryDropHint(
  snap: Snapshot,
  userId: string,
  target: any,
  drag: InventoryDrag | null,
  position?: number,
  slot?: string,
): { allowed: boolean; label: string } | null {
  if (!drag) return null;
  const blocked = (label: string) => ({ allowed: false, label });
  if (drag.roomId !== snap.room.id) return blocked('不能跨房间放置');
  const source = snap.characters.find((c) => c.id === drag.characterId);
  const entry = source?.inventory.find((e: any) => e.id === drag.entryId);
  if (drag.entryId && (!source || !entry || !canTransferInventory(snap, userId, source, target)))
    return blocked('不能转移到此角色');
  if (
    drag.itemId &&
    (!canCapability(snap, userId, 'inventoryAdd') || !snap.members.some((m) => m.userId === userId && m.role === 'GM'))
  )
    return blocked('仅 GM 可发放物品');
  const item = entry?.item || snap.items.find((i) => i.id === drag.itemId);
  if (!item) return blocked('物品已变化');
  if (slot) {
    if (!entry) return blocked('先放入背包');
    if (!isWearable(item.kind) || !equipmentFitsSlot(item.compatibleSlots, slot, item.kind))
      return blocked('部位不兼容');
    if (source?.id === target.id && drag.sourceSlot === slot) return blocked('已在此部位');
    return {
      allowed: true,
      label: equipmentAtSlot(target.equipment, target.inventory, slot) ? '替换此部位装备' : '穿戴到此部位',
    };
  }
  const occupied = target.inventory.find((e: any) => e.position === position);
  if (
    source?.id === target.id &&
    drag.sourceSlot &&
    entry.position >= 0 &&
    entry.quantity > target.equipment.filter((e: any) => e.entryId === entry.id).length &&
    (position === undefined || occupied?.id === entry.id)
  )
    return { allowed: true, label: '卸下并合并到原物品格' };
  if (source?.id === target.id && !drag.sourceSlot) {
    if (occupied?.id === entry.id) return blocked('当前位置');
    return { allowed: true, label: occupied ? '交换两个格子' : '移动到此格' };
  }
  if (occupied && entry) return blocked('请选择空格');
  if (firstInventorySpace(target.inventorySlots, target.inventory) === undefined) return blocked('背包已满');
  return { allowed: true, label: occupied ? '放入背包空格' : drag.sourceSlot ? '卸下并放入此格' : '放入此格' };
}
