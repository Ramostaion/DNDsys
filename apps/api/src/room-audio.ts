import type express from 'express';
import type { PrismaClient } from '@prisma/client';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink, access } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { z } from 'zod';
import { emptyRoomAudio, roomAudioPosition, type RoomAudioState } from '@dnd/shared';
import { uploadDir } from './storage.js';
import { createRoomAccess, requireGM } from './access.js';
import { asyncRoute as wrap, fail } from './http.js';
import { json } from './operations/helpers.js';

const directory = (roomId: string) => join(uploadDir, roomId, 'audio');
const audioState = (value: unknown): RoomAudioState => ({ ...emptyRoomAudio(), ...(value as Partial<RoomAudioState>) });
const publicTrack = (track: { id: string; roomId: string; title: string; duration: number | null; bytes: number }) => ({
  id: track.id,
  title: track.title,
  duration: track.duration,
  bytes: track.bytes,
  url: `/api/rooms/${track.roomId}/presentation/audio/tracks/${track.id}/file`,
});

export function detectAudioMime(header: Buffer, filename: string) {
  const extension = extname(filename).toLowerCase();
  if (
    extension === '.mp3' &&
    (header.subarray(0, 3).toString() === 'ID3' || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0))
  )
    return 'audio/mpeg';
  if (
    extension === '.wav' &&
    header.subarray(0, 4).toString() === 'RIFF' &&
    header.subarray(8, 12).toString() === 'WAVE'
  )
    return 'audio/wav';
  if (extension === '.ogg' && header.subarray(0, 4).toString() === 'OggS') return 'audio/ogg';
  if (extension === '.m4a' && header.subarray(4, 8).toString() === 'ftyp') return 'audio/mp4';
  if (extension === '.webm' && header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'audio/webm';
  return fail(400, '音频格式无效，请使用 MP3、WAV、OGG、M4A 或 WebM 音频');
}

