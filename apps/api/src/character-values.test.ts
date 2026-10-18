import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, characterAttribute, type SheetField } from '@dnd/shared';
import { characterDerived } from './character-values.js';

describe('装备多词条与属性对抗', () => {
  const fields: SheetField[] = [
    { fieldId: 'int', name: '智力', type: 'number', defaultValue: 15 },
    { fieldId: 'dex', name: '敏捷', type: 'number', defaultValue: 12 },
    { fieldId: 'damage', name: '法伤', type: 'number', formula: '{{int}}*2' },
  ];
  const character = {
    level: 1,
    attributes: { 智力: 15, 敏捷: 12 },
    formulas: [],
    traits: [],
    statuses: [],
    fieldValues: {},
    equipment: [
      {
        id: 'only-one-instance',
        entry: {
          item: {
            name: '双手法杖',
            kind: '双手武器',
            data: {
              customFields: [
                { name: '智力', value: 3 },
                { name: ' 敏捷 ', value: 2 },
                { name: '法伤', value: 5 },
                { name: '说明', value: '5' },
              ],
            },
          },
        },
      },
    ],
  };
  it('所有数值词条同时应用到基础字段与公式字段，公式引用包含装备加值', () => {
    const result = characterDerived(character, DEFAULT_RULES, fields, true);
    expect(result.values).toMatchObject({ int: 18, dex: 14, damage: 41 });
    expect(result.breakdown.damage.changes).toHaveLength(1);
    expect(result.breakdown.int.changes).toHaveLength(1);
    const resolution = characterAttribute({ ...character, derived: result }, fields, true, '智力');
    expect(resolution.agility).toMatchObject({ attributeName: '智力', effective: 18, bonus: 2 });
  });
  it('旧人物卡也应用每个基础属性词条', () => {
    expect(characterDerived(character, DEFAULT_RULES).values).toMatchObject({ 智力: 18, 敏捷: 14 });
    const legacy = { ...character, formulas: [{ key: '法伤', expression: '智力*2' }] };
    expect(characterDerived(legacy, DEFAULT_RULES).values).toMatchObject({ 智力: 18, 敏捷: 14, 法伤: 41 });
  });
  it('缺失、重复、非数值或私密的所选词条不会借用敏捷冒充', () => {
    const result = characterDerived(character, DEFAULT_RULES, fields, true);
    expect(characterAttribute({ ...character, derived: result }, fields, true, '魅力').agility).toBeUndefined();
    expect(
      characterAttribute(
        { ...character, derived: result },
        [...fields, { ...fields[0], fieldId: 'another' }],
        true,
        '智力',
      ).reason,
    ).toContain('多个');
    expect(
      characterAttribute(
        { ...character, derived: result },
        fields.map((f) => (f.fieldId === 'int' ? { ...f, visibility: 'GM' } : f)),
        true,
        '智力',
      ).agility?.visibility,
    ).toBe('GM');
  });
  it('角色状态数值按名称匹配基础和公式字段，文字不参与计算，移除状态不再加成', () => {
    const c = {
      ...character,
      characterTags: [
        {
          id: 'state-id',
          definition: { name: '灵光' },
          customFields: [
            { name: ' 智力 ', value: 2 },
            { name: '法伤', value: 3 },
            { name: '敏捷', value: '99' },
          ],
        },
      ],
    };
    const result = characterDerived(c, DEFAULT_RULES, fields, true);
    expect(result.values).toMatchObject({ int: 20, dex: 14, damage: 48 });
    expect(result.breakdown.int.changes).toContainEqual(
      expect.objectContaining({ name: '灵光', amount: 2, instanceId: 'state:state-id' }),
    );
    expect(characterDerived(c, DEFAULT_RULES).values.智力).toBe(20);
    expect(characterDerived({ ...c, characterTags: [] }, DEFAULT_RULES, fields, true).values.int).toBe(18);
  });
  it('只将已穿戴背包的数值格数计入扩容，同名普通物品词条不扩容', () => {
    const worn = (kind: string, value: unknown) => ({
      entry: { item: { kind, data: { customFields: [{ name: '格数', value }] } } },
    });
    expect(characterDerived({ ...character, equipment: [worn('背包', 2)] }, DEFAULT_RULES).inventoryBonus).toBe(2);
    expect(
      characterDerived(
        { ...character, equipment: [worn('装备', 8), worn('背包', '2'), worn('背包', -2)] },
        DEFAULT_RULES,
      ).inventoryBonus,
    ).toBe(0);
  });
});
