import { describe, it, expect } from 'vitest';
import { zoomImage } from './image-zoom';

describe('图片滚轮缩放', () => {
  it('缩放时保留鼠标指向的图片位置', () => {
    const before = { zoom: 1, x: 25, y: -10 },
      point = { x: 120, y: 60 },
      after = zoomImage(before, 2, point);
    expect((point.x - before.x) / before.zoom).toBeCloseTo((point.x - after.x) / after.zoom);
    expect((point.y - before.y) / before.zoom).toBeCloseTo((point.y - after.y) / after.zoom);
  });
  it('放大再缩小恢复原位置，并限制极端缩放', () => {
    const before = { zoom: 1, x: 0, y: 0 },
      point = { x: 100, y: -30 };
    expect(zoomImage(zoomImage(before, 3, point), 1, point)).toEqual(before);
    expect(zoomImage(before, 100, point).zoom).toBe(16);
    expect(zoomImage(before, 0, point).zoom).toBe(0.25);
  });
});
