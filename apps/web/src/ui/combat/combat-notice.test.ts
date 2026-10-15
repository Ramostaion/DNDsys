import { expect, it } from 'vitest';
import type { CombatBroadcast } from '@dnd/shared';
import { acceptCombatNotice } from './combat-notice';

it('战斗广播按记录去重，不接收别房间或过期历史，去重缓存有界', () => {
  const seen = new Set<string>();
  const notice = {
    roomId: 'room',
    recordId: 'first',
    hit: true,
    createdAt: '2026-10-14T10:00:00.000Z',
    serverNow: Date.parse('2026-10-14T10:00:00.001Z'),
  } as CombatBroadcast;
  expect(acceptCombatNotice(seen, 'other', notice)).toBe(false);
  expect(acceptCombatNotice(seen, 'room', notice)).toBe(true);
  expect(acceptCombatNotice(seen, 'room', notice)).toBe(false);
  expect(acceptCombatNotice(seen, 'room', { ...notice, recordId: 'past', serverNow: notice.serverNow + 10000 })).toBe(
    false,
  );
  expect(acceptCombatNotice(seen, 'room', { ...notice, recordId: 'invalid', createdAt: 'invalid' })).toBe(false);
  for (let index = 0; index < 150; index++) acceptCombatNotice(seen, 'room', { ...notice, recordId: String(index) });
  expect(seen.size).toBe(128);
});
