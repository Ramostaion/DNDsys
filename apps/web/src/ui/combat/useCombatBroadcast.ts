import { useCallback, useEffect, useRef, useState } from 'react';
import type { CombatBroadcast } from '@dnd/shared';
import { acceptCombatNotice } from './combat-notice';

export type CombatCue = CombatBroadcast & { receivedAt: number };
export function useCombatBroadcast(roomId: string | undefined) {
  const [cue, setCue] = useState<CombatCue | null>(null);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    seen.current.clear();
    setCue(null);
  }, [roomId]);
  const receive = useCallback(
    (notice: CombatBroadcast) => {
      if (!acceptCombatNotice(seen.current, roomId, notice)) return;
      setCue({ ...notice, receivedAt: performance.now() });
    },
    [roomId],
  );
  return { cue, receive };
}
