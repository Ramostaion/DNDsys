import { useRef } from 'react';
import { resizeWindow, type ResizeEdge, type WindowRect } from './window-resize';
const edges: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const names: Record<ResizeEdge, string> = {
  n: '上边',
  s: '下边',
  e: '右边',
  w: '左边',
  ne: '右上角',
  nw: '左上角',
  se: '右下角',
  sw: '左下角',
};
export default function ResizeHandles({
  rect,
  onResize,
  onStart,
  minW = 340,
  minH = 240,
}: {
  rect: WindowRect;
  onResize: (rect: WindowRect) => void;
  onStart?: () => void;
  minW?: number;
  minH?: number;
}) {
  const drag = useRef<{ rect: WindowRect; x: number; y: number; edge: ResizeEdge } | null>(null);
  return (
    <>
      {edges.map((edge) => (
        <div
          key={edge}
          aria-label={`拖动${names[edge]}调整窗口大小`}
          className={`window-resize-handle resize-${edge}`}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            onStart?.();
            drag.current = { rect: { ...rect }, x: event.clientX, y: event.clientY, edge };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (start)
              onResize(
                resizeWindow(start.rect, start.edge, event.clientX - start.x, event.clientY - start.y, minW, minH),
              );
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
        />
      ))}
    </>
  );
}
