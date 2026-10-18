import type express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Prisma, PrismaClient, type PrivateClue, type ClueAttachment } from '@prisma/client';
import { z } from 'zod';
import { asyncRoute as wrap, fail } from './http.js';
import { MAX_UPLOAD_BYTES, sanitizeImage, uploadDir } from './upload.js';
import { clueSendInput, clueForwardInput, clueFilename } from './private-clue-input.js';
import { roomMemberName } from '@dnd/shared';
import { roomActorName } from './room-member-profile.js';

type Notify = (roomId: string, userIds: string[], kind: 'delivered' | 'updated') => void;
const files = (roomId: string) => join(uploadDir, roomId, 'private-clues');
const include = { attachments: { include: { attachment: true }, orderBy: { sortOrder: 'asc' as const } } };
type WithAttachments = PrivateClue & { attachments: { attachment: ClueAttachment }[] };
export function registerPrivateClues(
  app: express.Express,
  db: PrismaClient,
  auth: express.RequestHandler,
  notify: Notify,
) {
  const root = '/api/rooms/:roomId/private-clues';
  async function member(roomId: string, userId: string) {
    const m = await db.roomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
    if (!m) return fail(403, '你不是该房间成员');
    return m;
  }
  const gm: express.RequestHandler = wrap(async (req, _res, next) => {
    if ((await member(String(req.params.roomId), req.user!.id)).role !== 'GM')
      fail(403, '仅 GM 可以发送或管理私密线索');
    next();
  });
  const attachmentView = (a: ClueAttachment) => ({
    id: a.id,
    filename: a.filename,
    sizeBytes: a.sizeBytes,
    thumbUrl: `/api/rooms/${a.roomId}/private-clues/attachments/${a.id}/thumb`,
    originalUrl: `/api/rooms/${a.roomId}/private-clues/attachments/${a.id}/original`,
  });
  async function forwardAllowed(c: PrivateClue) {
    if (c.revokedAt) return false;
    const original = c.rootClueId ? await db.privateClue.findUnique({ where: { id: c.rootClueId } }) : c;
    return !!original && !original.revokedAt && original.allowForward;
  }
  async function visible(c: WithAttachments, detail: boolean, isSender = false) {
    return {
      id: c.id,
      title: c.title,
      senderName: c.senderName,
      sharedByName: c.sharedByName,
      createdAt: c.createdAt,
      revokedAt: c.revokedAt,
      characterLabel: c.revokedAt ? '' : c.characterLabel,
      allowForward: await forwardAllowed(c),
      attachments: c.revokedAt ? [] : c.attachments.map((link) => attachmentView(link.attachment)),
      ...(detail ? { bodyMarkdown: c.revokedAt ? '' : c.bodyMarkdown } : {}),
      ...(isSender ? { gmNote: c.gmNote } : {}),
    };
  }
  async function recipients(tx: Prisma.TransactionClient, roomId: string, ids: string[]) {
    const rows = await tx.roomMember.findMany({ where: { roomId, userId: { in: ids } } });
    if (new Set(ids).size !== ids.length || rows.length !== ids.length) fail(400, '接收人必须是本房间成员，且不能重复');
  }
  type CommandResult = { clueId: string; deliveryIds: string[]; recipientUserIds: string[] };
  async function command(
    id: string,
    roomId: string,
    userId: string,
    kind: string,
    create: (tx: Prisma.TransactionClient) => Promise<CommandResult>,
  ) {
    const restore = (receipt: { roomId: string; userId: string; result: Prisma.JsonValue }) => {
      const value = receipt.result as unknown as CommandResult & { kind: string };
      if (receipt.roomId !== roomId || receipt.userId !== userId || value.kind !== kind)
        fail(409, '操作 ID 已被其他操作使用');
      return value;
    };
    const existing = await db.operationReceipt.findUnique({ where: { id } });
    if (existing) return restore(existing);
    for (let attempt = 0; attempt < 3; attempt++)
      try {
        return await db.$transaction(
          async (tx) => {
            // Claim the operation inside the same transaction as the content and all deliveries.
            await tx.operationReceipt.create({ data: { id, roomId, userId, result: { kind } } });
            const result = await create(tx);
            await tx.operationReceipt.update({ where: { id }, data: { result: { ...result, kind } } });
            return result;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
        );
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'P2002') {
          const receipt = await db.operationReceipt.findUnique({ where: { id } });
          if (receipt) return restore(receipt);
        }
        if (code === 'P2034' && attempt < 2) continue;
        throw error;
      }
    return fail(409, '数据正在更新，请使用原操作重试');
  }
  function delivered(roomId: string, result: CommandResult) {
    notify(roomId, result.recipientUserIds, 'delivered');
  }
  async function receiptChanged(roomId: string, clueId: string, userId: string) {
    const c = await db.privateClue.findUniqueOrThrow({ where: { id: clueId } });
    notify(roomId, [userId, c.senderUserId], 'updated');
  }
  app.post(
    `${root}/send`,
    auth,
    gm,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        userId = req.user!.id,
        input = clueSendInput.parse(req.body);
      const result = await command(input.id, roomId, userId, 'privateClue.send', async (tx) => {
        await recipients(tx, roomId, input.recipientUserIds);
        const attachments = await tx.clueAttachment.findMany({
          where: { roomId, id: { in: input.attachmentIds }, uploadedByUserId: userId },
        });
        if (attachments.length !== input.attachmentIds.length) fail(400, '附件不存在或不属于当前投递者');
        for (const a of attachments)
          for (const name of [a.storageName, a.thumbName])
            await access(join(files(roomId), name)).catch(() => fail(409, '附件文件不可用，请移除后重新上传'));
        const character = input.associatedCharacterId
          ? await tx.character.findFirst({ where: { id: input.associatedCharacterId, roomId } })
          : null;
        if (input.associatedCharacterId && !character) fail(400, '关联角色不属于本房间');
        const c = await tx.privateClue.create({
          data: {
            roomId,
            senderUserId: userId,
            senderName: await roomActorName(tx, roomId, userId),
            title: input.title,
            bodyMarkdown: input.bodyMarkdown,
            gmNote: input.gmNote,
            characterLabel: character?.name || '',
            allowForward: input.allowForward,
            attachments: {
              create: input.attachmentIds.map((attachmentId, sortOrder) => ({ attachmentId, sortOrder })),
            },
            deliveries: { create: input.recipientUserIds.map((recipientUserId) => ({ roomId, recipientUserId })) },
          },
          include: { deliveries: true },
        });
        return { clueId: c.id, deliveryIds: c.deliveries.map((d) => d.id), recipientUserIds: input.recipientUserIds };
      });
      delivered(roomId, result);
      notify(roomId, [userId], 'updated');
      res.json(result);
    }),
  );
  app.get(
    `${root}/inbox`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        userId = req.user!.id;
      await member(roomId, userId);
      const rows = await db.clueDelivery.findMany({
        where: { roomId, recipientUserId: userId },
        include: { clue: { include } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const items = await Promise.all(
        rows.map(async (d) => ({
          ...(await visible(d.clue, false)),
          id: d.id,
          readAt: d.readAt,
          savedAt: d.savedAt,
          clueId: d.clueId,
        })),
      );
      // Delivery ID, rather than content ID, identifies a personal reading state.
      res
        .set('Cache-Control', 'no-store')
        .json({ items, unreadCount: rows.filter((d) => !d.readAt && !d.clue.revokedAt).length });
    }),
  );
  app.get(
    `${root}/deliveries/:deliveryId`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        userId = req.user!.id,
        m = await member(roomId, userId);
      const d = await db.clueDelivery.findFirst({
        where: { id: String(req.params.deliveryId), roomId },
        include: { clue: { include } },
      });
      if (!d || (d.recipientUserId !== userId && !(m.role === 'GM' && d.clue.senderUserId === userId)))
        return fail(404, '线索不存在或没有阅读权限');
      res
        .set('Cache-Control', 'no-store')
        .json({ ...(await visible(d.clue, true)), id: d.id, clueId: d.clueId, readAt: d.readAt, savedAt: d.savedAt });
    }),
  );
  app.patch(
    `${root}/deliveries/:deliveryId`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        userId = req.user!.id;
      await member(roomId, userId);
      const input = z.object({ read: z.boolean().optional(), saved: z.boolean().optional() }).parse(req.body);
      const d = await db.clueDelivery.findFirst({
        where: { id: String(req.params.deliveryId), roomId, recipientUserId: userId },
        include: { clue: true },
      });
      if (!d) return fail(404, '线索不存在或没有阅读权限');
      if (d.clue.revokedAt) fail(409, '该线索已撤回');
      if (input.read === true)
        await db.clueDelivery.updateMany({ where: { id: d.id, readAt: null }, data: { readAt: new Date() } });
      if (input.read === false || input.saved !== undefined)
        await db.clueDelivery.update({
          where: { id: d.id },
          data: {
            ...(input.read === false ? { readAt: null } : {}),
            ...(input.saved !== undefined ? { savedAt: input.saved ? new Date() : null } : {}),
          },
        });
      await receiptChanged(roomId, d.clueId, userId);
      res.json(
        await db.clueDelivery.findUniqueOrThrow({
          where: { id: d.id },
          select: { id: true, readAt: true, savedAt: true },
        }),
      );
    }),
  );
  app.get(
    `${root}/sent`,
    auth,
    gm,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        userId = req.user!.id;
      const rows = await db.privateClue.findMany({
        where: { roomId, senderUserId: userId },
        include: { ...include, deliveries: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      res.set('Cache-Control', 'no-store').json(
        await Promise.all(
          rows.map(async (c) => ({
            ...(await visible(c, false, true)),
            recipientCount: c.deliveries.length,
            readCount: c.deliveries.filter((d) => d.readAt).length,
          })),
        ),
      );
    }),
  );
  app.get(
    `${root}/sent/:clueId`,
    auth,
    gm,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        userId = req.user!.id;
      const c = await db.privateClue.findFirst({
        where: { id: String(req.params.clueId), roomId, senderUserId: userId },
        include: { ...include, deliveries: true },
      });
      if (!c) return fail(404, '已发线索不存在');
      const users = await db.user.findMany({
        where: { id: { in: c.deliveries.map((d) => d.recipientUserId) } },
        select: { id: true, username: true },
      });
      const members = await db.roomMember.findMany({
        where: { roomId, userId: { in: c.deliveries.map((d) => d.recipientUserId) } },
        include: { user: { select: { username: true } } },
      });
      res.set('Cache-Control', 'no-store').json({
        ...(await visible(c, true, true)),
        isForwarded: !!c.rootClueId,
        deliveries: c.deliveries.map((d) => ({
          id: d.id,
          recipientUserId: d.recipientUserId,
          recipientName: roomMemberName(
            members.find((m) => m.userId === d.recipientUserId),
            users.find((u) => u.id === d.recipientUserId)?.username || '已离开的账号',
          ),
          readAt: d.readAt,
          createdAt: d.createdAt,
        })),
      });
    }),
  );
  app.patch(
    `${root}/sent/:clueId`,
    auth,
    gm,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        userId = req.user!.id,
        input = z.object({ allowForward: z.boolean().optional(), revoke: z.literal(true).optional() }).parse(req.body);
      const c = await db.privateClue.findFirst({
        where: { id: String(req.params.clueId), roomId, senderUserId: userId },
      });
      if (!c) return fail(404, '已发线索不存在');
      if (c.rootClueId) fail(400, '请从原始投递管理分享权限与撤回');
      await db.$transaction(async (tx) => {
        if (input.revoke)
          await tx.privateClue.updateMany({
            where: { roomId, OR: [{ id: c.id }, { rootClueId: c.id }], revokedAt: null },
            data: { revokedAt: new Date(), allowForward: false },
          });
        else if (input.allowForward !== undefined)
          await tx.privateClue.updateMany({
            where: { id: c.id, revokedAt: null },
            data: { allowForward: input.allowForward },
          });
      });
      const deliveries = await db.clueDelivery.findMany({
        where: { roomId, clue: { OR: [{ id: c.id }, { rootClueId: c.id }] } },
      });
      notify(roomId, [userId, ...deliveries.map((d) => d.recipientUserId)], 'updated');
      res.json({ ok: true });
    }),
  );
  app.post(
    `${root}/deliveries/:deliveryId/forward`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        userId = req.user!.id;
      await member(roomId, userId);
      const input = clueForwardInput.parse(req.body);
      const result = await command(input.id, roomId, userId, 'privateClue.forward', async (tx) => {
        const d = await tx.clueDelivery.findFirst({
          where: { id: String(req.params.deliveryId), roomId, recipientUserId: userId },
          include: { clue: { include } },
        });
        if (!d) return fail(404, '线索不存在或没有阅读权限');
        const original = d.clue.rootClueId
          ? await tx.privateClue.findFirst({ where: { id: d.clue.rootClueId, roomId } })
          : d.clue;
        if (d.clue.revokedAt || !original || original.revokedAt || !original.allowForward)
          fail(403, 'GM 未允许分享此线索，或已关闭分享');
        if (input.recipientUserIds.includes(userId)) fail(400, '请选择其他房间成员');
        await recipients(tx, roomId, input.recipientUserIds);
        const c = await tx.privateClue.create({
          data: {
            roomId,
            senderUserId: d.clue.senderUserId,
            senderName: d.clue.senderName,
            sharedByUserId: userId,
            sharedByName: await roomActorName(tx, roomId, userId),
            rootClueId: original!.id,
            title: d.clue.title,
            bodyMarkdown: d.clue.bodyMarkdown,
            characterLabel: d.clue.characterLabel,
            attachments: {
              create: d.clue.attachments.map((link, sortOrder) => ({ attachmentId: link.attachment.id, sortOrder })),
            },
            deliveries: { create: input.recipientUserIds.map((recipientUserId) => ({ roomId, recipientUserId })) },
          },
          include: { deliveries: true },
        });
        return {
          clueId: c.id,
          deliveryIds: c.deliveries.map((row) => row.id),
          recipientUserIds: input.recipientUserIds,
        };
      });
      delivered(roomId, result);
      const c = await db.privateClue.findUniqueOrThrow({ where: { id: result.clueId } });
      notify(roomId, [c.senderUserId, userId], 'updated');
      res.json(result);
    }),
  );

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  async function saveImage(roomId: string, userId: string, filename: string, bytes: Buffer) {
    const id = randomUUID(),
      storageName = `${id}.webp`,
      thumbName = `${id}-thumb.webp`,
      dir = files(roomId);
    const thumb = await sharp(bytes)
      .resize({ width: 360, height: 240, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
    await mkdir(dir, { recursive: true });
    const written: string[] = [];
    try {
      for (const [name, data] of [
        [storageName, bytes],
        [thumbName, thumb],
      ] as const) {
        const path = join(dir, name);
        await writeFile(path, data, { flag: 'wx' });
        written.push(path);
        await access(path);
      }
      return attachmentView(
        await db.clueAttachment.create({
          data: { roomId, uploadedByUserId: userId, filename, storageName, thumbName, sizeBytes: bytes.length },
        }),
      );
    } catch (error) {
      await Promise.all(written.map((path) => unlink(path).catch(() => {})));
      throw error;
    }
  }
  app.post(
    `${root}/attachments`,
    auth,
    gm,
    upload.single('file'),
    wrap(async (req, res) => {
      if (!req.file) fail(400, '请选择 JPEG、PNG 或 WebP 图片，不超过 10MB');
      let image;
      try {
        image = await sanitizeImage(req.file!.buffer, req.file!.mimetype, req.file!.originalname);
      } catch (error) {
        return fail(400, (error as Error).message);
      }
      res
        .status(201)
        .json(
          await saveImage(String(req.params.roomId), req.user!.id, clueFilename(req.file!.originalname), image.bytes),
        );
    }),
  );
  app.post(
    `${root}/attachments/from-presentation`,
    auth,
    gm,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        input = z.object({ assetId: z.string() }).parse(req.body);
      const asset = await db.presentationAsset.findFirst({ where: { id: input.assetId, roomId } });
      if (!asset) return fail(404, '剧情素材不存在');
      let bytes: Buffer;
      try {
        bytes = await readFile(join(uploadDir, roomId, 'presentation', asset.storageName));
      } catch {
        return fail(409, '素材文件不可用，请重新上传');
      }
      res.status(201).json({
        ...(await saveImage(roomId, req.user!.id, `${asset.title}.webp`, bytes)),
        previouslyPublic: !!asset.revealedAt,
      });
    }),
  );
  app.get(
    `${root}/attachments/:attachmentId/:kind`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        userId = req.user!.id,
        m = await member(roomId, userId),
        kind = String(req.params.kind);
      if (!['thumb', 'original'].includes(kind)) fail(404, '图片不存在');
      const a = await db.clueAttachment.findFirst({
        where: {
          id: String(req.params.attachmentId),
          roomId,
          OR: [
            ...(m.role === 'GM' ? [{ uploadedByUserId: userId }] : []),
            {
              clues: { some: { clue: { revokedAt: null, deliveries: { some: { recipientUserId: userId, roomId } } } } },
            },
          ],
        },
      });
      if (!a) return fail(404, '图片不存在或没有阅读权限');
      const path = join(files(roomId), kind === 'thumb' ? a.thumbName : a.storageName);
      await access(path).catch(() => fail(404, '图片文件暂时不可用，请重试或联系 GM'));
      res
        .set('Cache-Control', 'private, no-store')
        .set('X-Content-Type-Options', 'nosniff')
        .type('image/webp')
        .sendFile(path);
    }),
  );
  app.delete(
    `${root}/attachments/:attachmentId`,
    auth,
    gm,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        id = String(req.params.attachmentId),
        userId = req.user!.id;
      const a = await db.clueAttachment.findFirst({ where: { id, roomId, uploadedByUserId: userId } });
      if (!a) return fail(404, '附件不存在');
      if (await db.clueAttachmentLink.count({ where: { attachmentId: id } })) fail(409, '已发送的附件不能删除');
      await db.clueAttachment.delete({ where: { id } });
      await Promise.all([a.storageName, a.thumbName].map((name) => unlink(join(files(roomId), name)).catch(() => {})));
      res.json({ ok: true });
    }),
  );
}
