import { useRef } from 'react';
import { X, Minus } from 'lucide-react';
import { useUI, type WindowType } from '../store';
import ResizeHandles from './ResizeHandles';
import WindowContent from './windows/WindowContent';
import { windowTitle } from './windows/window-titles';
import type { RoomPanelProps as Props } from './room/types';

export default function Windows(p: Props) {
  const windows = useUI((s) => s.windows),
    close = useUI((s) => s.close),
    focus = useUI((s) => s.focus),
    move = useUI((s) => s.move),
    resize = useUI((s) => s.resize),
    minimize = useUI((s) => s.minimize);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const titleFor = (type: WindowType) => windowTitle(type, p.isGM);
  return (
    <>
      {windows.map((w) => (
        <div
          key={w.id}
          className="window surface"
          style={{
            left: w.x,
            top: w.y,
            width: w.w,
            height: w.minimized ? 44 : w.h,
            zIndex: w.z,
            display: w.minimized ? 'none' : 'flex',
          }}
          onMouseDown={() => focus(w.id)}
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
              aria-label={`最小化${titleFor(w.type)}`}
              onClick={() => minimize(w.id)}
            >
              <Minus size={15} />
            </button>
            <button
              className="icon-button !w-7 !h-7"
              aria-label={`关闭${titleFor(w.type)}`}
              onClick={() => close(w.id)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="window-body scroll">
            <WindowContent w={w} p={p} />
          </div>
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
