import type { CombatBroadcast } from '@dnd/shared';

export function acceptCombatNotice(seen: Set<string>, roomId: string | undefined, notice: CombatBroadcast) {
  if (notice.roomId !== roomId || !notice.recordId || typeof notice.hit !== 'boolean' || seen.has(notice.recordId))
    return false;
  seen.add(notice.recordId);
  if (seen.size > 128) seen.delete(seen.values().next().value!);
  const elapsed = notice.serverNow - new Date(notice.createdAt).getTime();
  return Number.isFinite(elapsed) && elapsed <= 6000;
}
