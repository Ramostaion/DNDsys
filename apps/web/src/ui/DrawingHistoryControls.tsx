import { useRef, useState } from 'react';
import { Undo2, Redo2 } from 'lucide-react';
import type { Snapshot } from '../api';

export default function DrawingHistoryControls({
  snap,
  userId,
  mutate,
  disabled = false,
}: {
  snap: Snapshot;
  userId: string;
  mutate: (type: string, payload: Record<string, unknown>) => Promise<unknown>;
  disabled?: boolean;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const member = snap.members.find((m) => m.userId === userId);
  const mapId = snap.room.activeMapId;
  const allowed = member?.role === 'GM' || member?.permissions?.draw === true;
  const history = snap.drawingHistory?.find((h) => h.mapId === mapId);
  async function replay(direction: 'undo' | 'redo') {
    if (pending.current || !allowed || !mapId || disabled) return;
    pending.current = true;
    setBusy(true);
    setNotice('');
    try {
      const result = (await mutate(`drawing.history.${direction}`, { mapId })) as { skipped?: number };
      if (result.skipped) setNotice('部分笔画已被他人修改，已保留其最新状态。');
    } catch {
      // The room mutation handler displays the error and reloads authoritative history.
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="mt-2">
      <div className="flex gap-2">
        <button
          className="btn flex items-center gap-1"
          disabled={disabled || busy || !allowed || !history?.canUndo}
          title="撤销自己在当前地图的上一笔绘画或擦除"
          onClick={() => void replay('undo')}
        >
          <Undo2 size={15} />
          撤销
        </button>
        <button
          className="btn flex items-center gap-1"
          disabled={disabled || busy || !allowed || !history?.canRedo}
          title="重做刚才撤销的绘画或擦除"
          onClick={() => void replay('redo')}
        >
          <Redo2 size={15} />
          重做
        </button>
      </div>
      {notice && (
        <p className="tiny subtle mt-1" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
