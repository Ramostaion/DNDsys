import { describe, it, expect } from 'vitest';
import { resizeWindow } from './window-resize';
describe('四边窗口缩放', () => {
  const start = { x: 200, y: 120, w: 600, h: 500 };
  it('拖动左上角保留右下角，拖动右下角保留左上角', () => {
    const topLeft = resizeWindow(start, 'nw', 40, 30);
    expect(topLeft).toEqual({ x: 240, y: 150, w: 560, h: 470 });
    expect(topLeft.x + topLeft.w).toBe(start.x + start.w);
    expect(topLeft.y + topLeft.h).toBe(start.y + start.h);
    expect(resizeWindow(start, 'se', 40, 30)).toEqual({ x: 200, y: 120, w: 640, h: 530 });
  });
  it('过度缩小保留最小尺寸，左上边界不移出地图桌', () => {
    expect(resizeWindow(start, 'nw', 1000, 1000)).toEqual({ x: 460, y: 380, w: 340, h: 240 });
    expect(resizeWindow(start, 'nw', -1000, -1000)).toEqual({ x: 0, y: 0, w: 800, h: 620 });
    expect(resizeWindow(start, 'se', -1000, -1000)).toEqual({ x: 200, y: 120, w: 340, h: 240 });
  });
});
