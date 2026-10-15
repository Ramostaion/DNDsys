import type express from 'express';
import multer from 'multer';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canControlCharacter } from '@dnd/shared';
import { object } from '../data.js';
import { memberCan } from '../permissions.js';
import { MAX_UPLOAD_BYTES, sanitizeImage, uploadDir } from '../upload.js';
import { asyncRoute, fail } from '../http.js';
import type { RouteContext } from './context.js';

export function registerUploadRoutes(app: express.Express, context: RouteContext) {
  const { db, auth, member, emit } = context;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  app.get(
    '/uploads/:roomId/:scope/:filename',
    auth,
    asyncRoute(async (req, res) => {
      const roomId = String(req.params.roomId),
        scope = String(req.params.scope),
        filename = String(req.params.filename);
      if (
        !/^[a-z0-9]+$/i.test(roomId) ||
        !['public', 'private'].includes(scope) ||
        !/^[0-9a-f-]{36}\.webp$/.test(filename)
      )
        fail(404, '图片不存在');
      const m = await member(roomId, req.user!.id);
      if (scope === 'private' && m.role !== 'GM') fail(403, '没有查看私密图片的权限');
      res
        .set('X-Content-Type-Options', 'nosniff')
        .set('Cache-Control', 'private, no-store')
        .type('image/webp')
        .sendFile(join(uploadDir, roomId, scope, filename));
    }),
  );
  app.get(
    '/uploads/:roomId/characters/:characterId/:filename',
    auth,
    asyncRoute(async (req, res) => {
      const roomId = String(req.params.roomId),
        characterId = String(req.params.characterId),
        filename = String(req.params.filename);
      if (!/^[a-z0-9]+$/i.test(roomId) || !/^[a-z0-9]+$/i.test(characterId) || !/^[0-9a-f-]{36}\.webp$/.test(filename))
        fail(404, '头像不存在');
      const m = await member(roomId, req.user!.id),
        c = await db.character.findFirst({ where: { id: characterId, roomId } });
      if (!c || c.avatarUrl !== `/uploads/${roomId}/characters/${characterId}/${filename}`) fail(404, '头像不存在');
      if (c!.visibility === 'GM' && m.role !== 'GM') fail(403, '没有查看该头像的权限');
      res
        .set('Cache-Control', 'private, no-store')
        .type('image/webp')
        .sendFile(join(uploadDir, roomId, 'characters', characterId, filename));
    }),
  );
  // Existing upload URLs remain readable only when they are referenced by a room the viewer belongs to.
  app.get(
    '/uploads/:filename',
    auth,
    asyncRoute(async (req, res) => {
      const filename = String(req.params.filename);
      if (!/^[0-9a-f-]{36}\.(?:png|jpe?g|webp|gif)$/i.test(filename)) fail(404, '图片不存在');
      const url = `/uploads/${filename}`;
      const matches = await Promise.all([
        db.map.findMany({ where: { imageUrl: url }, select: { roomId: true, visibility: true } }),
        db.itemDefinition.findMany({ where: { imageUrl: url }, select: { roomId: true } }),
        db.template.findMany({ where: { iconUrl: url }, select: { roomId: true } }),
        db.character.findMany({ where: { avatarUrl: url }, select: { roomId: true, visibility: true } }),
      ]);
      const references = [
        ...matches[0].map((item) => ({ roomId: item.roomId, visibility: item.visibility })),
        ...matches[1].map((item) => ({ roomId: item.roomId, visibility: 'PUBLIC' })),
        ...matches[2].map((item) => ({ roomId: item.roomId, visibility: 'PUBLIC' })),
        ...matches[3].map((item) => ({ roomId: item.roomId, visibility: item.visibility })),
      ];
      const memberships = await db.roomMember.findMany({
        where: { roomId: { in: [...new Set(references.map((item) => item.roomId))] }, userId: req.user!.id },
        select: { roomId: true, role: true },
      });
      if (
        !references.some((reference) =>
          memberships.some((m) => m.roomId === reference.roomId && (m.role === 'GM' || reference.visibility !== 'GM')),
        )
      )
        fail(404, '图片不存在');
      res
        .set('X-Content-Type-Options', 'nosniff')
        .set('Cache-Control', 'private, no-store')
        .sendFile(join(uploadDir, filename));
    }),
  );
  app.post(
    '/api/rooms/:roomId/upload',
    auth,
    asyncRoute(async (req, _res, next) => {
      const m = await member(String(req.params.roomId), req.user!.id),
        room = await db.room.findUniqueOrThrow({ where: { id: String(req.params.roomId) } });
      if (m.role !== 'GM' && object(m.permissions).upload !== true && !memberCan(room, m, 'publicItems'))
        fail(403, '没有上传权限');
      next();
    }),
    upload.single('file'),
    asyncRoute(async (req, res) => {
      if (!req.file) fail(400, '请选择 JPEG、PNG 或 WebP 图片（不超过 10MB）');
      let image;
      try {
        image = await sanitizeImage(req.file!.buffer, req.file!.mimetype, req.file!.originalname);
      } catch (e) {
        fail(400, (e as Error).message);
      }
      const roomId = String(req.params.roomId),
        scope = req.body.visibility === 'PRIVATE' ? 'private' : 'public',
        filename = `${randomUUID()}.webp`;
      if (scope === 'private' && (await member(roomId, req.user!.id)).role !== 'GM') fail(403, '仅 GM 可上传私密图片');
      const directory = join(uploadDir, roomId, scope);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, filename), image!.bytes, { flag: 'wx' });
      res
        .status(201)
        .json({ url: `/uploads/${roomId}/${scope}/${filename}`, width: image!.width, height: image!.height });
    }),
  );

  app.post(
    '/api/rooms/:roomId/characters/:characterId/avatar',
    auth,
    asyncRoute(async (req, _res, next) => {
      const roomId = String(req.params.roomId),
        m = await member(roomId, req.user!.id);
      const c = await db.character.findFirst({ where: { id: String(req.params.characterId), roomId } });
      if (!c) fail(404, '角色不存在');
      if (
        !canControlCharacter(m, c!, req.user!.id) ||
        !memberCan(await db.room.findUniqueOrThrow({ where: { id: roomId } }), m, 'characterBasics')
      )
        fail(403, 'GM 尚未授权修改该角色的基础信息');
      next();
    }),
    upload.single('file'),
    asyncRoute(async (req, res) => {
      const roomId = String(req.params.roomId),
        m = await member(roomId, req.user!.id);
      const c = await db.character.findFirst({ where: { id: String(req.params.characterId), roomId } });
      if (!c) fail(404, '角色不存在');
      if (
        !canControlCharacter(m, c!, req.user!.id) ||
        !memberCan(await db.room.findUniqueOrThrow({ where: { id: roomId } }), m, 'characterBasics')
      )
        fail(403, 'GM 尚未授权修改该角色的基础信息');
      if (!req.file) fail(400, '请选择 JPEG、PNG 或 WebP 头像（不超过 10MB）');
      const expectedVersion = z.coerce.number().int().min(0).parse(req.body.version);
      if (c!.version !== expectedVersion) fail(409, '角色已被修改，请刷新后重新上传');
      let image;
      try {
        image = await sanitizeImage(req.file!.buffer, req.file!.mimetype, req.file!.originalname);
      } catch (e) {
        fail(400, (e as Error).message);
      }
      const filename = `${randomUUID()}.webp`,
        directory = join(uploadDir, roomId, 'characters', c!.id);
      await mkdir(directory, { recursive: true });
      const path = join(directory, filename),
        avatarUrl = `/uploads/${roomId}/characters/${c!.id}/${filename}`;
      await writeFile(path, image!.bytes, { flag: 'wx' });
      try {
        const changed = await db.character.updateMany({
          where: { id: c!.id, version: expectedVersion },
          data: { avatarUrl, version: { increment: 1 } },
        });
        if (!changed.count) fail(409, '角色已被修改，请刷新后重新上传');
      } catch (error) {
        await unlink(path).catch(() => {});
        throw error;
      }
      emit(roomId, 'character.avatar.updated', { characterId: c!.id });
      res.json({ avatarUrl, version: expectedVersion + 1 });
    }),
  );
}
