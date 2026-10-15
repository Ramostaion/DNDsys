import { describe, it, expect } from 'vitest';
import { DEFAULT_RULES, abilityBonus, calculate, gainXp, resolveAttack, rulerPixels, xpRequired } from './index';
describe('规则引擎', () => {
  it('经验阈值与升级', () => {
    expect(xpRequired(1)).toBe(100);
    expect(xpRequired(120)).toBe(12000);
    expect(gainXp(1, 0, 250, true)).toEqual({ level: 2, xp: 150 });
    expect(gainXp(1, 0, 250, false)).toEqual({ level: 2, xp: 0 });
  });
  it('已定义判定区间', () => {
    for (const r of DEFAULT_RULES.abilityRanges)
      for (let v = r.min; v <= r.max; v++) expect(abilityBonus(v)).toBe(r.bonus);
  });
  it('属性依赖、装备及特性来源', () => {
    const f = [
      { key: '血量上限', expression: '等级*(体质+体质加值)' },
      { key: '防御', expression: '装备防御' },
    ];
    const base = { 等级: 2, 体质: 12, 体质加值: 0, 装备防御: 4 };
    expect(calculate(base, f).values.血量上限).toBe(24);
    expect(calculate({ ...base, 体质: 16, 体质加值: 2 }, f).values.血量上限).toBe(36);
    expect(calculate({ ...base, 等级: 3 }, f).values.血量上限).toBe(36);
    const withTrait = calculate(base, f, { 防御: [{ amount: 5, source: '铁壁' }] });
    expect(withTrait.values.防御).toBe(9);
    expect(withTrait.sources.防御).toContain('铁壁: +5');
    expect(calculate(base, f).values.防御).toBe(4);
  });
  it('拒绝循环和脚本', () => {
    expect(
      calculate({}, [
        { key: 'a', expression: 'b+1' },
        { key: 'b', expression: 'a+1' },
      ]).errors.a,
    ).toMatch(/循环引用/);
    expect(() => calculate({}, [{ key: 'a', expression: 'process.exit()' }])).not.toThrow();
    expect(calculate({}, [{ key: 'a', expression: 'process.exit()' }]).errors.a).toBeTruthy();
  });
  it('量尺换算', () => expect(rulerPixels(5, 100, 5)).toBe(100));
  it('命中和最低伤害由房间规则决定', () => {
    expect(resolveAttack(12, 12, 5)).toEqual({ hit: true, damage: 5 });
    expect(resolveAttack(11, 12, 5)).toEqual({ hit: false, damage: 0 });
    expect(resolveAttack(12, 12, -2, { ...DEFAULT_RULES, minimumDamage: 1 })).toEqual({ hit: true, damage: 1 });
    expect(resolveAttack(12, 12, 5, { ...DEFAULT_RULES, attackHitsOnEqual: false })).toEqual({ hit: false, damage: 0 });
  });
});
