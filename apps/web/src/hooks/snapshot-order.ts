import { replaceEqualDeep } from '@tanstack/react-query';
import type { Snapshot } from '../api';

/** Socket notices trigger reads, never apply a partial turn. Reject a stale full response. */
export function shareRoomSnapshot(previous: unknown, incoming: unknown): Snapshot {
  const old = previous as Snapshot | undefined,
    next = incoming as Snapshot;
  if (
    old &&
    old.room.id === next.room.id &&
    old.turnSession &&
    next.turnSession?.id === old.turnSession.id &&
    next.turnSession.version < old.turnSession.version
  )
    return old;
  // Same-version snapshots may carry permission, attribute or state changes.
  return replaceEqualDeep(old, next);
}
