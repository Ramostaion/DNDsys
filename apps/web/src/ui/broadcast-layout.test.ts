import { expect, it } from 'vitest';
import { broadcastRemaining, naturalD20, recentBroadcasts, type RecentBroadcast } from './broadcast-layout';
import type { DicePart } from '@dnd/shared';

const item = (id: string, roomId = 'room', createdAt = '2026-10-17T06:00:00Z') =>
  ({
    kind: 'dice',
    cue: { roomId, receivedAt: 100, serverNow: Date.parse('2026-10-17T06:00:00Z'), roll: { id, createdAt } },
  }) as RecentBroadcast;
it('recent live broadcasts keep their original expiry and do not replay stale or foreign events', () => {
  expect(broadcastRemaining(item('one'), 100)).toBe(4800);
  expect(broadcastRemaining(item('one'), 4600)).toBe(300);
  expect(broadcastRemaining(item('one'), 5000)).toBe(0);
  expect(
    recentBroadcasts([item('one'), item('other', 'elsewhere'), item('invalid', 'room', 'bad')], 'room', 100),
  ).toHaveLength(1);
  expect(recentBroadcasts([item('one')], 'room', 5000)).toHaveLength(0);
});
it('summaries are deduplicated and capped at two, with distinct dice/combat identities', () => {
  const combat = {
    kind: 'combat',
    cue: {
      roomId: 'room',
      recordId: 'one',
      createdAt: '2026-10-17T06:00:00Z',
      serverNow: Date.parse('2026-10-17T06:00:00Z'),
      receivedAt: 100,
    },
  } as RecentBroadcast;
  expect(recentBroadcasts([item('one'), item('one'), combat], 'room', 100)).toHaveLength(2);
  expect(
    recentBroadcasts([item('one'), item('two'), item('three')], 'room', 100).map(
      (row) => row.kind === 'dice' && row.cue.roll.id,
    ),
  ).toEqual(['two', 'three']);
  expect(broadcastRemaining(combat, 6000)).toBe(100);
});
it('natural highlights describe a single positive D20 face, never totals or multi-dice rolls', () => {
  const parts = (rolls: number[], sign = 1, label = '1d20') =>
    [
      { kind: 'dice', label, rolls, sign: sign as 1 | -1, value: rolls.reduce((sum, value) => sum + value, 0) },
    ] as DicePart[];
  expect(naturalD20(parts([20]))).toBe(20);
  expect(naturalD20(parts([1]))).toBe(1);
  expect(naturalD20(parts([10, 10]))).toBeUndefined();
  expect(naturalD20(parts([20], -1))).toBeUndefined();
  expect(naturalD20(parts([20], 1, '1d100'))).toBeUndefined();
});
