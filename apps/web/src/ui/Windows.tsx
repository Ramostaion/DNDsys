import { useRef } from 'react';
import { X } from 'lucide-react';
import { useUI, type WindowType, type WindowState } from '../store';
import ResizeHandles from './ResizeHandles';
import WindowContent from './windows/WindowContent';
import { windowTitle } from './windows/window-titles';
import type { RoomPanelProps as Props } from './room/types';
import ActionFeedback, { useActionFeedback } from './ActionFeedback';

function WindowBody({ w, p }: { w: WindowState; p: Props }) {
  const { run } = useActionFeedback();
  const mutate: Props['mutate'] = (type, payload, operationId) => {
    const action = () => p.mutate(type, payload, operationId);
    return /^(dice\.|drawing\.|combat\.)/.test(type) ? action() : run(action);
  };
  return (
    <div className="window-body scroll">
      <WindowContent w={w} p={{ ...p, mutate }} />
    </div>
  );
}

export default function Windows(p: Props) {
  const windows = useUI((s) => s.windows),
    close = useUI((s) => s.close),
    focus = useUI((s) => s.focus),
    move = useUI((s) => s.move),
    resize = useUI((s) => s.resize);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const titleFor = (type: WindowType) => windowTitle(type, p.isGM);
  const active = windows
    .filter((w) => !w.motion)
    .reduce((id, w) => (!id || w.z > id.z ? w : id), undefined as WindowState | undefined)?.id;
  return (
    <>
      {windows.map((w) => (
        <div
          key={w.id}
          className={`window surface ${w.id === active ? 'is-active' : ''} ${w.motion ? `is-${w.motion}` : ''}`}
          inert={Boolean(w.motion)}
          style={{
            left: w.x,
            top: w.y,
            width: w.w,
            height: w.h,
            zIndex: w.z,
            display: 'flex',
          }}
          onMouseDown={() => focus(w.id)}
          onDropCapture={() => focus(w.id)}
        >
          <div
            className="window-title h-11 shrink-0 bg-[#233448] flex items-center px-3 gap-2 cursor-move"
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              drag.current = { id: w.id, dx: e.clientX - w.x, dy: e.clientY - w.y };
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (drag.current?.id === w.id)
                move(w.id, Math.max(0, e.clientX - drag.current.dx), Math.max(0, e.clientY - drag.current.dy));
            }}
            onPointerUp={() => (drag.current = null)}
          >
            <span className="flex-1 font-semibold text-sm">
              {w.type === 'presentation' && !p.isGM ? '线索图库' : titleFor(w.type)}{' '}
              {w.entityId &&
                (p.snap.characters.find((c) => c.id === w.entityId)?.name ||
                  p.snap.items.find((i) => i.id === w.entityId)?.name)}
            </span>
            <button
              className="icon-button !w-7 !h-7"
              aria-label={`关闭${titleFor(w.type)}`}
              onClick={() => close(w.id)}
            >
              <X size={16} />
            </button>
          </div>
          <ActionFeedback key={`${p.snap.room.id}:${p.me.id}`}>
            <WindowBody w={w} p={p} />
          </ActionFeedback>
          <ResizeHandles
            rect={w}
            onStart={() => focus(w.id)}
            onResize={(rect) => {
              move(w.id, rect.x, rect.y);
              resize(w.id, rect.w, rect.h);
            }}
          />
        </div>
      ))}
    </>
  );
}
