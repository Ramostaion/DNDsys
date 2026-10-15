import { randomInt } from 'node:crypto';
import type { Prisma, RoomMember } from '@prisma/client';
import { PUBLIC_DICE_COOLDOWN_MS, rollDice } from '@dnd/shared';
import { object } from './data.js';
import { fail } from './http.js';

/** Called with the room row locked, in the same transaction as its operation receipt. */
export async function recordFreeRoll(
  tx: Prisma.TransactionClient,
  args: {
    roomId: string;
    userId: string;
    member: RoomMember;
    characterId?: string;
    expression: string;
    reason: string;
    visibility: string;
    requestedAt?: number;
  },
  character?: { derived: unknown },
) {
  const publicRoll = args.visibility === 'PUBLIC';
  const room = publicRoll ? await tx.room.findUniqueOrThrow({ where: { id: args.roomId } }) : null;
  const serverNow = Date.now();
  const cooldownUntil = room?.publicDiceAvailableAt?.getTime() || 0;
  if (publicRoll && cooldownUntil > (args.requestedAt ?? serverNow))
    throw Object.assign(
      new Error(
        serverNow < cooldownUntil
          ? `${((cooldownUntil - serverNow) / 1000).toFixed(1)} 秒后可掷骰`
          : '该请求在公开骰冷却期间提交，请重新掷骰',
      ),
      {
        status: 429,
        code: 'DICE_COOLDOWN',
        serverNow,
        cooldownUntil,
        remainingMs: Math.max(0, cooldownUntil - serverNow),
      },
    );
  const actor = await tx.user.findUniqueOrThrow({ where: { id: args.userId }, select: { username: true } });
  let result: ReturnType<typeof rollDice>;
  try {
    result = rollDice(
      args.expression,
      (name) => {
        if (!character) return fail(400, '通用掷骰不能引用角色属性');
        const agility = object(object(character.derived).agility);
        const value =
          name === '敏捷属性加值' && typeof agility.bonus === 'number'
            ? agility.bonus
            : name === '当前有效敏捷' && typeof agility.effective === 'number'
              ? agility.effective
              : object(object(character.derived).values)[name];
        if (typeof value !== 'number' || !Number.isFinite(value)) fail(400, `角色没有数值属性：${name}`);
        return value;
      },
      (sides) => randomInt(1, sides + 1),
    );
  } catch (error) {
    return fail(400, (error as Error).message);
  }
  // Only a valid roll acquires the next deadline. Any later failure rolls both back.
  const acceptedAt = Date.now();
  const nextAllowedAt = acceptedAt + PUBLIC_DICE_COOLDOWN_MS;
  const roll = await tx.diceRoll.create({
    data: {
      roomId: args.roomId,
      userId: args.userId,
      characterId: args.characterId,
      rollerName: actor.username,
      rollerRole: args.member.role,
      expression: args.expression,
      reason: args.reason,
      visibility: args.visibility,
      details: result.parts as Prisma.InputJsonValue,
      total: result.total,
      createdAt: new Date(acceptedAt),
    },
  });
  if (publicRoll)
    await tx.room.update({ where: { id: args.roomId }, data: { publicDiceAvailableAt: new Date(nextAllowedAt) } });
  return { ...roll, ...(publicRoll ? { cooldownUntil: nextAllowedAt, serverNow: Date.now() } : {}) };
}
