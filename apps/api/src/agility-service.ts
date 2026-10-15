import { randomInt } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { characterAgility, resolveAgilityContest, rollDice, type AgilityContest } from '@dnd/shared';
import { refreshCharacter } from './character-values.js';
import { rulesOf } from './data.js';
import { sheetFields } from './operations/helpers.js';

/** Both dice and all attribute snapshots are produced in the record's transaction. */
export async function adjudicateAgility(
  tx: Prisma.TransactionClient,
  args: {
    roomId: string;
    actorId?: string;
    targetId?: string;
    operationId: string;
    isGM: boolean;
    privateRecord: boolean;
  },
  random: (sides: number) => number = (sides) => randomInt(1, sides + 1),
): Promise<{ contest?: AgilityContest; skippedReason?: string }> {
  if (!args.actorId || !args.targetId)
    return {
      skippedReason: !args.actorId ? '未选择声明角色，已保存普通行动记录。' : '未选择关联目标，已保存普通行动记录。',
    };
  if (args.actorId === args.targetId) return { skippedReason: '声明角色与目标相同，已保存普通行动记录。' };
  // Stable order keeps both base attributes and recalculated values in the same snapshot.
  await tx.$queryRaw`SELECT id FROM "Character" WHERE "roomId" = ${args.roomId} AND id IN (${args.actorId}, ${args.targetId}) ORDER BY id FOR UPDATE`;
  const room = await tx.room.findUniqueOrThrow({ where: { id: args.roomId } });
  const fields = sheetFields(room.sheetSchema),
    rules = rulesOf(room.rules);
  const participants = [];
  for (const id of [args.actorId, args.targetId]) {
    const derived = await refreshCharacter(tx, id, rules);
    const character = await tx.character.findFirstOrThrow({ where: { id, roomId: args.roomId } });
    const resolution = characterAgility({ ...character, derived }, fields, room.sheetMode);
    if (!resolution.agility) return { skippedReason: `${character.name}：${resolution.reason}，已保存普通行动记录。` };
    participants.push({ character, agility: resolution.agility });
  }
  const privateAttributes = participants.some(({ agility }) => agility.visibility !== 'ALL');
  if (!args.isGM && privateAttributes)
    return { skippedReason: '双方敏捷需为公开字段，私密属性对抗请由 GM 记录；已保存普通行动记录。' };
  const scope =
    args.privateRecord || privateAttributes || participants.some(({ character }) => character.visibility === 'GM')
      ? 'GM'
      : 'ROOM';
  const sides = participants.map(({ character, agility }) => {
    const roll = rollDice('1d20', undefined, random);
    return { ...agility, id: character.id, name: character.name, isNpc: character.isNpc, d20: roll.parts[0].rolls![0] };
  });
  return {
    contest: {
      ...resolveAgilityContest(sides[0], sides[1]),
      version: 4,
      operationId: args.operationId,
      resolvedAt: new Date().toISOString(),
      broadcast: { scope, status: 'PENDING' },
    },
  };
}
