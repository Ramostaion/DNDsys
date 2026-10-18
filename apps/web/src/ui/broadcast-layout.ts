import type { DiceCue } from './dice/useRoomDice';
import type { CombatCue } from './combat/useCombatBroadcast';
import { rolledDice } from './dice/dice-geometry';
import type { DicePart } from '@dnd/shared';

export function naturalD20(parts: DicePart[]) {
  const dice = rolledDice(parts);
  return dice.length === 1 && dice[0].sides === 20 && dice[0].sign > 0 && [1, 20].includes(dice[0].value!)
    ? dice[0].value
    : undefined;
}

export type RecentBroadcast = { kind: 'dice'; cue: DiceCue } | { kind: 'combat'; cue: CombatCue };
export const broadcastId = (item: RecentBroadcast) =>
  item.kind === 'dice' ? `dice:${item.cue.roll.id}` : `combat:${item.cue.recordId}`;
export function broadcastRemaining(item: RecentBroadcast, now: number) {
  const created = new Date(item.kind === 'dice' ? item.cue.roll.createdAt : item.cue.createdAt).getTime();
  const age = Math.max(0, item.cue.serverNow - created) + Math.max(0, now - item.cue.receivedAt);
  return Number.isFinite(age) ? Math.max(0, (item.kind === 'dice' ? 4800 : 6000) - age) : 0;
}
export function recentBroadcasts(items: RecentBroadcast[], roomId: string, now: number) {
  const unique = new Map<string, RecentBroadcast>();
  for (const item of items)
    if (item.cue.roomId === roomId && broadcastRemaining(item, now) > 0) unique.set(broadcastId(item), item);
  return [...unique.values()].sort((a, b) => a.cue.receivedAt - b.cue.receivedAt).slice(-2);
}
