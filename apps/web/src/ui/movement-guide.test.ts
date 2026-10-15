import { describe, it, expect } from 'vitest';
import { MAX_MOVEMENT_ARROWS, movementGuide } from './movement-guide';

describe('movement direction guides', () => {
  it('leaves avatar space clear and avoids crowded arrows for very short or zero-length moves', () => {
    expect(movementGuide([], 1).arrows).toEqual([]);
    expect(
      movementGuide(
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
        1,
      ).points,
    ).toEqual([]);
    expect(
      movementGuide(
        [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
        ],
        1,
      ).arrows,
    ).toEqual([]);
    const short = movementGuide(
      [
        { x: 0, y: 0 },
        { x: 90, y: 0 },
      ],
      1,
    );
    expect(short.arrows).toEqual([{ x: 45, y: 0, rotation: 0 }]);
    expect(short.points).toEqual([36, 0, 54, 0]);
  });
  it('keeps arrows screen-sized, evenly spaced, correctly directed and bounded on very long paths', () => {
    for (const scale of [0.15, 0.5, 1, 2, 5]) {
      const guide = movementGuide(
        [
          { x: 1000, y: 0 },
          { x: 0, y: 0 },
        ],
        scale,
      );
      expect(guide.size * scale).toBeCloseTo(14);
      expect(guide.lineWidth * scale).toBeCloseTo(2);
      const arrows = guide.arrows;
      expect(arrows.length).toBeGreaterThan(0);
      for (const arrow of arrows) expect(arrow.rotation).toBe(180);
      for (let i = 2; i < arrows.length; i++)
        expect(arrows[i - 1].x - arrows[i].x).toBeCloseTo(arrows[0].x - arrows[1].x);
    }
    const medium = movementGuide(
      [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
      ],
      1,
    );
    const long = movementGuide(
      [
        { x: 0, y: 0 },
        { x: 100000, y: 0 },
      ],
      1,
    );
    expect(long.arrows).toHaveLength(MAX_MOVEMENT_ARROWS);
    expect(long.arrows.length).toBeGreaterThan(medium.arrows.length);
  });
  it('preserves polyline corners and follows each segment direction without shortcuts', () => {
    const guide = movementGuide(
      [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 200 },
      ],
      1,
    );
    expect(guide.points).toEqual([36, 0, 200, 0, 200, 164]);
    expect(guide.arrows.some((arrow) => arrow.rotation === 0)).toBe(true);
    expect(guide.arrows.some((arrow) => arrow.rotation === 90)).toBe(true);
    for (const arrow of guide.arrows) {
      if (arrow.rotation === 0) expect(arrow.y).toBe(0);
      else expect(arrow.x).toBe(200);
    }
  });
});
