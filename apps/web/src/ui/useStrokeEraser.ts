import { useEffect, useRef, useState, type RefObject } from 'react';
import type Konva from 'konva';

type Point = { x: number; y: number };
type Gesture = { mapId: string; ids: Set<string>; last: Point };

/** Hit-test the actual rendered curves, including zoom/pan, without editing their geometry. */
export function useStrokeEraser(
  mapId: string | undefined,
  enabled: boolean,
  layer: RefObject<Konva.Layer | null>,
  stage: RefObject<Konva.Stage | null>,
  mutate: (type: string, payload: Record<string, unknown>) => Promise<unknown>,
) {
  const gesture = useRef<Gesture | null>(null),
    hidden = useRef(new Set<string>()),
    mounted = useRef(true);
  const latest = useRef({ mapId, enabled, mutate });
  latest.current = { mapId, enabled, mutate };
  const [preview, setPreview] = useState<Set<string>>(new Set());
  const publish = () => {
    if (mounted.current) setPreview(new Set(hidden.current));
  };
  function cancel() {
    if (!gesture.current) return;
    for (const id of gesture.current.ids) hidden.current.delete(id);
    gesture.current = null;
    publish();
  }
  function sample(to: Point) {
    const current = gesture.current;
    if (!current || !layer.current) return;
    const from = current.last,
      distance = Math.hypot(to.x - from.x, to.y - from.y);
    // Screen-space samples avoid skipping thin strokes during a quick mouse sweep.
    const steps = Math.max(1, Math.min(2048, Math.ceil(distance / 4)));
    let changed = false;
    for (let step = 1; step <= steps; step++) {
      const point = { x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps };
      const hit = layer.current.getIntersection(point);
      if (!hit?.hasName('map-stroke') || hidden.current.has(hit.id()) || current.ids.size >= 2000) continue;
      current.ids.add(hit.id());
      hidden.current.add(hit.id());
      changed = true;
    }
    current.last = to;
    if (changed) publish();
  }
  async function finish() {
    const current = gesture.current;
    gesture.current = null;
    if (!current?.ids.size) return;
    const ids = [...current.ids];
    try {
      await latest.current.mutate('drawing.erase', { mapId: current.mapId, ids });
    } catch {
      /* Shared mutation handler reports failure; restoring the preview makes retry possible. */
    } finally {
      for (const id of ids) hidden.current.delete(id);
      publish();
    }
  }
  useEffect(() => {
    cancel();
  }, [mapId, enabled]);
  useEffect(() => {
    mounted.current = true;
    const release = (event: MouseEvent) => {
      if (event.button === 0) void finish();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('mouseup', release);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape);
    return () => {
      mounted.current = false;
      gesture.current = null;
      window.removeEventListener('mouseup', release);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape);
    };
  }, []);
  return {
    preview,
    cancel,
    start() {
      const config = latest.current,
        point = stage.current?.getPointerPosition();
      if (!config.enabled || !config.mapId || !point) return;
      cancel();
      gesture.current = { mapId: config.mapId, ids: new Set(), last: point };
      layer.current?.drawHit();
      sample(point);
    },
    move() {
      const point = stage.current?.getPointerPosition();
      if (point) sample(point);
    },
    finish,
  };
}
