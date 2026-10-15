export const TOKEN_RADIUS = 28;
type Point = { x: number; y: number };

/** Screen-sized magnetic range, computed in map coordinates; no token is moved. */
export function snapRulerOrigin(point: Point, tokens: (Point & { id: string })[], scale: number): Point {
  const threshold = 12 / Math.max(scale, 0.15);
  let best = Infinity,
    result = point;
  for (const token of tokens) {
    const dx = point.x - token.x,
      dy = point.y - token.y;
    const distance = Math.hypot(dx, dy),
      gap = Math.abs(distance - TOKEN_RADIUS);
    if (distance > TOKEN_RADIUS + threshold || gap >= best) continue;
    best = gap;
    result =
      distance < 0.001
        ? { x: token.x + TOKEN_RADIUS, y: token.y }
        : {
            x: token.x + (dx * TOKEN_RADIUS) / distance,
            y: token.y + (dy * TOKEN_RADIUS) / distance,
          };
  }
  return result;
}
