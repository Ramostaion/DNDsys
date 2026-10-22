import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { RoomAudioCurrent } from '@dnd/shared';
import { request } from '../../api';

export const roomAudioPath = (roomId: string) => `/rooms/${roomId}/presentation/audio`;
export function useRoomAudio(roomId: string | undefined) {
  const [current, setCurrent] = useState<RoomAudioCurrent | null>(null),
    [error, setError] = useState(''),
    [libraryEpoch, setLibraryEpoch] = useState(0);
  const room = useRef(roomId),
    generation = useRef(0),
    revision = useRef(-1),
    clock = useRef({ serverNow: Date.now(), receivedAt: performance.now() });
  const reset = useCallback(() => {
    generation.current++;
    revision.current = -1;
    setCurrent(null);
  }, []);
  const refresh = useCallback(async () => {
    if (!roomId) return;
    const version = generation.current,
      sentAt = performance.now();
    try {
      const next = await request<RoomAudioCurrent>(`${roomAudioPath(roomId)}/current`);
      if (room.current !== roomId || version !== generation.current || next.revision < revision.current) return;
      const receivedAt = performance.now();
      revision.current = next.revision;
      clock.current = { serverNow: next.serverNow + (receivedAt - sentAt) / 2, receivedAt };
      setCurrent(next);
      setError('');
    } catch (cause) {
      if (version === generation.current) {
        setError((cause as Error).message);
        if ([403, 404].includes((cause as { status?: number }).status || 0)) reset();
      }
    }
  }, [roomId, reset]);
  useEffect(() => {
    room.current = roomId;
    reset();
    setError('');
    void refresh();
    return () => {
      generation.current++;
    };
  }, [roomId, refresh, reset]);
  const changed = useCallback(
    (notice: { revision?: number; library?: boolean }) => {
      if (notice.library) setLibraryEpoch((value) => value + 1);
      if (notice.library || notice.revision === undefined || notice.revision > revision.current) void refresh();
    },
    [refresh],
  );
  const now = useCallback(() => clock.current.serverNow + performance.now() - clock.current.receivedAt, []);
  return { current, error, libraryEpoch, refresh, changed, reset, now };
}
export const RoomAudioContext = createContext<ReturnType<typeof useRoomAudio> | null>(null);
export const useRoomAudioState = () => useContext(RoomAudioContext);
