import type { Prisma } from '@prisma/client';
import { ROOM_DISPLAY_NAME_MAX_LENGTH, roomMemberName } from '@dnd/shared';
import { z } from 'zod';
import { fail } from './http.js';

export const roomProfileInput = z
  .object({
    displayName: z
      .string()
      .trim()
      .max(ROOM_DISPLAY_NAME_MAX_LENGTH, `房间内名称最多 ${ROOM_DISPLAY_NAME_MAX_LENGTH} 个字符`)
      .refine((name) => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(name), '房间内名称不能包含换行或控制字符'),
  })
  .strict();

/** Snapshot a name from the current room membership, never from client input or the login token. */
export async function roomActorName(db: Pick<Prisma.TransactionClient, 'roomMember'>, roomId: string, userId: string) {
  const member = await db.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    include: { user: { select: { username: true } } },
  });
  if (!member) fail(403, '你不是该房间成员');
  return roomMemberName(member);
}
