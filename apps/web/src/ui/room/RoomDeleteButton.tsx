import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { request } from '../../api';

type Result = { ok: boolean; warning?: string };
export default function RoomDeleteButton({
  room,
  userId,
  onDeleted,
}: {
  room: { id: string; name: string; ownerId: string };
  userId: string;
  onDeleted: (result: Result) => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (room.ownerId !== userId) return null;
  async function remove() {
    if (
      busy ||
      !confirm(
        `永久删除「${room.name}」？\n该房间的角色、物品、地图、剧情图片和记录将一并删除，所有成员会离开房间。此操作无法撤销。`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      const result = await request<Result>(`/rooms/${room.id}`, { method: 'DELETE' });
      queryClient.setQueryData<any[]>(['rooms'], (rooms) => rooms?.filter((item) => item.id !== room.id));
      queryClient.removeQueries({ queryKey: ['snapshot', room.id] });
      void queryClient.invalidateQueries({ queryKey: ['rooms'] });
      onDeleted(result);
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }
  return (
    <div>
      <button
        className="btn text-red-300"
        disabled={busy}
        aria-label={`删除房间：${room.name}`}
        onClick={() => void remove()}
      >
        <Trash2 size={14} className="inline mr-1" />
        {busy ? '删除中…' : '删除房间'}
      </button>
      {error && (
        <p className="text-red-300 text-sm mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
