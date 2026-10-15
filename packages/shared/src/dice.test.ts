import { describe, it, expect } from 'vitest';
import { rollDice, diceCalculation, diceActor } from './dice';
describe('受限掷骰', () => {
  it('展开每颗骰子及有符号修正，显示结果对应真实总和', () => {
    const result = rollDice(
      '2d6-1d4+3-力量',
      () => 2,
      () => 4,
    );
    expect(diceCalculation(result.parts)).toBe('4 + 4 − 4 + 3 − 2');
    expect(result.total).toBe(5);
    expect(diceActor({ rollerName: '阿明', rollerRole: 'PLAYER' })).toBe('玩家 阿明');
    expect(diceActor({ rollerName: '小王', rollerRole: 'GM' })).toBe('GM 小王');
  });
  it('支持骰子、属性和修正值', () => {
    const result = rollDice(
      '2d6 + 力量加值 - 1',
      (name) => (name === '力量加值' ? 3 : 0),
      () => 4,
    );
    expect(result.total).toBe(10);
    expect(result.parts[0].rolls).toEqual([4, 4]);
  });
  it('拒绝脚本、过大骰池和无效随机数', () => {
    expect(() =>
      rollDice(
        'process.exit()',
        () => 0,
        () => 1,
      ),
    ).toThrow();
    expect(() =>
      rollDice(
        '101d6',
        () => 0,
        () => 1,
      ),
    ).toThrow();
    expect(() =>
      rollDice(
        '1d6',
        () => 0,
        () => 7,
      ),
    ).toThrow();
  });
});
