import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../../api';

export type PresentationAsset = {
  id: string;
  title: string;
  caption: string;
  gmNotes?: string;
  thumbUrl: string;
  screenUrl: string;
  originalUrl: string;
  canReplay: boolean;
  revealedAt: string | null;
  groupId?: string | null;
  sortOrder?: number;
};
export type PresentationCurrent = {
  status: 'idle' | 'showing' | 'blackout';
  revision: number;
  requestedMode: 'floating' | 'cinematic';
  allowHistory: boolean;
  transition: 'none' | 'fade' | 'black_reveal' | 'slow_zoom';
  activeCueId: string | null;
  updatedAt: string | null;
  asset: PresentationAsset | null;
};
export const presentationPath = (roomId: string) => `/rooms/${roomId}/presentation`;

export function usePresentation(roomId: string | undefined) {
  const [current, setCurrent] = useState<PresentationCurrent | null>(null),
    [error, setError] = useState(''),
    [unavailable, setUnavailable] = useState(false);
  const revision = useRef(-1),
    activeRoom = useRef(roomId);
  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      const next = await request<PresentationCurrent>(`${presentationPath(roomId)}/current`);
      if (activeRoom.current === roomId && next.revision >= revision.current) {
        revision.current = next.revision;
        setCurrent(next);
        setError('');
        setUnavailable(false);
      }
    } catch (e) {
      if (activeRoom.current === roomId) {
        setError((e as Error).message);
        setUnavailable([403, 404].includes((e as Error & { status?: number }).status || 0));
      }
    }
  }, [roomId]);
  useEffect(() => {
    activeRoom.current = roomId;
    revision.current = -1;
    setCurrent(null);
    setError('');
    setUnavailable(false);
    void refresh();
  }, [roomId, refresh]);
  const changed = useCallback(
    (seenRevision: number) => {
      if (seenRevision > revision.current) void refresh();
    },
    [refresh],
  );
  return { current, error, unavailable, refresh, changed };
}
