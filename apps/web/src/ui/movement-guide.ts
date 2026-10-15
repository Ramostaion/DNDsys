import { TOKEN_RADIUS } from './ruler-snap';
type Point = { x: number; y: number };
export const MAX_MOVEMENT_ARROWS = 24;

/** Sample by arc length, so corners do not restart spacing or change arrow density. */
export function movementGuide(path: Point[], scale: number) {
  const zoom = Math.max(0.15, Math.min(5, Number.isFinite(scale) ? scale : 1));
  const vertices = path.filter(
    (p, i) =>
      Number.isFinite(p.x) && Number.isFinite(p.y) && (i === 0 || p.x !== path[i - 1].x || p.y !== path[i - 1].y),
  );
  const segments: { from: Point; to: Point; start: number; length: number }[] = [];
  let length = 0;
  for (let i = 1; i < vertices.length; i++) {
    const from = vertices[i - 1],
      to = vertices[i],
      distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (distance > 0) segments.push({ from, to, start: length, length: distance });
    length += distance;
  }
  const size = 14 / zoom,
    margin = TOKEN_RADIUS + 8 / zoom,
    available = length - margin * 2;
  const sample = (distance: number) => {
    const segment = segments.find((s) => distance < s.start + s.length - 0.00001) || segments.at(-1)!;
    const ratio = Math.max(0, Math.min(1, (distance - segment.start) / segment.length));
    return {
      x: segment.from.x + (segment.to.x - segment.from.x) * ratio,
      y: segment.from.y + (segment.to.y - segment.from.y) * ratio,
      rotation: (Math.atan2(segment.to.y - segment.from.y, segment.to.x - segment.from.x) * 180) / Math.PI,
    };
  };
  const points: number[] = [];
  const arrows: (Point & { rotation: number })[] = [];
  if (available > 0 && segments.length) {
    const first = sample(margin),
      last = sample(length - margin);
    points.push(first.x, first.y);
    for (const segment of segments)
      if (segment.start > margin && segment.start < length - margin) points.push(segment.from.x, segment.from.y);
    points.push(last.x, last.y);
    if (available >= size) {
      const count = Math.min(MAX_MOVEMENT_ARROWS, Math.max(1, Math.floor((available * zoom) / 44)));
      for (let i = 0; i < count; i++) arrows.push(sample(margin + ((i + 0.5) * available) / count));
    }
  }
  return { points, arrows, size, lineWidth: 2 / zoom, dash: [3 / zoom, 9 / zoom], glow: 4 / zoom };
}
