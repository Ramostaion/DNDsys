import type { PrismaClient } from '@prisma/client';
import { fail } from './http.js';

export function createRoomAccess(db: PrismaClient) {
  return async (roomId: string, userId: string) => {
    const member = await db.roomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
    if (!member) fail(403, '你不是该房间成员');
    return member!;
  };
}
export function requireGM(member: { role: string }) {
  if (member.role !== 'GM') fail(403, '仅主持人可以执行此操作');
}
