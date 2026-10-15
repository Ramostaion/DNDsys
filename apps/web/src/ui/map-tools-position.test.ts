import { describe, expect, it } from 'vitest';
import { clampMapToolsPosition, readMapToolsPosition } from './map-tools-position';

describe('地图工具位置恢复', () => {
  it('恢复有限坐标，损坏或错误类型的本地配置退回默认位置', () => {
    expect(readMapToolsPosition('{"x":150,"y":80}')).toEqual({ x: 150, y: 80 });
    for (const value of [null, 'broken', 'null', '{"x":"150","y":80}', '{"x":1e999,"y":80}'])
      expect(readMapToolsPosition(value)).toBeNull();
  });
  it('拖动与视窗缩小保持在边界内，工具高度超出视窗时标题仍可操作', () => {
    expect(clampMapToolsPosition({ x: -100, y: -200 }, { w: 1000, h: 600 }, { w: 320, h: 100 })).toEqual({
      x: 8,
      y: 8,
    });
    expect(clampMapToolsPosition({ x: 900, y: 550 }, { w: 1000, h: 600 }, { w: 320, h: 100 })).toEqual({
      x: 672,
      y: 492,
    });
    expect(clampMapToolsPosition({ x: 50, y: 60 }, { w: 200, h: 50 }, { w: 180, h: 100 })).toEqual({ x: 12, y: 8 });
  });
});
