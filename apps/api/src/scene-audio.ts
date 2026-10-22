import { z } from 'zod';
import { emptyRoomAudio } from '@dnd/shared';
import type { Prisma } from '@prisma/client';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { uploadDir } from './storage.js';
import { fail } from './http.js';
export const sceneAudioSchema = z.object({
  mode: z.enum(['continue', 'play', 'stop']).default('continue'),
  trackId: z.string().min(1).optional(),
  fadeMs: z.union([z.literal(0), z.literal(1000)]).default(1000),
});
export async function validateSceneAudio(
  tx: Prisma.TransactionClient,
  roomId: string,
  cue: z.infer<typeof sceneAudioSchema>,
) {
  if (cue.mode !== 'play') return null;
  const track = await tx.roomAudioTrack.findFirst({ where: { id: cue.trackId ?? '', roomId } });
  if (!track) fail(409, '场景配乐不存在或已删除，请重新选择');
  return track!;
}
export async function sceneAudioChange(
  tx: Prisma.TransactionClient,
  roomId: string,
  stored: unknown,
  audioVersion: number,
  expected: number | undefined,
  input: unknown,
) {
  const cue = sceneAudioSchema.parse(input);
  if (cue.mode === 'continue') return null;
  if (expected !== undefined && expected !== audioVersion) fail(409, '背景音已被其他 GM 修改，请同步后重新发布场景');
  const track = await validateSceneAudio(tx, roomId, cue);
  if (track)
    await access(join(uploadDir, roomId, 'audio', track.storageName)).catch(() =>
      fail(409, '场景配乐文件不可用，请重新上传'),
    );
  const now = Date.now();
  return {
    ...emptyRoomAudio(),
    ...(stored as object),
    trackId: track?.id ?? null,
    status: cue.mode === 'play' ? ('playing' as const) : ('stopped' as const),
    position: 0,
    startedAt: cue.mode === 'play' ? now : null,
    fadeMs: cue.fadeMs,
    changedAt: now,
  };
}
