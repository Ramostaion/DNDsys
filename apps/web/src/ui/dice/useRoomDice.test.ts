import { describe, it, expect } from 'vitest';
import { remainingDiceMs } from './useRoomDice';

describe('服务端骰子时钟', () => {
  it('不依赖浏览器墙上时间，按单调时钟递减并到期清零', () => {
    const clock = { serverNow: 100_000, cooldownUntil: 102_000, receivedAt: 250 };
    expect(remainingDiceMs(clock, 250)).toBe(2000);
    expect(remainingDiceMs(clock, 850)).toBe(1400);
    expect(remainingDiceMs(clock, 2250)).toBe(0);
    expect(remainingDiceMs(clock, 3000)).toBe(0);
    expect(remainingDiceMs(null, 250)).toBe(0);
  });
});
