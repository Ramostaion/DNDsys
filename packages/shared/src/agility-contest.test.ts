import { describe, expect, it } from 'vitest';
import { agilityBonus, characterAgility, resolveAgilityContest, type ContestParticipant } from './agility-contest.js';
import type { SheetField } from './sheet.js';

const side = (effective: number, d20: number, isNpc = false, name = '亚瑟'): Omit<ContestParticipant, 'total'> => ({
  id: name,
  name,
  isNpc,
  fieldId: 'dex',
  base: effective,
  modifiers: [],
  rawEffective: effective,
  effective,
  bonus: agilityBonus(effective),
  visibility: 'ALL',
  d20,
});
describe('敏捷 D20 对抗唯一规则', () => {
  it('属性加值覆盖所有边界和高值，没有额外上限', () => {
    for (const [value, bonus] of [
      [0, -4],
      [1, -4],
      [2, -4],
      [3, -3],
      [4, -3],
      [5, -2],
      [6, -2],
      [7, -1],
      [8, -1],
      [9, -1],
      [10, 0],
      [12, 0],
      [13, 1],
      [15, 1],
      [16, 2],
      [18, 2],
      [19, 3],
      [20, 3],
      [21, 4],
      [22, 4],
      [23, 5],
      [24, 5],
      [25, 6],
      [26, 6],
      [27, 7],
      [28, 7],
      [29, 8],
      [30, 8],
      [31, 9],
      [32, 9],
      [101, 44],
    ])
      expect(agilityBonus(value)).toBe(bonus);
    expect(() => agilityBonus(NaN)).toThrow();
  });
  it.each([
    [17, 12, 12, 15, false, 14, 15],
    [14, 6, 12, 15, false, 7, 15],
    [15, 10, 18, 9, false, 11, 11],
    [25, 8, 12, 15, false, 14, 15],
    [1, 20, 20, 1, true, 16, 4],
    [1, 20, 100, 1, false, 16, 44],
    [6, 1, 4, 5, false, 1, 2],
    [4, 5, 6, 1, true, 2, 1],
    [1, 1, 1, 4, false, 1, 1],
    [1, 5, 1, 6, false, 1, 2],
  ])('敏捷 %s 投 %s 对 敏捷 %s 投 %s，比较 MAX(1, 加值 + D20)', (a, da, b, db, hit, totalA, totalB) => {
    const result = resolveAgilityContest(side(a, da), side(b, db, true, '哥布林'));
    expect(result.hit).toBe(hit);
    expect(result.attacker.total).toBe(totalA);
    expect(result.defender.total).toBe(totalB);
    if (totalA === totalB) expect(result.reason).toContain('相等');
  });
  it('合法负修正仅将有效敏捷归一，基础和原始最终值保留，缺失和非法数值不伪造', () => {
    const fields: SheetField[] = [{ fieldId: 'dex', name: '敏捷', type: 'number', defaultValue: 8 }];
    const character = {
      derived: { values: { dex: -4 }, breakdown: { dex: { base: 8, changes: [{ name: '束缚', amount: -12 }] } } },
    };
    expect(characterAgility(character, fields, true).agility).toMatchObject({
      base: 8,
      rawEffective: -4,
      effective: 1,
      bonus: -4,
    });
    expect(characterAgility(character, [], true).agility).toBeUndefined();
    expect(characterAgility({ attributes: {}, derived: { values: { 敏捷: 10 } } }, [], false).agility).toBeUndefined();
    expect(characterAgility({ ...character, fieldValues: { dex: '' } }, fields, true).agility).toBeUndefined();
    expect(characterAgility({ ...character, fieldValues: { dex: '8' } }, fields, true).agility).toBeUndefined();
    expect(characterAgility(character, [...fields, { ...fields[0], fieldId: 'other' }], true).reason).toContain('多个');
  });
  it('玩家/NPC 四种组合使用角色快照名称生成广播，自然 1 或 20 没有额外效果', () => {
    for (const [an, bn, message] of [
      [false, true, '玩家亚瑟命中了哥布林！'],
      [true, false, '亚瑟命中了玩家哥布林！'],
      [false, false, '玩家亚瑟命中了玩家哥布林！'],
      [true, true, '亚瑟命中了哥布林！'],
    ] as const) {
      expect(resolveAgilityContest(side(100, 1, an), side(1, 20, bn, '哥布林')).message).toBe(message);
      expect(resolveAgilityContest(side(1, 20, an), side(100, 1, bn, '哥布林')).message).toBe(
        `${bn ? '' : '玩家'}哥布林成功闪避了亚瑟的攻击！`,
      );
    }
    expect(() => resolveAgilityContest(side(10, 0), side(10, 1))).toThrow('点数');
  });
});
