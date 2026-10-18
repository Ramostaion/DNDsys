import { describe, expect, it } from 'vitest';
import { coneRulerBounds } from './ruler-bounds';

describe('锥形量尺的实际扇形边界', () => {
  it('60 度锥形只框住前方扇形，不包含背后的完整圆形', () => {
    const box = coneRulerBounds(200, 60, 0);
    expect(box.x).toBe(-1);
    expect(box.y).toBeCloseTo(-101);
    expect(box.width).toBe(202);
    expect(box.height).toBeCloseTo(202);
  });

  it('90 度旋转时包含原点与圆弧中点的极值', () => {
    const box = coneRulerBounds(200, 60, 90);
    expect(box.x).toBeCloseTo(-101);
    expect(box.y).toBe(-1);
    expect(box.width).toBeCloseTo(202);
    expect(box.height).toBe(202);
  });

  it('斜向窄扇形不把局部矩形再次旋转放大', () => {
    const box = coneRulerBounds(200, 30, 45);
    expect(box.x).toBe(-1);
    expect(box.y).toBe(-1);
    expect(box.width).toBeCloseTo(200 * Math.cos(Math.PI / 6) + 2);
    expect(box.height).toBeCloseTo(200 * Math.cos(Math.PI / 6) + 2);
    expect(coneRulerBounds(200, 30, -315)).toEqual(box);
    expect(coneRulerBounds(200, 30, 765)).toEqual(box);
  });

  it('大于半圆的锥形包含跨越的方向极值，但不额外包含背部空白', () => {
    const box = coneRulerBounds(100, 270, 0);
    expect(box.x).toBeCloseTo(-100 / Math.SQRT2 - 1);
    expect(box.y).toBe(-101);
    expect(box.width).toBeCloseTo(100 + 100 / Math.SQRT2 + 2);
    expect(box.height).toBe(202);
  });

  it('不同角度与方向的边界均贴合独立采样得到的弧线和原点', () => {
    for (const aperture of [1, 30, 60, 150, 240, 359]) {
      for (const rotation of [-95, 0, 37, 90, 210, 357]) {
        const box = coneRulerBounds(200, aperture, rotation);
        const xs = [0],
          ys = [0];
        for (let index = 0; index <= 4096; index++) {
          const radians = ((rotation - aperture / 2 + (aperture * index) / 4096) * Math.PI) / 180;
          xs.push(200 * Math.cos(radians));
          ys.push(200 * Math.sin(radians));
        }
        expect(box.x).toBeCloseTo(Math.min(...xs) - 1, 3);
        expect(box.y).toBeCloseTo(Math.min(...ys) - 1, 3);
        expect(box.width).toBeCloseTo(Math.max(...xs) - Math.min(...xs) + 2, 3);
        expect(box.height).toBeCloseTo(Math.max(...ys) - Math.min(...ys) + 2, 3);
      }
    }
  });
});
