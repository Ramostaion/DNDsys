import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { PublicDiceEvent, CombatBroadcast, TokenMoveEvent } from '@dnd/shared';
import { notifyCombatDrafts } from '../ui/combat/useCombatDraft';

type Options = {
  roomId: string | undefined;
  userId: string;
  refresh: () => unknown;
  refreshPresentation: () => unknown;
  presentationChanged: (revision: number) => void;
  refreshClues: (notify?: boolean) => unknown;
  onKicked: () => void;
  onDeleted: () => void;
  onError: (message: string) => void;
  diceChanged: (event: PublicDiceEvent) => void;
  combatChanged: (event: CombatBroadcast) => void;
  tokenMoved: (event: TokenMoveEvent) => void;
  resetMovements: () => void;
};

/** Keep one connection per room/account; UI callback changes do not reconnect the table. */
export function useRoomConnection(options: Options) {
  const callbacks = useRef(options);
  callbacks.current = options;
  const [online, setOnline] = useState<Set<string>>(new Set()),
    [connected, setConnected] = useState(false);
  const { roomId, userId } = options;
  useEffect(() => {
    if (!roomId) return;
    let active = true,
      reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const socket = io({ withCredentials: true, autoConnect: navigator.onLine });
    setOnline(new Set());
    setConnected(false);
    const refreshAll = () => {
      void callbacks.current.refresh();
      void callbacks.current.refreshPresentation();
      void callbacks.current.refreshClues();
      notifyCombatDrafts(roomId, true);
    };
    const offline = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket.disconnect();
      setConnected(false);
      setOnline(new Set());
    };
    const reconnect = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket.connect();
    };
    const recover = () => {
      if (active && navigator.onLine) {
        void callbacks.current.refresh();
        void callbacks.current.refreshPresentation();
      }
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', reconnect);
    window.addEventListener('focus', recover);
    socket.on('connect', () => {
      socket
        .timeout(10_000)
        .emit('room:join', roomId, (error: Error | null, reply: { error?: string; onlineUserIds?: string[] }) => {
          if (!active) return;
          if (error || reply?.error) {
            setConnected(false);
            callbacks.current.onError(reply?.error || '联机暂时不可用，正在重试');
            socket.disconnect();
            if (navigator.onLine) reconnectTimer = setTimeout(reconnect, 3000);
            return;
          }
          setConnected(true);
          setOnline(new Set(reply.onlineUserIds || []));
          refreshAll();
        });
    });
    socket.on('disconnect', (reason) => {
      callbacks.current.resetMovements();
      setConnected(false);
      setOnline(new Set());
      if (reason === 'io server disconnect' && navigator.onLine) reconnectTimer = setTimeout(reconnect, 1000);
    });
    socket.on(
      'change',
      (notice: {
        event: string;
        data: PublicDiceEvent | CombatBroadcast | TokenMoveEvent | { operationId?: string; roomId?: string };
      }) => {
        if (notice.event === 'dice.roll' && 'roll' in notice.data && notice.data.roll?.visibility === 'PUBLIC')
          callbacks.current.diceChanged(notice.data);
        if (notice.event === 'combat.record' && 'recordId' in notice.data) callbacks.current.combatChanged(notice.data);
        if (notice.event === 'token.moved' && 'tokenId' in notice.data) callbacks.current.tokenMoved(notice.data);
        if (notice.event === 'member.profile') void callbacks.current.refreshClues();
        if (
          /^(tags\.changed$|character\.|sheet\.|equipment\.|inventory\.|item\.|template\.|member\.|room\.|trade\.|combat\.record$|turn\.)/.test(
            notice.event,
          )
        )
          notifyCombatDrafts(roomId);
        void callbacks.current.refresh();
      },
    );
    socket.on('presentation.changed', (event: { revision: number }) =>
      callbacks.current.presentationChanged(event.revision),
    );
    socket.on('privateClue.changed', (event: { roomId: string; kind: string }) => {
      if (event.roomId === roomId) void callbacks.current.refreshClues(event.kind === 'delivered');
    });
    socket.on('combatDraft.changed', (event: { roomId: string }) => {
      if (event.roomId === roomId) notifyCombatDrafts(roomId);
    });
    socket.on('kicked', () => callbacks.current.onKicked());
    socket.on('room:deleted', (event: { roomId: string }) => {
      if (event.roomId !== roomId) return;
      socket.disconnect();
      callbacks.current.onDeleted();
    });
    socket.on('presence', (event: { userId: string; online: boolean }) => {
      setOnline((previous) => {
        const next = new Set(previous);
        if (event.online) next.add(event.userId);
        else next.delete(event.userId);
        return next;
      });
    });
    // Recover missed notifications on a small table without adding queues or extra services.
    const timer = setInterval(recover, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', reconnect);
      window.removeEventListener('focus', recover);
      socket.emit('room:leave', roomId);
      socket.disconnect();
    };
  }, [roomId, userId]);
  return { online, connected };
}
