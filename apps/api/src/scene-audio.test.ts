import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { emptyRoomAudio } from '@dnd/shared';
import { sceneAudioChange, sceneAudioSchema, validateSceneAudio } from './scene-audio.js';
describe('场景配乐与旧数据兼容', () => {
  it('旧条目没有绑定时继续音乐，不触碰数据库或播放时间', async () => {
    expect(sceneAudioSchema.parse({})).toEqual({ mode: 'continue', fadeMs: 1000 });
    expect(await sceneAudioChange({} as Prisma.TransactionClient, 'room', emptyRoomAudio(), 2, 0, {})).toBeNull();
  });
  it('停止场景保留原房间音量和循环偏好', async () => {
    const value = await sceneAudioChange(
      {} as Prisma.TransactionClient,
      'room',
      { ...emptyRoomAudio(), volume: 0.3, loop: false, trackId: 'old' },
      2,
      2,
      { mode: 'stop', fadeMs: 0 },
    );
    expect(value).toMatchObject({
      status: 'stopped',
      trackId: null,
      position: 0,
      volume: 0.3,
      loop: false,
      fadeMs: 0,
      startedAt: null,
    });
  });
  it('音频版本冲突先拒绝，不进行配乐查询', async () => {
    await expect(
      sceneAudioChange({} as Prisma.TransactionClient, 'room', {}, 2, 1, { mode: 'play', trackId: 'a' }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('曲目查询限定当前房间，外房间或已删除曲目被拒绝', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await expect(
      validateSceneAudio({ roomAudioTrack: { findFirst } } as unknown as Prisma.TransactionClient, 'here', {
        mode: 'play',
        trackId: 'foreign',
        fadeMs: 1000,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', roomId: 'here' } });
  });
  it('只接受明确的配乐动作和轻量过渡时长', () => {
    expect(sceneAudioSchema.safeParse({ mode: 'bad' }).success).toBe(false);
    expect(sceneAudioSchema.safeParse({ mode: 'stop', fadeMs: 60000 }).success).toBe(false);
  });
});
