import { array, object } from '../data.js';
import { refreshCharacter } from '../character-values.js';
import { fail as bad } from '../http.js';
import { json, str, required, canEditItems, version, itemData } from './helpers.js';
import type { OperationContext } from './context.js';

export async function itemOperation(context: OperationContext) {
  const { tx, room, member, rules, roomId, p } = context;
  let data: any;
  switch (context.type) {
    case 'item.create': {
      canEditItems(room, member!);
      data = await tx.itemDefinition.create({
        data: {
          roomId,
          name: required(p.name, '物品名'),
          kind: str(p.kind) || '杂物',
          description: str(p.description),
          imageUrl: p.imageUrl || null,
          data: json(itemData(p.data, room)),
          compatibleSlots: json(array(p.compatibleSlots)),
        },
      });
      break;
    }
    case 'item.update': {
      canEditItems(room, member!);
      const item = await tx.itemDefinition.findFirst({ where: { id: str(p.id), roomId } });
      if (!item) bad(404, '物品不存在');
      if (!Number.isInteger(Number(p.version))) bad(400, '缺少物品版本号');
      version(item!.version, p.version);
      const patch = object(p.patch),
        update: any = { version: { increment: 1 } };
      for (const key of ['name', 'kind', 'description', 'imageUrl', 'data', 'compatibleSlots'])
        if (key in patch) {
          if (key === 'name') update.name = required(patch.name, '物品名');
          else if (key === 'description') update.description = str(patch.description).slice(0, 5000);
          else if (key === 'data') update.data = json(itemData(patch.data, room));
          else if (key === 'compatibleSlots') update.compatibleSlots = json(array(patch.compatibleSlots).map(str));
          else update[key] = patch[key];
        }
      const changed = await tx.itemDefinition.updateMany({
        where: { id: item!.id, version: item!.version },
        data: update,
      });
      if (!changed.count) bad(409, '物品已被其他人修改，请刷新');
      data = await tx.itemDefinition.findUniqueOrThrow({ where: { id: item!.id } });
      if (['data', 'kind', 'name'].some((key) => key in patch)) {
        const equipped = await tx.equippedItem.findMany({
          where: { entry: { itemId: item!.id } },
          select: { characterId: true },
        });
        for (const characterId of new Set(equipped.map((e) => e.characterId)))
          await refreshCharacter(tx, characterId, rules);
      }
      break;
    }
    case 'item.delete': {
      canEditItems(room, member!);
      const item = await tx.itemDefinition.findFirst({ where: { id: str(p.id), roomId } });
      if (!item) bad(404, '物品不存在');
      if (await tx.inventoryEntry.count({ where: { itemId: item!.id } })) bad(409, '物品已在背包中，请先移除物品实例');
      await tx.itemDefinition.delete({ where: { id: item!.id } });
      data = { id: item!.id };
      break;
    }

    default:
      bad(400, '未知操作类型');
  }
  return data;
}
