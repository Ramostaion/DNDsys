import { z } from 'zod';
import {
  canLootCharacterInventory,
  canExchangeWithFallenCharacter,
  characterIsIncapacitated,
  characterCurrentHealth,
  isWearable,
  equipmentFitsSlot,
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
      const occupied = new Set(c.inventory.map((e) => e.position));
      const position =
        p.position !== undefined
          ? num(p.position)
          : Array.from({ length: c.inventorySlots }, (_, i) => i).find((i) => !occupied.has(i));
      if (
        position === undefined ||
        !Number.isInteger(position) ||
        position < 0 ||
        position >= c.inventorySlots ||
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
      if (!Number.isInteger(position) || position < 0 || position >= entry!.character.inventorySlots)
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
    case 'inventory.update': {
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
      const selected = sourceSlot ? entry!.equipped.find((e) => e.slot === sourceSlot) : undefined;
      if (sourceSlot && !selected) bad(409, '该部位的装备已变化，请刷新');
      if ((sourceSlot || targetSlot) && quantity !== 1) bad(400, '每次转移一件装备');
      if (targetSlot) {
        if (!array(currentRoom.equipmentSlots).includes(targetSlot)) bad(400, '装备槽无效');
        if (!isWearable(entry!.item.kind) || !equipmentFitsSlot(entry!.item.compatibleSlots, targetSlot))
          bad(400, '物品与目标装备部位不兼容');
        const worn = target.equipment.find((e) => e.slot === targetSlot);
        if (p.targetEquipmentId !== undefined && (worn?.id || null) !== p.targetEquipmentId)
          bad(409, '目标部位装备已变化，请刷新');
      }
      const same = entry!.characterId === target.id;
      inventoryCharacters.add(entry!.characterId);
      inventoryCharacters.add(target.id);
      if (same && !sourceSlot && !targetSlot) bad(400, '同一背包内请使用整理操作');
      let position = entry!.position;
      if (!same) {
        const requested = p.position === undefined ? undefined : Number(p.position);
        if (
          requested !== undefined &&
          (!Number.isSafeInteger(requested) || requested < 0 || requested >= target.inventorySlots)
        )
          bad(400, '目标背包格无效');
        if (requested !== undefined && target.inventory.some((e) => e.position === requested))
          bad(409, '目标格已有物品，请选择空格');
        position = targetSlot
          ? equippedPosition(target.inventory)
          : (requested ??
            Array.from({ length: target.inventorySlots }, (_, i) => i).find(
              (i) => !target.inventory.some((e) => e.position === i),
            )!);
        if (position === undefined) bad(409, '目标背包已满');
      } else if (p.position !== undefined) {
        position = Number(p.position);
        if (!Number.isSafeInteger(position) || position < 0 || position >= target.inventorySlots)
          bad(400, '目标背包格无效');
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
        await tx.equippedItem.deleteMany({ where: { characterId: target.id, slot: targetSlot } });
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
      if (!array(room.equipmentSlots).includes(slot)) bad(400, '装备槽无效');
      inventoryCharacters.add(c.id);
      await tx.equippedItem.deleteMany({ where: { characterId: c.id, slot } });
      if (p.entryId) {
        const entry: any = c.inventory.find((e) => e.id === p.entryId);
        if (!entry) bad(404, '背包物品不存在');
        if (!isWearable(entry.item.kind)) bad(400, '仅装备或饰品类物品可穿戴');
        if (!equipmentFitsSlot(entry.item.compatibleSlots, slot)) bad(400, '装备与槽位不兼容');
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
