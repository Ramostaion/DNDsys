export type ImageView = { zoom: number; x: number; y: number };
export function zoomImage(view: ImageView, nextZoom: number, point: { x: number; y: number }): ImageView {
  const zoom = Math.max(0.25, Math.min(16, nextZoom)),
    ratio = zoom / view.zoom;
  return { zoom, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio };
}
