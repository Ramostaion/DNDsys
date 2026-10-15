import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { DiceClock, PublicDiceEvent } from '@dnd/shared';
import type { Snapshot } from '../../api';

export type LocalDiceClock = DiceClock & { receivedAt: number };
export type DiceCue = PublicDiceEvent & { receivedAt: number };
export function remainingDiceMs(clock: LocalDiceClock | null, now: number): number {
  return clock ? Math.max(0, clock.cooldownUntil - clock.serverNow - (now - clock.receivedAt)) : 0;
}
export const RoomDiceContext = createContext<{
  clock: LocalDiceClock | null;
  updateClock: (clock: DiceClock) => void;
}>({ clock: null, updateClock: () => {} });

export function useRoomDice(roomId: string | undefined, snapshot: Snapshot | undefined) {
  const [clock, setClock] = useState<LocalDiceClock | null>(null);
  const [cue, setCue] = useState<DiceCue | null>(null);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    seen.current.clear();
    setClock(null);
    setCue(null);
  }, [roomId]);
  const updateClock = useCallback((next: DiceClock) => {
    if (!Number.isFinite(next.serverNow) || !Number.isFinite(next.cooldownUntil)) return;
    const receivedAt = performance.now();
    setClock((previous) => {
      if (previous && (next.cooldownUntil < previous.cooldownUntil || next.serverNow < previous.serverNow))
        return previous;
      return { ...next, receivedAt };
    });
  }, []);
  const receive = useCallback(
    (event: PublicDiceEvent) => {
      if (event.roomId !== roomId || event.roll?.visibility !== 'PUBLIC') return;
      updateClock(event);
      if (seen.current.has(event.roll.id)) return;
      seen.current.add(event.roll.id);
      if (seen.current.size > 128) seen.current.delete(seen.current.values().next().value!);
      if (event.serverNow - new Date(event.roll.createdAt).getTime() > 4800) return;
      setCue({ ...event, receivedAt: performance.now() });
    },
    [roomId, updateClock],
  );
  useEffect(() => {
    // Snapshots recover cooldown/history, never replay old animations.
    if (snapshot && snapshot.room.id === roomId && snapshot.diceState) updateClock(snapshot.diceState);
  }, [snapshot, roomId, updateClock]);
  return { clock, cue, receive, updateClock };
}

/** Only dice controls tick; the map and editors do not re-render every 100 ms. */
export function useDiceCountdown() {
  const { clock, updateClock } = useContext(RoomDiceContext);
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    setNow(performance.now());
    if (!clock || !remainingDiceMs(clock, performance.now())) return;
    const timer = setInterval(() => {
      const current = performance.now();
      setNow(current);
      if (!remainingDiceMs(clock, current)) clearInterval(timer);
    }, 100);
    return () => clearInterval(timer);
  }, [clock]);
  return { remainingMs: remainingDiceMs(clock, Math.max(now, clock?.receivedAt || 0)), updateClock };
}
