export type WindowRect = { x: number; y: number; w: number; h: number };
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export function resizeWindow(
  start: WindowRect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  minW = 340,
  minH = 240,
): WindowRect {
  let { x, y, w, h } = start;
  if (edge.includes('e')) w = Math.max(minW, start.w + dx);
  if (edge.includes('s')) h = Math.max(minH, start.h + dy);
  if (edge.includes('w')) {
    x = Math.max(0, Math.min(start.x + dx, start.x + start.w - minW));
    w = start.x + start.w - x;
  }
  if (edge.includes('n')) {
    y = Math.max(0, Math.min(start.y + dy, start.y + start.h - minH));
    h = start.y + start.h - y;
  }
  return { x, y, w, h };
}
