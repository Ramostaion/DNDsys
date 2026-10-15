import { describe, it, expect } from 'vitest';
import { DEFAULT_RULES, type SheetField } from '@dnd/shared';
import { characterDerived } from './domain.js';

describe('人物卡派生属性', () => {
  const equipment = [{ entry: { item: { data: { 防御: 3 } } } }, { entry: { item: { data: { 防御: 2 } } } }];
  it('体质、等级和装备与特性共同重算', () => {
    const base = {
      level: 2,
      attributes: { 体质: 16 },
      formulas: [],
      traits: [{ name: '铁壁', modifiers: { 防御: 5 } }],
      equipment,
    };
    const result = characterDerived(base, DEFAULT_RULES);
    expect(result.values.血量上限).toBe(36);
    expect(result.values.防御).toBe(10);
    expect(result.sources.防御).toContain('铁壁: +5');
    expect(characterDerived({ ...base, level: 3 }, DEFAULT_RULES).values.血量上限).toBe(54);
    expect(characterDerived({ ...base, equipment: [] }, DEFAULT_RULES).values.防御).toBe(5);
    expect(characterDerived({ ...base, traits: [] }, DEFAULT_RULES).values.防御).toBe(5);
  });
  it('状态数值效果会参与派生属性计算并标记来源', () => {
    const result = characterDerived(
      {
        level: 1,
        attributes: { 体质: 10 },
        formulas: [],
        traits: [],
        statuses: [{ name: '中毒', modifiers: { 防御: -2 } }],
        equipment: [],
      },
      DEFAULT_RULES,
    );
    expect(result.values.防御).toBe(-2);
    expect(result.sources.防御).toContain('中毒: -2');
  });
  it('护盾用原字段计算叠加装备和状态，兼容旧卡且重复重算不累积', () => {
    const character = {
      level: 1,
      attributes: {},
      formulas: [],
      traits: [],
      fieldValues: { dnd_shield: 8, dnd_shield_max: 20 },
      statuses: [{ id: 'shield-buff', name: '护盾祝福', modifiers: { dnd_shield_max: 2 } }],
      equipment: [
        {
          entry: { item: { name: '护盾戒指', kind: '饰品', data: { customFields: [{ name: '护盾上限', value: 5 }] } } },
        },
      ],
    };
    for (const sheetMode of [true, false]) {
      const result = characterDerived(character, DEFAULT_RULES, [], sheetMode);
      expect(result.values).toMatchObject({ dnd_shield: 8, dnd_shield_max: 27 });
      expect(result.sources.dnd_shield_max.join(' ')).toContain('护盾祝福');
      expect(result.sources.dnd_shield_max.join(' ')).toContain('护盾戒指');
      expect(characterDerived(character, DEFAULT_RULES, [], sheetMode)).toEqual(result);
      expect(character.fieldValues.dnd_shield_max).toBe(20);
    }
  });
});

describe('同名装备数值联动', () => {
  const fields: SheetField[] = [
    { fieldId: 'magic', name: '法伤', type: 'number' },
    { fieldId: 'double', name: '总伤害', type: 'number', formula: '{{magic}}*2' },
    { fieldId: 'story', name: '故事', type: 'text' },
  ];
  const item = {
    name: '魔法戒指',
    kind: '饰品',
    data: {
      customFields: [
        { name: '法伤', value: 5 },
        { name: '故事', value: 5 },
        { name: '不存在', value: 100 },
        { name: '总伤害', value: '100' },
      ],
    },
  };
  const base = {
    level: 1,
    attributes: { 法伤: 23 },
    fieldValues: { magic: 23 },
    formulas: [],
    traits: [],
    equipment: [{ entry: { item } }],
  };
  it('通过显示名称匹配字段，参与公式和 Buff，并保留原始值', () => {
    const result = characterDerived(
      { ...base, statuses: [{ id: 'buff', name: '祝福', modifiers: { magic: 2 } }] },
      DEFAULT_RULES,
      fields,
      true,
    );
    expect(result.values).toMatchObject({ magic: 30, double: 60, story: null });
    expect(result.values).not.toHaveProperty('不存在');
    expect(result.sources.magic.join(' ')).toContain('魔法戒指');
    expect(base.fieldValues.magic).toBe(23);
    expect(characterDerived(base, DEFAULT_RULES, fields, true).values.magic).toBe(28);
    expect(characterDerived({ ...base, equipment: [] }, DEFAULT_RULES, fields, true).values.magic).toBe(23);
  });
  it('属性改名或物品改为杂物后加成消失，文字数值不会隐式转换', () => {
    expect(characterDerived(base, DEFAULT_RULES, [{ ...fields[0], name: '魔法伤害' }], true).values.magic).toBe(23);
    for (const changed of [
      { ...item, kind: '杂物' },
      { ...item, data: { customFields: [{ name: '法伤', value: '5' }] } },
    ]) {
      expect(
        characterDerived({ ...base, equipment: [{ entry: { item: changed } }] }, DEFAULT_RULES, fields, true).values
          .magic,
      ).toBe(23);
    }
  });
  it('多个部位叠加，保留旧修正并支持负数和小数；重算不累加缓存', () => {
    const entry = {
      item: { ...item, kind: '装备', data: { customFields: [{ name: '法伤', value: -1.5 }], modifiers: { magic: 2 } } },
    };
    const wearing = { ...base, equipment: [...base.equipment, { entry }] };
    expect(characterDerived(wearing, DEFAULT_RULES, fields, true).values.magic).toBe(28.5);
    expect(characterDerived(wearing, DEFAULT_RULES, fields, true).values.magic).toBe(28.5);
  });
  it('重名字段不猜测目标，旧人物卡也按数值属性名称匹配', () => {
    expect(
      characterDerived(base, DEFAULT_RULES, [fields[0], { ...fields[0], fieldId: 'other' }], true).values.magic,
    ).toBe(23);
    expect(characterDerived(base, DEFAULT_RULES).values.法伤).toBe(28);
  });
});
