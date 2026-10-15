import { describe, expect, it, vi } from 'vitest';
import { TokenMovementChannel, motionDuration, motionFrame } from './token-motion';
import type { TokenMoveEvent } from '@dnd/shared';

const move: TokenMoveEvent = {
  eventId: 'move-one',
  roomId: 'room',
  mapId: 'map',
  tokenId: 'token',
  characterId: 'hero',
  actorId: 'gm',
  version: 2,
  from: { x: 100, y: 100 },
  to: { x: 400, y: 250 },
  completedAt: 1000,
  serverNow: 1020,
};
describe('committed token movement', () => {
  it('isolates rooms, ignores duplicate/local/stale/malformed events and does not buffer old moves', () => {
    const channel = new TokenMovementChannel('room'),
      moved = vi.fn(),
      reset = vi.fn();
    channel.receive(move);
    const off = channel.subscribe({ move: moved, reset });
    channel.receive(move);
    channel.receive({ ...move, eventId: 'other', roomId: 'other' });
    channel.receive({ ...move, eventId: 'late', serverNow: 5001 });
    channel.receive({ ...move, eventId: 'bad', to: { x: NaN, y: 0 } });
    channel.markLocal('local');
    channel.receive({ ...move, eventId: 'local' });
    expect(moved).not.toHaveBeenCalled();
    channel.receive({ ...move, eventId: 'new' });
    channel.receive({ ...move, eventId: 'new' });
    expect(moved).toHaveBeenCalledTimes(1);
    channel.reset();
    expect(reset).toHaveBeenCalledTimes(1);
    off();
    channel.receive({ ...move, eventId: 'unmounted' });
    expect(moved).toHaveBeenCalledTimes(1);
  });
  it('starts at A, smoothly travels along the actual endpoint segment and settles exactly at B', () => {
    const { from, to } = move;
    expect(motionFrame(from, to, 0)).toMatchObject({ ...from, scale: 1, done: false });
    expect(motionFrame(from, to, 100)).toMatchObject(from);
    const duration = motionDuration(Math.hypot(to.x - from.x, to.y - from.y));
    let last = from.x;
    for (let elapsed = 0; elapsed <= duration + 20; elapsed += 10) {
      const frame = motionFrame(from, to, elapsed);
      expect(frame.x).toBeGreaterThanOrEqual(last);
      expect(frame.x).toBeLessThanOrEqual(to.x);
      expect(frame.y - from.y).toBeCloseTo((frame.x - from.x) * 0.5);
      last = frame.x;
    }
    expect(motionFrame(from, to, duration)).toMatchObject({ ...to, scale: 1, landing: 1, done: true });
    expect(motionDuration(10)).toBeGreaterThanOrEqual(600);
    expect(motionDuration(100000)).toBe(800);
  });
});
