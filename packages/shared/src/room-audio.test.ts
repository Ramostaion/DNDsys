import { describe, expect, it } from 'vitest';
import { emptyRoomAudio, roomAudioPosition } from './room-audio.js';

describe('房间背景音的服务端时钟', () => {
  it('播放累计时间，暂停和停止不会继续推进', () => {
    const state = { ...emptyRoomAudio(), status: 'playing' as const, position: 8, startedAt: 10000 };
    expect(roomAudioPosition(state, 12500)).toBe(10.5);
    expect(roomAudioPosition({ ...state, status: 'paused' }, 99999)).toBe(8);
    expect(roomAudioPosition({ ...state, status: 'stopped', position: 0 }, 99999)).toBe(0);
  });
  it('循环取余，单次播放到结尾，未知长度仍可恢复进度', () => {
    const state = { ...emptyRoomAudio(), status: 'playing' as const, position: 7, startedAt: 10000 };
    expect(roomAudioPosition(state, 15000, 10)).toBe(2);
    expect(roomAudioPosition({ ...state, loop: false }, 15000, 10)).toBe(10);
    expect(roomAudioPosition(state, 15000, null)).toBe(12);
  });
  it('尚未到起播时间时不会产生负进度', () => {
    expect(roomAudioPosition({ ...emptyRoomAudio(), status: 'playing', startedAt: 10000 }, 9000)).toBe(0);
  });
});
