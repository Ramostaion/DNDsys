import { z } from 'zod';
import {
  canLootCharacterInventory,
  canExchangeWithFallenCharacter,
  characterIsIncapacitated,
  characterCurrentHealth,
  isWearable,
  withBackpackSlot,
  equipmentFitsSlot,
  inventoryCapacity,
  firstInventorySpace,
  equipmentAtSlot,
  equipmentConflicts,
} from '@dnd/shared';
import { array, object } from '../data.js';
import { refreshCharacter } from '../character-values.js';
import { memberCan } from '../permissions.js';
import { fail as bad } from '../http.js';
import { equippedPosition } from '../inventory-layout.js';
import { json, str, num, required, characterIn, version, modifierData } from './helpers.js';
import type { OperationContext } from './context.js';

export async function inventoryOperation(context: OperationContext) {
  const { tx, room, member, rules, roomId, userId, type, p, inventoryCharacters, inventoryEditable } = context;
  let data: any;
  switch (context.type) {
    case 'inventory.add': {
      const c = await characterIn(tx, roomId, required(p.characterId, '角色 ID'));
      inventoryEditable(c);
      if (!memberCan(room, member!, 'inventoryAdd')) bad(403, 'GM 尚未授权从物品库加入背包');
      const item = await tx.itemDefinition.findFirst({ where: { id: str(p.itemId), roomId } });
      if (!item) bad(404, '物品不存在');
      const occupied = new Set(c.inventory.filter((e) => e.position >= 0).map((e) => e.position));
      const capacity = inventoryCapacity(room, c);
      const position = p.position !== undefined ? num(p.position) : firstInventorySpace(capacity, c.inventory);
      if (
        position === undefined ||
        !Number.isInteger(position) ||
        position < 0 ||
        position >= capacity ||
        occupied.size >= capacity ||
        occupied.has(position)
      )
        bad(409, '背包没有可用栏位');
      data = await tx.inventoryEntry.create({
        data: {
          characterId: c.id,
          itemId: item!.id,
          position: position!,
          quantity: Math.max(1, Math.floor(num(p.quantity) || 1)),
        },
      });
      break;
    }
    case 'inventory.move': {
      const entry = await tx.inventoryEntry.findFirst({
        where: { id: str(p.id), character: { roomId } },
        include: { character: true },
      });
      if (!entry) bad(404, '背包物品不存在');
      if (
        !canLootCharacterInventory(
          member!,
          { ...entry!.character, healthCurrent: characterCurrentHealth(room, entry!.character) },
          userId,
        )
      )
        inventoryEditable(entry!.character);
      await tx.$executeRaw`SELECT id FROM "Character" WHERE id = ${entry!.characterId} FOR UPDATE`;
      const source = await tx.inventoryEntry.findUniqueOrThrow({ where: { id: entry!.id } });
      if (p.version === undefined) bad(400, '缺少物品版本号');
      version(source.version, p.version);
      if (source.position < 0) bad(409, '已穿戴物品请从装备栏拖回背包');
      const position = Number(p.position);
      if (!Number.isInteger(position) || position < 0 || position >= inventoryCapacity(room, entry!.character))
        bad(400, '背包格子无效');
      if (position === source.position) {
        data = source;
        break;
      }
      const target = await tx.inventoryEntry.findUnique({
        where: { characterId_position: { characterId: source.characterId, position } },
      });
      if ((target?.id || null) !== (p.targetEntryId || null)) bad(409, '目标格子已变化，请重试');
      if (target) {
        if (p.targetVersion === undefined) bad(400, '缺少目标物品版本号');
        version(target.version, p.targetVersion);
      }
      if (target) {
        await tx.inventoryEntry.update({ where: { id: source.id }, data: { position: -1 } });
        await tx.inventoryEntry.update({
          where: { id: target.id },
          data: { position: source.position, version: { increment: 1 } },
        });
      }
      data = await tx.inventoryEntry.update({
        where: { id: source.id },
        data: { position, version: { increment: 1 } },
      });
      break;
    }
    case 'inventory.delete': {
      const entry = await tx.inventoryEntry.findFirst({
        where: { id: required(p.id, '物品 ID'), character: { roomId } },
        include: { character: true, equipped: true },
      });
      if (!entry) return bad(404, '背包物品不存在');
      inventoryEditable(entry.character);
      if (!Number.isInteger(p.version)) bad(400, '缺少物品版本号');
      version(entry.version, p.version);
      const worn = entry.equipped.length,
        available = entry.quantity - worn;
      if (!Number.isSafeInteger(p.quantity) || p.quantity < 1) bad(400, '删除数量无效');
      if (available < 1 || p.quantity !== available) bad(409, '背包数量或穿戴状态已变化，请重新选择物品');
      const claimed = worn
        ? await tx.inventoryEntry.updateMany({
            where: { id: entry.id, version: entry.version },
            data: { quantity: worn, version: { increment: 1 } },
          })
        : await tx.inventoryEntry.deleteMany({ where: { id: entry.id, version: entry.version } });
      if (!claimed.count) bad(409, '物品已变化，请刷新后重试');
      await tx.tradeRequest.updateMany({
        where: { entryId: entry.id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      inventoryCharacters.add(entry.characterId);
      data = !worn
        ? { id: entry.id, deleted: true }
        : await tx.inventoryEntry.findUniqueOrThrow({ where: { id: entry.id } });
      break;
    }
    case 'inventory.update': {
      if (member.role !== 'GM') bad(403, '物品信息和数量仅 GM 可修改；移除背包物品请使用删除操作');
      const entry: any = await tx.inventoryEntry.findFirst({
        where: { id: str(p.id), character: { roomId } },
        include: { character: true, equipped: true },
      });
      if (!entry) bad(404, '背包物品不存在');
      inventoryEditable(entry.character);
      version(entry.version, p.version);
      inventoryCharacters.add(entry.characterId);
      const quantity = Math.floor(num(p.quantity));
      if (quantity < entry!.equipped.length) bad(409, '数量不能少于已装备数量');
      if (quantity > entry!.quantity && !memberCan(room, member!, 'inventoryAdd')) bad(403, '增加物品数量需要 GM 授权');
      if (quantity <= 0) {
        await tx.inventoryEntry.delete({ where: { id: entry!.id } });
        data = { id: entry!.id, deleted: true };
      } else
        data = await tx.inventoryEntry.update({
          where: { id: entry!.id },
          data: { quantity, version: { increment: 1 } },
        });
      break;
    }
    case 'inventory.instance.update': {
      if (member.role !== 'GM') bad(403, '物品信息仅 GM 可修改');
      const entry = await tx.inventoryEntry.findFirst({
        where: { id: str(p.id), character: { roomId } },
        include: { character: true, equipped: true },
      });
      if (!entry) bad(404, '背包物品不存在');
      inventoryEditable(entry!.character);
      if (p.version === undefined) bad(400, '缺少物品实例版本号');
      version(entry!.version, p.version);
      const input = object(p.data),
        modified = modifierData(input, room);
      const instance = z
        .object({
          name: z.string().trim().max(80).optional(),
          description: z.string().max(2000).optional(),
          防御: z.number().finite().min(-1e9).max(1e9).optional(),
          modifierRows: z
            .array(
              z.object({
                targetFieldId: z.string(),
                operation: z.enum(['ADD', 'MULTIPLY', 'OVERRIDE']),
                value: z.number().finite(),
                priority: z.number().int().optional(),
              }),
            )
            .max(50)
            .optional(),
        })
        .parse(modified);
      if (member!.role !== 'GM')
        for (const key of ['modifierRows', 'modifiers', '防御'])
          if (key in input && JSON.stringify(input[key]) !== JSON.stringify(object(entry!.data)[key]))
            bad(403, '物品实例的数值效果仅 GM 可修改');
      const changed = await tx.inventoryEntry.updateMany({
        where: { id: entry!.id, version: entry!.version },
        data: { data: json({ ...object(entry!.data), ...instance }), version: { increment: 1 } },
      });
      if (!changed.count) bad(409, '物品实例已被其他人修改，请刷新');
      data = await tx.inventoryEntry.findUniqueOrThrow({ where: { id: entry!.id } });
      if (entry!.equipped.length) await refreshCharacter(tx, entry!.characterId, rules);
      break;
    }
    case 'inventory.transfer':
    case 'inventory.loot': {
      const entry = await tx.inventoryEntry.findFirst({
        where: { id: required(p.id, '物品 ID'), character: { roomId } },
        include: { character: true, item: true, equipped: { orderBy: { slot: 'asc' } } },
      });
      if (!entry) bad(404, '物品已被取走');
      const target = await characterIn(tx, roomId, required(p.targetCharacterId, '接收角色'));
      const currentRoom = await tx.room.findUniqueOrThrow({ where: { id: roomId } });
      const access = (c: {
        id: string;
        ownerId: string | null;
        visibility: string;
        isNpc: boolean;
        currentHp: number;
        derived: unknown;
      }) => ({ ...c, healthCurrent: characterCurrentHealth(currentRoom, c) });
      if (type === 'inventory.loot') {
        if (!canLootCharacterInventory(member!, access(entry!.character), userId))
          bad(403, '只能拾取其他玩家生命归零角色的物品');
        if (member!.role !== 'GM' && (target.ownerId !== userId || target.isNpc || target.visibility === 'GM'))
          bad(403, '只能放入自己的存活角色背包');
        if (characterIsIncapacitated(access(target))) bad(403, '接收角色生命归零，不能接收物品');
      }
      if (!canExchangeWithFallenCharacter(member!, access(entry!.character), access(target), userId)) {
        inventoryEditable(entry!.character);
        inventoryEditable(target);
      }
      if (!Number.isInteger(p.version)) bad(400, '缺少物品版本号');
      version(entry!.version, p.version);
      const quantity = Number(p.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > entry!.quantity) bad(400, '转移数量无效');
      const sourceSlot = str(p.sourceSlot || p.slot),
        targetSlot = str(p.targetSlot);
      const selected = sourceSlot
        ? equipmentAtSlot(
            entry!.equipped.map((e) => ({ ...e, entryId: entry!.id })),
            [entry!],
            sourceSlot,
          )
        : undefined;
      if (sourceSlot && !selected) bad(409, '该部位的装备已变化，请刷新');
      if ((sourceSlot || targetSlot) && quantity !== 1) bad(400, '每次转移一件装备');
      if (targetSlot) {
        if (!withBackpackSlot(array(currentRoom.equipmentSlots)).includes(targetSlot)) bad(400, '装备槽无效');
        if (
          !isWearable(entry!.item.kind) ||
          !equipmentFitsSlot(entry!.item.compatibleSlots, targetSlot, entry!.item.kind)
        )
          bad(400, '物品与目标装备部位不兼容');
        if (
          entry!.item.kind === '双手武器' &&
          !['主手', '副手'].every((s) => withBackpackSlot(array(currentRoom.equipmentSlots)).includes(s))
        )
          bad(400, '双手武器需要主手和副手两个装备部位');
        const worn = equipmentAtSlot(target.equipment, target.inventory, targetSlot);
        if (p.targetEquipmentId !== undefined && (worn?.id || null) !== p.targetEquipmentId)
          bad(409, '目标部位装备已变化，请刷新');
      }
      const same = entry!.characterId === target.id;
      const targetCapacity = inventoryCapacity(currentRoom, target);
      inventoryCharacters.add(entry!.characterId);
      inventoryCharacters.add(target.id);
      if (same && !sourceSlot && !targetSlot) bad(400, '同一背包内请使用整理操作');
      let position = entry!.position;
      if (!same) {
        const requested = p.position === undefined ? undefined : Number(p.position);
        if (
          requested !== undefined &&
          (!Number.isSafeInteger(requested) || requested < 0 || requested >= targetCapacity)
        )
          bad(400, '目标背包格无效');
        if (requested !== undefined && target.inventory.some((e) => e.position === requested))
          bad(409, '目标格已有物品，请选择空格');
        position = targetSlot
          ? equippedPosition(target.inventory)
          : (requested ?? firstInventorySpace(targetCapacity, target.inventory)!);
        if (!targetSlot && firstInventorySpace(targetCapacity, target.inventory) === undefined)
          bad(409, '目标背包已满');
        if (position === undefined) bad(409, '目标背包已满');
      } else if (p.position !== undefined) {
        position = Number(p.position);
        if (!Number.isSafeInteger(position) || position < 0 || position >= targetCapacity) bad(400, '目标背包格无效');
        if (target.inventory.some((e) => e.position === position && e.id !== entry!.id))
          bad(409, '目标格已有物品，请选择空格');
      }
      const removeCount = same
        ? selected
          ? 1
          : 0
        : Math.max(selected ? 1 : 0, entry!.equipped.length - (entry!.quantity - quantity));
      const toRemove = [...(selected ? [selected] : []), ...entry!.equipped.filter((e) => e.id !== selected?.id)].slice(
        0,
        removeCount,
      );
      const changed = await tx.inventoryEntry.updateMany({
        where: { id: entry!.id, version: entry!.version, quantity: { gte: quantity } },
        data: { ...(same ? { position } : { quantity: { decrement: quantity } }), version: { increment: 1 } },
      });
      if (!changed.count) bad(409, '物品已变化，请刷新后重试');
      if (toRemove.length) await tx.equippedItem.deleteMany({ where: { id: { in: toRemove.map((e) => e.id) } } });
      data = same
        ? await tx.inventoryEntry.findUniqueOrThrow({ where: { id: entry!.id } })
        : await tx.inventoryEntry.create({
            data: { characterId: target.id, itemId: entry!.itemId, quantity, position, data: json(entry!.data) },
          });
      if (targetSlot) {
        const conflicts = equipmentConflicts(target.equipment, target.inventory, targetSlot, entry!.item.kind);
        await tx.equippedItem.deleteMany({ where: { id: { in: conflicts.map((e) => e.id) } } });
        if (same && (await tx.equippedItem.count({ where: { entryId: entry!.id } })) >= entry!.quantity)
          bad(409, '没有可穿戴的剩余数量');
        await tx.equippedItem.create({ data: { characterId: target.id, entryId: data.id, slot: targetSlot } });
      }
      if (!same && quantity === entry!.quantity) await tx.inventoryEntry.delete({ where: { id: entry!.id } });
      await tx.tradeRequest.updateMany({
        where: { entryId: entry!.id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      if (toRemove.length || (same && targetSlot)) await refreshCharacter(tx, entry!.characterId, rules);
      if (!same && targetSlot) await refreshCharacter(tx, target.id, rules);
      break;
    }
    case 'equipment.set': {
      const c = await characterIn(tx, roomId, required(p.characterId, '角色 ID'));
      inventoryEditable(c);
      const slot = required(p.slot, '装备槽');
      if (!withBackpackSlot(array(room.equipmentSlots)).includes(slot)) bad(400, '装备槽无效');
      inventoryCharacters.add(c.id);
      const incoming = c.inventory.find((e) => e.id === p.entryId);
      const conflicts = equipmentConflicts(c.equipment, c.inventory, slot, incoming?.item.kind);
      await tx.equippedItem.deleteMany({ where: { id: { in: conflicts.map((e) => e.id) } } });
      if (p.entryId) {
        const entry: any = c.inventory.find((e) => e.id === p.entryId);
        if (!entry) bad(404, '背包物品不存在');
        if (!isWearable(entry.item.kind)) bad(400, '仅装备、双手武器、背包或饰品类物品可穿戴');
        if (!equipmentFitsSlot(entry.item.compatibleSlots, slot, entry.item.kind)) bad(400, '装备与槽位不兼容');
        if (
          entry.item.kind === '双手武器' &&
          !['主手', '副手'].every((s) => withBackpackSlot(array(room.equipmentSlots)).includes(s))
        )
          bad(400, '双手武器需要主手和副手两个装备部位');
        const used = await tx.equippedItem.count({ where: { entryId: entry.id } });
        if (used >= entry.quantity) bad(409, '物品数量不足');
        await tx.equippedItem.create({ data: { characterId: c.id, entryId: entry.id, slot } });
      }
      data = await refreshCharacter(tx, c.id, rules);
      break;
    }

    default:
      bad(400, '未知操作类型');
  }
  return data;
}
