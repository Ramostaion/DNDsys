import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { OperationContext } from './operations/context.js';
import { gm, version } from './operations/helpers.js';
import { fail } from './http.js';
import type express from 'express';
import { asyncRoute } from './http.js';
import { createRoomAccess } from './access.js';

export function registerNpcDirectory(app: express.Express, db: PrismaClient, auth: express.RequestHandler) {
  const member = createRoomAccess(db);
  app.get(
    '/api/rooms/:roomId/npc-directory',
    auth,
    asyncRoute(async (req, res) => {
      const roomId = String(req.params.roomId);
      gm(await member(roomId, req.user!.id));
      res.setHeader('Cache-Control', 'no-store');
      res.json(await readNpcDirectory(db, roomId));
    }),
  );
}

type Tx = Prisma.TransactionClient;
export async function readNpcDirectory(db: PrismaClient, roomId: string) {
  return db.$transaction(
    async (tx) => ({
      revision: (await tx.npcDirectoryState.findUnique({ where: { roomId } }))?.version ?? 0,
      folders: await tx.npcFolder.findMany({ where: { roomId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
      classifications: await tx.npcClassification.findMany({ where: { roomId } }),
    }),
    { isolationLevel: 'RepeatableRead' },
  );
}
export async function bumpNpcDirectory(tx: Tx, roomId: string) {
  return tx.npcDirectoryState.upsert({
    where: { roomId },
    create: { roomId, version: 1 },
    update: { version: { increment: 1 } },
  });
}
export async function npcFolderIn(tx: Tx, roomId: string, id: string) {
  const folder = await tx.npcFolder.findFirst({ where: { id, roomId } });
  if (!folder) fail(404, '目录不存在或不属于当前房间');
  return folder!;
}
export async function assignNewNpc(tx: Tx, roomId: string, characterId: string, folderId: unknown) {
  if (!folderId) return;
  const folder = await npcFolderIn(tx, roomId, z.string().parse(folderId));
  await tx.npcClassification.create({ data: { roomId, characterId, folderId: folder.id } });
  await bumpNpcDirectory(tx, roomId);
}
export async function clearNpcClassification(tx: Tx, roomId: string, characterId: string) {
  if ((await tx.npcClassification.deleteMany({ where: { roomId, characterId } })).count)
    await bumpNpcDirectory(tx, roomId);
}
export async function npcDirectoryOperation({ tx, roomId, member, type, p }: OperationContext) {
  gm(member);
  const revision = (await tx.npcDirectoryState.findUnique({ where: { roomId } }))?.version ?? 0;
  version(revision, z.number().int().min(0).parse(p.version));
  const id = z.string().min(1).max(100),
    parentId = p.parentId == null || p.parentId === '' ? null : id.parse(p.parentId);
  const siblings = (parent: string | null) =>
    tx.npcFolder.findMany({ where: { roomId, parentId: parent }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
  const lastPosition = async (parent: string | null) =>
    (await siblings(parent)).reduce((max, row) => Math.max(max, row.position + 1), 0);
  const unique = async (name: string, parent: string | null, except?: string) => {
    if (
      await tx.npcFolder.count({
        where: { roomId, parentId: parent, name, ...(except ? { id: { not: except } } : {}) },
      })
    )
      fail(409, '同级已有同名目录，请先重命名');
  };
  const folder =
    type === 'npcDirectory.create' || type === 'npcDirectory.assign'
      ? null
      : await npcFolderIn(tx, roomId, id.parse(p.id));
  if (parentId) {
    let ancestor: string | null = parentId;
    const visited = new Set<string>();
    while (ancestor) {
      if (ancestor === folder?.id || visited.has(ancestor)) fail(400, '不能将目录移入自身或后代目录');
      visited.add(ancestor);
      ancestor = (await npcFolderIn(tx, roomId, ancestor)).parentId;
    }
  }
  let result: Record<string, unknown> = {};
  switch (type) {
    case 'npcDirectory.create': {
      const name = z.string().trim().min(1).max(100).parse(p.name);
      await unique(name, parentId);
      result = await tx.npcFolder.create({
        data: { roomId, parentId, name, position: await lastPosition(parentId) },
      });
      break;
    }
    case 'npcDirectory.rename': {
      const name = z.string().trim().min(1).max(100).parse(p.name);
      await unique(name, folder!.parentId, folder!.id);
      result = await tx.npcFolder.update({ where: { id: folder!.id }, data: { name } });
      break;
    }
    case 'npcDirectory.move': {
      await unique(folder!.name, parentId, folder!.id);
      result = await tx.npcFolder.update({
        where: { id: folder!.id },
        data: { parentId, position: await lastPosition(parentId) },
      });
      break;
    }
    case 'npcDirectory.sort': {
      const rows = await siblings(folder!.parentId),
        index = rows.findIndex((row) => row.id === folder!.id);
      const other = index + z.union([z.literal(-1), z.literal(1)]).parse(p.direction);
      if (other >= 0 && other < rows.length) [rows[index], rows[other]] = [rows[other], rows[index]];
      for (const [position, row] of rows.entries())
        await tx.npcFolder.update({ where: { id: row.id }, data: { position } });
      break;
    }
    case 'npcDirectory.delete': {
      const destination = z.enum(['PARENT', 'ROOT']).parse(p.destination) === 'PARENT' ? folder!.parentId : null;
      const children = await siblings(folder!.id);
      let position = await lastPosition(destination);
      for (const child of children) {
        await unique(child.name, destination, child.id);
        await tx.npcFolder.update({ where: { id: child.id }, data: { parentId: destination, position: position++ } });
      }
      if (destination)
        await tx.npcClassification.updateMany({
          where: { roomId, folderId: folder!.id },
          data: { folderId: destination },
        });
      else await tx.npcClassification.deleteMany({ where: { roomId, folderId: folder!.id } });
      await tx.npcFolder.delete({ where: { id: folder!.id } });
      result = { id: folder!.id, deleted: true };
      break;
    }
    case 'npcDirectory.assign': {
      const ids = [...new Set(z.array(id).min(1).max(5000).parse(p.characterIds))];
      if ((await tx.character.count({ where: { roomId, id: { in: ids }, isNpc: true } })) !== ids.length)
        fail(400, '只能分类当前房间的 NPC，请刷新列表');
      await tx.npcClassification.deleteMany({ where: { roomId, characterId: { in: ids } } });
      if (parentId)
        await tx.npcClassification.createMany({
          data: ids.map((characterId) => ({ characterId, roomId, folderId: parentId })),
        });
      result = { count: ids.length };
      break;
    }
    default:
      fail(400, '未知目录操作');
  }
  return { ...result, revision: (await bumpNpcDirectory(tx, roomId)).version };
}
