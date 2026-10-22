import type express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { access, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { MAX_UPLOAD_BYTES, sanitizeImage, uploadDir } from './upload.js';
import { asyncRoute as wrap, fail } from './http.js';

import { sceneAudioSchema, validateSceneAudio, sceneAudioChange } from './scene-audio.js';

type Guard = express.RequestHandler;
type Notify = (roomId: string, revision: number) => void;
const mediaDir = (roomId: string) => join(uploadDir, roomId, 'presentation');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
const assetUrl = (roomId: string, id: string, kind: 'thumb' | 'screen' | 'original') =>
  `/api/rooms/${roomId}/presentation/assets/${id}/image/${kind}`;

export function registerPresentation(
  app: express.Express,
  db: PrismaClient,
  auth: Guard,
  notify: Notify,
  notifyAudio: Notify = () => {},
) {
  const root = '/api/rooms/:roomId/presentation';
  async function membership(roomId: string, userId: string) {
    const row = await db.roomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
    if (!row) fail(403, '你不是该房间成员');
    return row!;
  }
  function publicAsset(
    asset: {
      id: string;
      roomId: string;
      title: string;
      caption: string;
      gmNotes: string;
      tags: unknown;
      groupId: string | null;
      sortOrder: number;
      canReplay: boolean;
      revealedAt: Date | null;
      createdAt: Date;
    },
    isGM: boolean,
  ) {
    return {
      id: asset.id,
      title: asset.title,
      caption: asset.caption,
      ...(isGM ? { gmNotes: asset.gmNotes, tags: asset.tags, groupId: asset.groupId, sortOrder: asset.sortOrder } : {}),
      canReplay: asset.canReplay,
      revealedAt: asset.revealedAt,
      createdAt: asset.createdAt,
      thumbUrl: assetUrl(asset.roomId, asset.id, 'thumb'),
      screenUrl: assetUrl(asset.roomId, asset.id, 'screen'),
      originalUrl: assetUrl(asset.roomId, asset.id, 'original'),
    };
  }
  app.get(
    `${root}/current`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        userId = req.user!.id,
        m = await membership(roomId, userId);
      const session = await db.presentationSession.findUnique({ where: { roomId } });
      const asset = session?.activeAssetId
        ? await db.presentationAsset.findFirst({ where: { id: session.activeAssetId, roomId } })
        : null;
      const cue = session?.activeCueId
        ? await db.presentationCue.findFirst({ where: { id: session.activeCueId, roomId } })
        : null;
      res.json({
        status: session?.status || 'idle',
        revision: session?.revision || 0,
        requestedMode: session?.requestedMode || 'floating',
        allowHistory: session?.allowHistory || false,
        transition: session?.transition || 'none',
        activeCueId: session?.activeCueId || null,
        updatedAt: session?.updatedAt || null,
        asset: asset
          ? { ...publicAsset(asset, m.role === 'GM'), caption: cue?.captionOverride ?? asset.caption }
          : null,
      });
    }),
  );
  app.get(
    `${root}/assets`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        m = await membership(roomId, req.user!.id);
      const assets = await db.presentationAsset.findMany({
        where: { roomId, ...(m.role === 'GM' ? {} : { canReplay: true, revealedAt: { not: null } }) },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      res.json(assets.map((asset) => publicAsset(asset, m.role === 'GM')));
    }),
  );
  app.post(
    `${root}/assets`,
    auth,
    upload.single('file'),
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        m = await membership(roomId, req.user!.id);
      if (m.role !== 'GM') fail(403, '仅主持人可以上传剧情图片');
      if (!req.file) fail(400, '请选择图片');
      const title = z
        .string()
        .trim()
        .min(1)
        .max(100)
        .parse(req.body.title || req.file!.originalname.replace(/\.[^.]+$/, ''));
      const caption = z
        .string()
        .max(500)
        .parse(req.body.caption || '');
      let processed;
      try {
        processed = await sanitizeImage(req.file!.buffer, req.file!.mimetype, req.file!.originalname);
      } catch (error) {
        return fail(400, (error as Error).message);
      }
      const id = randomUUID(),
        names = { storageName: `${id}-original.webp`, screenName: `${id}-screen.webp`, thumbName: `${id}-thumb.webp` };
      const screens = await sharp(processed.bytes)
        .resize({ width: 2200, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      const thumb = await sharp(processed.bytes)
        .resize({ width: 360, height: 240, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 70 })
        .toBuffer();
      const dir = mediaDir(roomId);
      await mkdir(dir, { recursive: true });
      const temp: string[] = [],
        final: string[] = [];
      try {
        for (const [name, bytes] of [
          [names.storageName, processed.bytes],
          [names.screenName, screens],
          [names.thumbName, thumb],
        ] as const) {
          const target = join(dir, name),
            staged = `${target}.tmp`;
          await writeFile(staged, bytes, { flag: 'wx' });
          temp.push(staged);
          await rename(staged, target);
          temp.pop();
          final.push(target);
        }
        const row = await db.presentationAsset.create({
          data: {
            roomId,
            ...names,
            title,
            caption,
            sortOrder: await db.presentationAsset.count({ where: { roomId } }),
          },
        });
        res.status(201).json(publicAsset(row, true));
      } catch (error) {
        await Promise.all([...temp, ...final].map((path) => unlink(path).catch(() => {})));
        throw error;
      }
    }),
  );
  app.get(
    `${root}/assets/:assetId/image/:kind`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        m = await membership(roomId, req.user!.id),
        id = String(req.params.assetId),
        kind = String(req.params.kind);
      if (!['thumb', 'screen', 'original'].includes(kind)) fail(404, '图片不存在');
      const asset = await db.presentationAsset.findFirst({ where: { id, roomId } });
      if (!asset) return fail(404, '图片不存在');
      if (m.role !== 'GM') {
        const session = await db.presentationSession.findUnique({ where: { roomId } });
        if (!((session?.activeAssetId === id && session.status !== 'idle') || (asset.canReplay && asset.revealedAt)))
          fail(403, '这张图片尚未公开');
      }
      const filename = kind === 'thumb' ? asset.thumbName : kind === 'screen' ? asset.screenName : asset.storageName;
      const path = join(mediaDir(roomId), filename);
      await access(path).catch(() => fail(404, '图片文件暂时不可用'));
      res
        .set('Cache-Control', 'private, max-age=300')
        .set('X-Content-Type-Options', 'nosniff')
        .type('image/webp')
        .sendFile(path);
    }),
  );
  const gm = async (roomId: string, userId: string) => {
    const m = await membership(roomId, userId);
    if (m.role !== 'GM') fail(403, '仅主持人可以管理剧情素材');
  };
  app.get(
    `${root}/groups`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId);
      await gm(roomId, req.user!.id);
      res.json(
        await db.presentationGroup.findMany({
          where: { roomId },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
      );
    }),
  );
  app.post(
    `${root}/groups`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId);
      await gm(roomId, req.user!.id);
      const input = z
        .object({ name: z.string().trim().min(1).max(80), sortOrder: z.number().int().optional() })
        .parse(req.body);
      const group = await db.presentationGroup.create({
        data: {
          roomId,
          name: input.name,
          sortOrder: input.sortOrder ?? (await db.presentationGroup.count({ where: { roomId } })),
        },
      });
      res.status(201).json(group);
    }),
  );
  app.patch(
    `${root}/groups/:groupId`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        id = String(req.params.groupId);
      await gm(roomId, req.user!.id);
      const input = z
        .object({ name: z.string().trim().min(1).max(80).optional(), sortOrder: z.number().int().optional() })
        .parse(req.body);
      const changed = await db.presentationGroup.updateMany({ where: { id, roomId }, data: input });
      if (!changed.count) fail(404, '章节不存在');
      res.json(await db.presentationGroup.findUniqueOrThrow({ where: { id } }));
    }),
  );
  app.delete(
    `${root}/groups/:groupId`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        id = String(req.params.groupId);
      await gm(roomId, req.user!.id);
      const changed = await db.presentationGroup.deleteMany({ where: { id, roomId } });
      if (!changed.count) fail(404, '章节不存在');
      res.json({ ok: true });
    }),
  );
  const transitionSchema = z.enum(['none', 'fade', 'black_reveal', 'slow_zoom']);
  app.get(
    `${root}/cues`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId);
      await gm(roomId, req.user!.id);
      res.json(
        await db.presentationCue.findMany({
          where: { roomId },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: { asset: { select: { title: true } } },
        }),
      );
    }),
  );
  app.post(
    `${root}/cues`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId);
      await gm(roomId, req.user!.id);
      const input = z
        .object({
          assetId: z.string(),
          groupId: z.string().nullable().optional(),
          sortOrder: z.number().int().optional(),
          transition: transitionSchema.default('none'),
          captionOverride: z.string().max(500).nullable().optional(),
          audioCue: sceneAudioSchema.optional(),
        })
        .parse(req.body);
      if (!(await db.presentationAsset.findFirst({ where: { id: input.assetId, roomId } }))) fail(404, '素材不存在');
      if ('audioCue' in input && input.audioCue) await validateSceneAudio(db, roomId, input.audioCue);
      if (input.groupId && !(await db.presentationGroup.findFirst({ where: { id: input.groupId, roomId } })))
        fail(404, '章节不存在');
      const cue = await db.presentationCue.create({
        data: {
          roomId,
          assetId: input.assetId,
          groupId: input.groupId ?? null,
          sortOrder: input.sortOrder ?? (await db.presentationCue.count({ where: { roomId } })),
          transition: input.transition,
          captionOverride: input.captionOverride ?? null,
          audioCue: input.audioCue ?? {},
        },
      });
      res.status(201).json(cue);
    }),
  );
  app.patch(
    `${root}/cues/:cueId`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        id = String(req.params.cueId);
      await gm(roomId, req.user!.id);
      const input = z
        .object({
          groupId: z.string().nullable().optional(),
          sortOrder: z.number().int().optional(),
          transition: transitionSchema.optional(),
          captionOverride: z.string().max(500).nullable().optional(),
          audioCue: sceneAudioSchema.optional(),
        })
        .parse(req.body);
      if ('audioCue' in input && input.audioCue) await validateSceneAudio(db, roomId, input.audioCue);
      if (input.groupId && !(await db.presentationGroup.findFirst({ where: { id: input.groupId, roomId } })))
        fail(404, '章节不存在');
      const changed = await db.presentationCue.updateMany({ where: { id, roomId }, data: input });
      if (!changed.count) fail(404, '演出条目不存在');
      res.json(await db.presentationCue.findUniqueOrThrow({ where: { id } }));
    }),
  );
  app.delete(
    `${root}/cues/:cueId`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        id = String(req.params.cueId);
      await gm(roomId, req.user!.id);
      const changed = await db.presentationCue.deleteMany({ where: { id, roomId } });
      if (!changed.count) fail(404, '演出条目不存在');
      await db.presentationSession.updateMany({ where: { roomId, activeCueId: id }, data: { activeCueId: null } });
      res.json({ ok: true });
    }),
  );
  app.patch(
    `${root}/assets/:assetId`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        id = String(req.params.assetId);
      await gm(roomId, req.user!.id);
      const input = z
        .object({
          title: z.string().trim().min(1).max(100).optional(),
          caption: z.string().max(500).optional(),
          gmNotes: z.string().max(2000).optional(),
          tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
          groupId: z.string().nullable().optional(),
          sortOrder: z.number().int().optional(),
          canReplay: z.boolean().optional(),
        })
        .parse(req.body);

      if (input.groupId && !(await db.presentationGroup.findFirst({ where: { id: input.groupId, roomId } })))
        fail(404, '章节不存在');
      const changed = await db.presentationAsset.updateMany({
        where: { id, roomId },
        data: { ...input, tags: input.tags as Prisma.InputJsonValue | undefined },
      });
      if (!changed.count) fail(404, '素材不存在');
      const asset = await db.presentationAsset.findUniqueOrThrow({ where: { id } });
      res.json(publicAsset(asset, true));
    }),
  );
  app.delete(
    `${root}/assets/:assetId`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        id = String(req.params.assetId);
      await gm(roomId, req.user!.id);
      const asset = await db.presentationAsset.findFirst({ where: { id, roomId } });
      if (!asset) return fail(404, '素材不存在');
      const cues = await db.presentationCue.count({ where: { assetId: id, roomId } }),
        session = await db.presentationSession.findUnique({ where: { roomId } }),
        active = session?.activeAssetId === id;
      if ((cues || active) && req.body?.confirm !== true)
        fail(
          409,
          `这张图片${active ? '正在放映；' : ''}${cues ? `被 ${cues} 个演出条目引用；` : ''}确认后将结束该画面并删除关联条目`,
        );
      await db.$transaction(async (tx) => {
        if (active)
          await tx.presentationSession.update({
            where: { roomId },
            data: { status: 'idle', activeAssetId: null, activeCueId: null, revision: { increment: 1 } },
          });
        await tx.presentationAsset.delete({ where: { id } });
      });
      for (const name of [asset.storageName, asset.screenName, asset.thumbName])
        await unlink(join(mediaDir(roomId), name)).catch(() => {});
      if (active) notify(roomId, (session?.revision || 0) + 1);
      res.json({ ok: true, removedCues: cues, endedPresentation: active });
    }),
  );
  const commandSchema = z.object({
    id: z.string().uuid(),
    version: z.number().int().min(0),
    type: z.enum(['play', 'blackout', 'unblackout', 'end']),
    assetId: z.string().optional(),
    cueId: z.string().optional(),
    transition: transitionSchema.default('none'),
    requestedMode: z.enum(['floating', 'cinematic']).default('floating'),
    allowHistory: z.boolean().default(false),
    usePreparedSettings: z.boolean().default(false),
    audio: sceneAudioSchema.optional(),
    audioVersion: z.number().int().min(0).optional(),
  });
  app.post(
    `${root}/commands`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        userId = req.user!.id;
      await gm(roomId, userId);
      const input = commandSchema.parse(req.body);
      const result = await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT id FROM "Room" WHERE id = ${roomId} FOR UPDATE`;
          const member = await tx.roomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
          if (member?.role !== 'GM') fail(403, '仅主持人可以控制放映');
          const previous = await tx.operationReceipt.findUnique({ where: { id: input.id } });
          if (previous) {
            if (
              previous.roomId !== roomId ||
              previous.userId !== userId ||
              (previous.result as any)?.kind !== 'presentation.command'
            )
              fail(409, '操作 ID 已被使用');
            return { payload: previous.result, duplicate: true };
          }
          const current = await tx.presentationSession.upsert({ where: { roomId }, create: { roomId }, update: {} });
          if (current.revision !== input.version) fail(409, '放映状态已变化，请刷新后重试');
          let assetId = current.activeAssetId,
            cueId = current.activeCueId,
            transition = current.transition;
          let audio = null;
          if (input.type === 'play') {
            const cue = input.cueId ? await tx.presentationCue.findFirst({ where: { id: input.cueId, roomId } }) : null;
            if (input.cueId && !cue) fail(404, '演出条目不存在');
            if (input.usePreparedSettings && cue && input.assetId && cue.assetId !== input.assetId)
              fail(409, '准备图片与场景卡片不一致，请重新选择场景');
            const asset = await tx.presentationAsset.findFirst({
              where: { roomId, id: cue?.assetId || input.assetId || '' },
            });
            if (!asset) return fail(404, '请选择有效的剧情图片');
            for (const name of [asset.screenName, asset.thumbName])
              await access(join(mediaDir(roomId), name)).catch(() => fail(409, '图片文件不可用，请重新上传'));
            assetId = asset.id;
            cueId = cue?.id || null;
            transition = input.usePreparedSettings ? input.transition : cue?.transition || input.transition;
            audio = await sceneAudioChange(
              tx,
              roomId,
              current.audio,
              current.audioRevision,
              input.audioVersion,
              input.audio ?? cue?.audioCue ?? {},
            );
            await tx.presentationAsset.update({
              where: { id: assetId },
              data: { revealedAt: new Date(), ...(input.allowHistory ? { canReplay: true } : {}) },
            });
          }
          if (input.type === 'unblackout' && !assetId) fail(409, '当前没有可以恢复的图片');
          if (input.type === 'end') {
            assetId = null;
            cueId = null;
            transition = 'none';
          }
          const updated = await tx.presentationSession.update({
            where: { roomId },
            data: {
              status:
                input.type === 'play' || input.type === 'unblackout'
                  ? 'showing'
                  : input.type === 'blackout'
                    ? 'blackout'
                    : 'idle',
              activeAssetId: assetId,
              activeCueId: cueId,
              transition,
              requestedMode: input.type === 'play' ? input.requestedMode : current.requestedMode,
              allowHistory: input.type === 'play' ? input.allowHistory : current.allowHistory,
              revision: { increment: 1 },
              updatedBy: userId,
              ...(audio ? { audio: audio as Prisma.InputJsonValue, audioRevision: { increment: 1 } } : {}),
            },
          });
          const payload = {
            kind: 'presentation.command',
            status: updated.status,
            revision: updated.revision,
            activeAssetId: updated.activeAssetId,
            audioRevision: audio ? updated.audioRevision : null,
          };
          await tx.operationReceipt.create({ data: { id: input.id, roomId, userId, result: payload } });
          return { payload, duplicate: false };
        },
        { isolationLevel: 'ReadCommitted', timeout: 10000 },
      );
      if (!result.duplicate) {
        const payload = result.payload as { revision: number; audioRevision: number | null };
        try {
          notify(roomId, payload.revision);
          if (payload.audioRevision !== null) notifyAudio(roomId, payload.audioRevision);
        } catch {
          /* Recover committed state on reconnect. */
        }
      }
      res.json(result.payload);
    }),
  );
}
