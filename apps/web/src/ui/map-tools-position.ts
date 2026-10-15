export type MapToolsPosition = { x: number; y: number };

export function readMapToolsPosition(value: string | null): MapToolsPosition | null {
  try {
    const position = value ? JSON.parse(value) : null;
    return typeof position?.x === 'number' &&
      Number.isFinite(position.x) &&
      typeof position?.y === 'number' &&
      Number.isFinite(position.y)
      ? { x: position.x, y: position.y }
      : null;
  } catch {
    return null;
  }
}

export function clampMapToolsPosition(
  position: MapToolsPosition,
  parent: { w: number; h: number },
  panel: { w: number; h: number },
): MapToolsPosition {
  return {
    x: Math.max(8, Math.min(Math.max(8, parent.w - panel.w - 8), position.x)),
    y: Math.max(8, Math.min(Math.max(8, parent.h - panel.h - 8), position.y)),
  };
}
