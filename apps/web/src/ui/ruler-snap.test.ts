import { describe, it, expect } from 'vitest';
import { snapRulerOrigin, TOKEN_RADIUS } from './ruler-snap';

describe('头像边缘磁吸', () => {
  const tokens = [
    { id: 'a', x: 100, y: 100 },
    { id: 'b', x: 180, y: 100 },
  ];
  it('原点靠近边缘或进入头像时投影到最近圆周，中心点也不会产生 NaN', () => {
    expect(snapRulerOrigin({ x: 133, y: 100 }, tokens, 1)).toEqual({ x: 128, y: 100 });
    expect(snapRulerOrigin({ x: 110, y: 110 }, tokens, 1)).toEqual({
      x: 100 + TOKEN_RADIUS / Math.SQRT2,
      y: 100 + TOKEN_RADIUS / Math.SQRT2,
    });
    expect(snapRulerOrigin({ x: 100, y: 100 }, tokens, 1)).toEqual({ x: 128, y: 100 });
    expect(snapRulerOrigin({ x: 147, y: 100 }, tokens, 1)).toEqual({ x: 152, y: 100 });
  });
  it('磁吸范围按屏幕像素换算，远离头像不改变位置', () => {
    const point = { x: 145, y: 100 };
    expect(snapRulerOrigin(point, tokens.slice(0, 1), 1)).toEqual(point);
    expect(snapRulerOrigin(point, tokens.slice(0, 1), 0.5)).toEqual({ x: 128, y: 100 });
    expect(snapRulerOrigin({ x: 135, y: 100 }, tokens.slice(0, 1), 2)).toEqual({ x: 135, y: 100 });
    expect(snapRulerOrigin(point, [], 1)).toEqual(point);
  });
});
