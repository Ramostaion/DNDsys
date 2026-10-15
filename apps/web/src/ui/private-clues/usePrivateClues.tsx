import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { request } from '../../api';

export type Attachment = {
  id: string;
  filename: string;
  sizeBytes: number;
  thumbUrl: string;
  originalUrl: string;
  previouslyPublic?: boolean;
};
export type Clue = {
  id: string;
  title: string;
  senderName: string;
  sharedByName: string | null;
  createdAt: string;
  revokedAt: string | null;
  characterLabel: string;
  allowForward: boolean;
  attachments: Attachment[];
  bodyMarkdown?: string;
  gmNote?: string;
  clueId?: string;
  readAt?: string | null;
  savedAt?: string | null;
  recipientCount?: number;
  readCount?: number;
  isForwarded?: boolean;
  deliveries?: {
    id: string;
    recipientUserId: string;
    recipientName: string;
    readAt: string | null;
    createdAt: string;
  }[];
};
export const cluePath = (roomId: string) => `/rooms/${roomId}/private-clues`;
export function usePrivateClues(roomId: string | undefined, userId: string) {
  const key = `${roomId}:${userId}`,
    activeKey = useRef(key),
    [scope, setScope] = useState(key);
  activeKey.current = key;
  const [items, setItems] = useState<Clue[]>([]),
    [unreadCount, setUnread] = useState(0),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [revision, setRevision] = useState(0);
  const [assetRequest, selectAsset] = useState<string | null>(null);
  const serial = useRef(0),
    controller = useRef<AbortController | null>(null),
    known = useRef<Set<string> | null>(null),
    shouldNotify = useRef(false);
  const refresh = useCallback(
    async (notify = false) => {
      if (!roomId) return;
      shouldNotify.current ||= notify;
      const seq = ++serial.current;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      try {
        const data = await request<{ items: Clue[]; unreadCount: number }>(`${cluePath(roomId)}/inbox`, {
          signal: abort.signal,
        });
        if (seq !== serial.current || activeKey.current !== key) return;
        const added = known.current ? data.items.filter((item) => !known.current!.has(item.id) && !item.revokedAt) : [];
        if (shouldNotify.current && added.length) setNotice(`收到 ${added.length} 条私密线索，可稍后从收件箱查看。`);
        shouldNotify.current = false;
        known.current = new Set(data.items.map((item) => item.id));
        setItems(data.items);
        setUnread(data.unreadCount);
        setError('');
        setRevision((old) => old + 1);
      } catch (e) {
        if (seq === serial.current && activeKey.current === key && !abort.signal.aborted)
          setError((e as Error).message);
      }
    },
    [roomId, userId],
  );
  useEffect(() => {
    known.current = null;
    setScope(key);
    setItems([]);
    setUnread(0);
    setNotice('');
    setError('');
    selectAsset(null);
    void refresh();
    const recover = () => {
      if (navigator.onLine) void refresh();
    };
    window.addEventListener('focus', recover);
    window.addEventListener('online', recover);
    const timer = setInterval(recover, 30000);
    return () => {
      serial.current++;
      controller.current?.abort();
      clearInterval(timer);
      window.removeEventListener('focus', recover);
      window.removeEventListener('online', recover);
    };
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  return {
    items: scope === key ? items : [],
    unreadCount: scope === key ? unreadCount : 0,
    error: scope === key ? error : '',
    notice: scope === key ? notice : '',
    revision,
    refresh,
    assetRequest: scope === key ? assetRequest : null,
    selectAsset,
    dismiss: () => setNotice(''),
  };
}
type State = ReturnType<typeof usePrivateClues>;
export const PrivateClueContext = createContext<State | null>(null);
export function useClueState() {
  const state = useContext(PrivateClueContext);
  if (!state) throw new Error('PrivateClueContext missing');
  return state;
}
