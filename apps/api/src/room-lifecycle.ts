import type { PrismaClient } from '@prisma/client';
import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { requireGM } from './access.js';
import { fail } from './http.js';
import { uploadDir } from './storage.js';

export async function deleteOwnedRoom(db: PrismaClient, roomId: string, userId: string) {
  await db.$transaction(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: roomId } });
    if (!room) fail(404, '房间不存在或已删除');
    if (room!.ownerId !== userId) fail(403, '只有创建此房间的 GM 可以删除房间');
    const member = await tx.roomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
    if (!member) fail(403, '你不是该房间成员');
    requireGM(member!);
    // Remove dependent references before their definitions, including RESTRICT relations in older rooms.
    await tx.clueAttachmentLink.deleteMany({ where: { clue: { roomId } } });
    await tx.characterTag.deleteMany({ where: { roomId } });
    await tx.inventoryEntry.deleteMany({ where: { character: { roomId } } });
    await tx.room.delete({ where: { id: roomId } });
  });
}

/** Delete only this room's private directory; historical shared files at the upload root are retained. */
export async function removeRoomUploads(roomId: string, directory = uploadDir) {
  const root = resolve(directory),
    target = resolve(root, roomId);
  if (!/^[a-z0-9]+$/i.test(roomId) || dirname(target) !== root || target === root) throw new Error('房间图片目录无效');
  await rm(target, { recursive: true, force: true });
}
