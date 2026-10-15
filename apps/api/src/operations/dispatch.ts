import { characterOperation } from './characters.js';
import { mapOperation } from './maps.js';
import { itemOperation } from './items.js';
import { inventoryOperation } from './inventory.js';
import { tradeOperation } from './trades.js';
import { templateOperation } from './templates.js';
import { questOperation } from './quests.js';
import { drawingOperation } from './drawings.js';
import { combatOperation } from '../combat.js';
import { characterTagOperation } from '../character-tags.js';
import { fail as bad } from '../http.js';
import { gm } from './helpers.js';
import type { OperationContext } from './context.js';

export function dispatchOperation(context: OperationContext) {
  switch (context.type.split('.')[0]) {
    case 'character':
    case 'sheet':
      return characterOperation(context);
    case 'map':
    case 'portal':
    case 'token':
      return mapOperation(context);
    case 'item':
      return itemOperation(context);
    case 'inventory':
    case 'equipment':
      return inventoryOperation(context);
    case 'trade':
      return tradeOperation(context);
    case 'template':
      return templateOperation(context);
    case 'quest':
      return questOperation(context);
    case 'drawing':
      return drawingOperation(context);
    case 'dice':
    case 'combat':
      return combatOperation(context.tx, {
        type: context.type,
        payload: context.p,
        roomId: context.roomId,
        userId: context.userId,
        member: context.member,
        requestedAt: context.requestedAt,
        opId: context.opId,
        rules: context.rules,
      });
    case 'tagDefinition':
    case 'characterTag':
      gm(context.member);
      return characterTagOperation(context.tx, context.roomId, context.type, context.p);
    default:
      bad(400, '未知操作类型');
  }
}
