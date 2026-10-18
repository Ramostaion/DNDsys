import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request, op, type Snapshot } from '../api';
import { shareRoomSnapshot } from './snapshot-order';

/** The map and windows share the same authoritative snapshot and mutation errors. */
export function useRoomSession(roomId: string | undefined, userId: string) {
  const [error, setError] = useState('');
  const {
    data: snap,
    isLoading,
    refetch,
    error: loadError,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['snapshot', roomId, userId],
    queryFn: ({ signal }) => request<Snapshot>(`/rooms/${roomId}/snapshot`, { signal }),
    structuralSharing: shareRoomSnapshot,
    refetchOnWindowFocus: true,
    retry: (count, cause: Error & { status?: number }) => ![403, 404].includes(cause.status || 0) && count < 3,
  });
  async function mutate(type: string, payload: Record<string, unknown>, operationId?: string) {
    try {
      setError('');
      const result = await op(roomId!, type, payload, operationId);
      await refetch();
      return result;
    } catch (e) {
      setError((e as Error).message);
      if (type === 'token.move' || ['drawing.', 'turn.', 'initiative.'].some((prefix) => type.startsWith(prefix)))
        await refetch();
      throw e;
    }
  }
  return {
    snap,
    isLoading,
    refetch,
    dataUpdatedAt,
    mutate,
    error,
    setError,
    unavailable: [403, 404].includes((loadError as Error & { status?: number })?.status || 0),
  };
}
