import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { clampMapToolsPosition, readMapToolsPosition, type MapToolsPosition } from './map-tools-position';

export default function MapToolsPanel({
  storageKey,
  collapsed,
  children,
}: {
  storageKey: string;
  collapsed: boolean;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MapToolsPosition | null>(() => {
    try {
      return readMapToolsPosition(localStorage.getItem(storageKey));
    } catch {
      return null;
    }
  });
  const latest = useRef(position);
  const drag = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    start: MapToolsPosition;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  function constrain(next: MapToolsPosition) {
    const element = panel.current!,
      parent = element.parentElement!;
    return clampMapToolsPosition(
      next,
      { w: parent.clientWidth, h: parent.clientHeight },
      { w: element.offsetWidth, h: element.offsetHeight },
    );
  }
  function move(next: MapToolsPosition) {
    const constrained = constrain(next);
    latest.current = constrained;
    setPosition(constrained);
  }
  function save() {
    try {
      if (latest.current) localStorage.setItem(storageKey, JSON.stringify(latest.current));
    } catch {}
  }
  useLayoutEffect(() => {
    const element = panel.current!,
      parent = element.parentElement!;
    const fit = () => {
      if (!latest.current) return;
      const next = constrain(latest.current);
      if (next.x !== latest.current.x || next.y !== latest.current.y) {
        move(next);
        save();
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    observer.observe(element);
    return () => observer.disconnect();
  }, [storageKey]);
  function begin(event: PointerEvent<HTMLDivElement>) {
    const heading = (event.target as HTMLElement).closest<HTMLButtonElement>('.board-tools-heading');
    if (!heading || event.button !== 0 || !event.isPrimary) return;
    event.stopPropagation();
    const bounds = panel.current!.getBoundingClientRect(),
      parent = panel.current!.parentElement!.getBoundingClientRect();
    suppressClick.current = false;
    drag.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      start: { x: bounds.left - parent.left, y: bounds.top - parent.top },
      moved: false,
    };
    heading.setPointerCapture(event.pointerId);
  }
  function finish(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    if (drag.current.moved) {
      event.stopPropagation();
      suppressClick.current = true;
      save();
    }
    drag.current = null;
    setDragging(false);
  }
  return (
    <div
      ref={panel}
      className={`board-tools ${collapsed ? 'collapsed' : ''} ${dragging ? 'dragging' : ''}`}
      style={position ? { left: position.x, top: position.y, bottom: 'auto' } : undefined}
      onPointerDown={begin}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const dx = event.clientX - current.clientX,
          dy = event.clientY - current.clientY;
        if (!current.moved && Math.hypot(dx, dy) < 4) return;
        current.moved = true;
        event.preventDefault();
        event.stopPropagation();
        setDragging(true);
        move({ x: current.start.x + dx, y: current.start.y + dy });
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onClickCapture={(event) => {
        if (event.detail > 0 && suppressClick.current) {
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {children}
    </div>
  );
}
