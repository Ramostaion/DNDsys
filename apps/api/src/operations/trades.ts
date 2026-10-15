import { characterIsIncapacitated, characterCurrentHealth } from '@dnd/shared';
import { memberCan } from '../permissions.js';
import { fail as bad } from '../http.js';
import { json, str, required, characterIn, version } from './helpers.js';
import type { OperationContext } from './context.js';

export async function tradeOperation(context: OperationContext) {
  const { tx, room, member, roomId, userId, type, p, inventoryEditable } = context;
  let data: any;
  switch (context.type) {
    case 'trade.offer': {
      if (!memberCan(room, member!, 'trade')) bad(403, '本房间交易需由 GM 操作');
      const entry = await tx.inventoryEntry.findFirst({
        where: { id: str(p.entryId), character: { roomId } },
        include: { character: true, equipped: true },
      });
      if (!entry) bad(404, '背包物品不存在');
      inventoryEditable(entry!.character);
      version(entry!.version, p.version);
      const target = await characterIn(tx, roomId, required(p.targetCharacterId, '接收角色'));
      if (target.visibility === 'GM') bad(403, '私密角色不能作为玩家交易目标');
      if (target.id === entry!.characterId || !target.ownerId || target.ownerId === userId)
        bad(400, '请选择另一名玩家控制的角色');
      if (entry!.equipped.length) bad(409, '请先卸下装备');
      const quantity = Number(p.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > entry!.quantity) bad(400, '交易数量无效');
      data = await tx.tradeRequest.create({
        data: {
          roomId,
          senderId: userId,
          sourceOwnerId: entry!.character.ownerId,
          recipientId: target.ownerId!,
          sourceCharacterId: entry!.characterId,
          targetCharacterId: target.id,
          entryId: entry!.id,
          itemId: entry!.itemId,
          quantity,
        },
      });
      break;
    }
    case 'trade.accept': {
      const trade = await tx.tradeRequest.findFirst({ where: { id: str(p.id), roomId } });
      if (!trade) bad(404, '交易请求不存在');
      if (trade!.status !== 'PENDING') bad(409, '交易请求已处理');
      if (trade!.recipientId !== userId && member!.role !== 'GM') bad(403, '只有接收方或 GM 可以确认');
      const entry = await tx.inventoryEntry.findFirst({
        where: { id: trade!.entryId, characterId: trade!.sourceCharacterId },
        include: { character: true, equipped: true },
      });
      const target = await characterIn(tx, roomId, trade!.targetCharacterId);
      if (
        !entry ||
        entry.itemId !== trade!.itemId ||
        entry.quantity < trade!.quantity ||
        entry.equipped.length ||
        entry.character.ownerId !== trade!.sourceOwnerId ||
        target.ownerId !== trade!.recipientId
      )
        bad(409, '物品或角色状态已变化，请重新发起交易');
      inventoryEditable(target);
      if (
        member!.role !== 'GM' &&
        characterIsIncapacitated({
          ownerId: entry!.character.ownerId,
          healthCurrent: characterCurrentHealth(room, entry!.character),
        })
      )
        bad(409, '原角色生命归零，请改用拾取物品');
      const pos = Array.from({ length: target.inventorySlots }, (_, i) => i).find(
        (i) => !target.inventory.some((e) => e.position === i),
      );
      if (pos === undefined) bad(409, '接收方背包已满');
      const claimed = await tx.tradeRequest.updateMany({
        where: { id: trade!.id, status: 'PENDING' },
        data: { status: 'ACCEPTED' },
      });
      if (!claimed.count) bad(409, '交易请求已处理');
      const decremented = await tx.inventoryEntry.updateMany({
        where: { id: entry!.id, version: entry!.version, quantity: { gte: trade!.quantity } },
        data: { quantity: { decrement: trade!.quantity }, version: { increment: 1 } },
      });
      if (!decremented.count) bad(409, '物品数量已变化，请重新发起交易');
      const received = await tx.inventoryEntry.create({
        data: {
          characterId: target.id,
          itemId: entry!.itemId,
          quantity: trade!.quantity,
          position: pos!,
          data: json(entry!.data),
        },
      });
      if (entry!.quantity === trade!.quantity) await tx.inventoryEntry.delete({ where: { id: entry!.id } });
      data = { tradeId: trade!.id, status: 'ACCEPTED', receivedEntryId: received.id };
      break;
    }
    case 'trade.decline':
    case 'trade.cancel': {
      const trade = await tx.tradeRequest.findFirst({ where: { id: str(p.id), roomId } });
      if (!trade) bad(404, '交易请求不存在');
      if (trade!.status !== 'PENDING') bad(409, '交易请求已处理');
      if (
        (type === 'trade.decline' && trade!.recipientId !== userId && member!.role !== 'GM') ||
        (type === 'trade.cancel' && trade!.senderId !== userId && member!.role !== 'GM')
      )
        bad(403, '没有处理交易的权限');
      const status = type === 'trade.decline' ? 'DECLINED' : 'CANCELLED';
      const updated = await tx.tradeRequest.updateMany({
        where: { id: trade!.id, status: 'PENDING' },
        data: { status },
      });
      if (!updated.count) bad(409, '交易请求已处理');
      data = { tradeId: trade!.id, status };
      break;
    }

    default:
      bad(400, '未知操作类型');
  }
  return data;
}