export function registerRoomAudio(
  app: express.Express,
  db: PrismaClient,
  auth: express.RequestHandler,
  publish: (roomId: string, revision?: number, library?: boolean) => void,
) {
  // A failed notification never rolls back saved audio or deletes a committed file.
  const notify = (roomId: string, revision?: number, library?: boolean) => {
    try {
      publish(roomId, revision, library);
    } catch {
      /* Reconnect/focus recovers from persisted state. */
    }
  };
  const root = '/api/rooms/:roomId/presentation/audio',
    member = createRoomAccess(db);
  const gm: express.RequestHandler = wrap(async (req, _res, next) => {
    requireGM(await member(String(req.params.roomId), req.user!.id));
    next();
  });
  const upload = multer({
    limits: { fileSize: 100 * 1024 * 1024, files: 1 },
    storage: multer.diskStorage({
      destination(req, _file, done) {
        const dir = directory(String(req.params.roomId));
        void mkdir(dir, { recursive: true }).then(
          () => done(null, dir),
          (error: Error) => done(error, ''),
        );
      },
      filename(_req, _file, done) {
        done(null, `${randomUUID()}.part`);
      },
    }),
  }).single('file');
  const receive: express.RequestHandler = (req, res, next) =>
    upload(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError)
        return next(
          Object.assign(new Error(error.code === 'LIMIT_FILE_SIZE' ? '音频不能超过 100MB' : '音频上传失败'), {
            status: error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
          }),
        );
      next(error);
    });
  async function current(roomId: string) {
    const session = await db.presentationSession.findUnique({ where: { roomId } });
    const state = audioState(session?.audio);
    const track = state.trackId ? await db.roomAudioTrack.findFirst({ where: { id: state.trackId, roomId } }) : null;
    const now = Date.now();
    if (!track) return { ...emptyRoomAudio(), revision: session?.audioRevision ?? 0, track: null, serverNow: now };
    if (state.status === 'playing' && !state.loop && track.duration && roomAudioPosition(state, now) >= track.duration)
      Object.assign(state, { status: 'stopped', position: track.duration, startedAt: null });
    return { ...state, revision: session?.audioRevision ?? 0, track: publicTrack(track), serverNow: now };
  }
  app.get(
    `${root}/current`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId);
      await member(roomId, req.user!.id);
      res.set('Cache-Control', 'no-store').json(await current(roomId));
    }),
  );
  app.get(
    `${root}/tracks`,
    auth,
    gm,
    wrap(async (req, res) => {
      const rows = await db.roomAudioTrack.findMany({
        where: { roomId: String(req.params.roomId) },
        orderBy: { createdAt: 'desc' },
      });
      res.json(rows.map(publicTrack));
    }),
  );
  app.post(
    `${root}/tracks`,
    auth,
    gm,
    receive,
    wrap(async (req, res) => {
      if (!req.file) fail(400, '请选择音频文件');
      const file = req.file!;
      let finalPath = file.path;
      try {
        const title = z
          .string()
          .trim()
          .min(1)
          .max(100)
          .parse(req.body.title || file.originalname.replace(/\.[^.]+$/, '').slice(0, 100));
        const duration = req.body.duration
          ? z.coerce.number().finite().positive().max(86400).parse(req.body.duration)
          : null;
        const handle = await open(file.path, 'r');
        const header = Buffer.alloc(32);
        try {
          await handle.read(header, 0, header.length, 0);
        } finally {
          await handle.close();
        }
        const mimeType = detectAudioMime(header, file.originalname);
        const storageName = `${randomUUID()}${extname(file.originalname).toLowerCase()}`;
        finalPath = join(directory(String(req.params.roomId)), storageName);
        await rename(file.path, finalPath);
        const track = await db.roomAudioTrack.create({
          data: { roomId: String(req.params.roomId), title, duration, mimeType, storageName, bytes: file.size },
        });
        notify(track.roomId, undefined, true);
        res.status(201).json(publicTrack(track));
      } catch (error) {
        await unlink(finalPath).catch(() => {});
        throw error;
      }
    }),
  );
  app.get(
    `${root}/tracks/:id/file`,
    auth,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        m = await member(roomId, req.user!.id);
      const track = await db.roomAudioTrack.findFirst({ where: { roomId, id: String(req.params.id) } });
      if (!track) fail(404, '音频不存在');
      const state = m.role === 'GM' ? null : await current(roomId);
      if (m.role !== 'GM' && state?.trackId !== track!.id) fail(403, '这首背景音尚未播放');
      const file = join(directory(roomId), track!.storageName);
      await access(file).catch(() => fail(404, '音频文件暂时不可用，请让 GM 重新上传'));
      res
        .set('Cache-Control', 'private, max-age=300')
        .set('X-Content-Type-Options', 'nosniff')
        .type(track!.mimeType)
        .sendFile(file);
    }),
  );
  app.patch(
    `${root}/tracks/:id`,
    auth,
    gm,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId);
      const input = z
        .object({
          title: z.string().trim().min(1).max(100).optional(),
          duration: z.number().finite().positive().max(86400).optional(),
        })
        .refine((value) => value.title !== undefined || value.duration !== undefined, '没有可更新的音频信息')
        .parse(req.body);
      const updated = await db.roomAudioTrack.updateMany({
        where: { id: String(req.params.id), roomId },
        data: input,
      });
      if (!updated.count) fail(404, '音频不存在');
      notify(roomId, undefined, true);
      res.json({ ok: true });
    }),
  );
  app.delete(
    `${root}/tracks/:id`,
    auth,
    gm,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId);
      const result = await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT id FROM "Room" WHERE id = ${roomId} FOR UPDATE`;
          const track = await tx.roomAudioTrack.findFirst({ where: { id: String(req.params.id), roomId } });
          if (!track) fail(404, '音频不存在');
          const session = await tx.presentationSession.findUnique({ where: { roomId } });
          if (audioState(session?.audio).trackId === track!.id)
            await tx.presentationSession.update({
              where: { roomId },
              data: { audio: json(emptyRoomAudio()), audioRevision: { increment: 1 } },
            });
          await tx.roomAudioTrack.delete({ where: { id: track!.id } });
          return track!;
        },
        { isolationLevel: 'ReadCommitted' },
      );
      await unlink(join(directory(roomId), result.storageName)).catch(() => {});
      notify(roomId, undefined, true);
      res.json(await current(roomId));
    }),
  );
  app.post(
    `${root}/commands`,
    auth,
    gm,
    wrap(async (req, res) => {
      const roomId = String(req.params.roomId),
        userId = req.user!.id;
      const input = z
        .object({
          id: z.string().uuid(),
          version: z.number().int().nonnegative(),
          type: z.enum(['play', 'pause', 'resume', 'stop', 'seek', 'settings']),
          trackId: z.string().optional(),
          position: z.number().finite().min(0).max(86400).optional(),
          loop: z.boolean().optional(),
          volume: z.number().finite().min(0).max(1).optional(),
          fadeMs: z.union([z.literal(0), z.literal(1000)]).default(0),
        })
        .parse(req.body);
      const result = await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT id FROM "Room" WHERE id = ${roomId} FOR UPDATE`;
          const receipt = await tx.operationReceipt.findUnique({ where: { id: input.id } });
          if (receipt) {
            if (
              receipt.userId !== userId ||
              receipt.roomId !== roomId ||
              (receipt.result as { kind?: string })?.kind !== 'room.audio'
            )
              fail(409, '操作 ID 冲突');
            return { duplicate: true };
          }
          const session = await tx.presentationSession.upsert({ where: { roomId }, create: { roomId }, update: {} });
          if (session.audioRevision !== input.version) fail(409, '背景音状态已变化，已同步最新状态，请重试');
          const state = audioState(session.audio),
            now = Date.now();
          const trackId = input.type === 'play' ? input.trackId : state.trackId;
          const track = trackId ? await tx.roomAudioTrack.findFirst({ where: { id: trackId, roomId } }) : null;
          if (input.type !== 'stop' && !track) fail(400, '请先选择音频');
          let position = roomAudioPosition(state, now, track?.duration);
          if (input.type === 'play') {
            state.trackId = track!.id;
            state.status = 'playing';
            position = input.position ?? 0;
          }
          if (input.type === 'resume') {
            state.status = 'playing';
            if (!state.loop && track?.duration && position >= track.duration) position = 0;
          }
          if (input.type === 'pause') state.status = 'paused';
          if (input.type === 'stop') {
            state.status = 'stopped';
            position = 0;
          }
          if (input.type === 'seek') {
            if (input.position === undefined) fail(400, '请选择播放位置');
            position = input.position!;
          }
          if (track?.duration) position = Math.min(position, track.duration);
          state.position = position;
          state.startedAt = state.status === 'playing' ? now : null;
          if (input.loop !== undefined) state.loop = input.loop;
          if (input.volume !== undefined) state.volume = input.volume;
          state.fadeMs = ['play', 'pause', 'resume', 'stop'].includes(input.type) ? input.fadeMs : 0;
          state.changedAt = now;
          const updated = await tx.presentationSession.update({
            where: { roomId },
            data: { audio: json(state), audioRevision: { increment: 1 } },
          });
          await tx.operationReceipt.create({
            data: { id: input.id, roomId, userId, result: { kind: 'room.audio', revision: updated.audioRevision } },
          });
          await tx.activityLog.create({
            data: {
              roomId,
              userId,
              action: `audio.${input.type}`,
              entityId: state.trackId,
              data: { title: track?.title || '', operationId: input.id },
            },
          });
          return { duplicate: false };
        },
        { isolationLevel: 'ReadCommitted', timeout: 10000 },
      );
      const updated = await current(roomId);
      if (!result.duplicate) notify(roomId, updated.revision);
      res.json(updated);
    }),
  );
}
