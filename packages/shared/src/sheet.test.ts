import { describe, it, expect } from 'vitest';
import {
  calculateSheet,
  parseSheetFormula,
  validateSheetDefinitions,
  type SheetField,
  type SheetModifier,
} from './sheet.js';

const fields: SheetField[] = [
  { fieldId: 'defense', name: '防御', type: 'number', defaultValue: 10 },
  { fieldId: 'strength', name: '力量', type: 'number', defaultValue: 12 },
  { fieldId: 'power', name: '战力', type: 'number', formula: 'if({{strength}}>10, {{strength}}*2, 0)' },
];
const mod = (
  id: string,
  targetFieldId: string,
  value: number,
  kind: 'equipment' | 'trait' | 'buff',
): SheetModifier => ({
  id,
  targetFieldId,
  value,
  operation: 'ADD',
  enabled: true,
  source: { kind, instanceId: id, name: id },
});
describe('safe character sheet formulas', () => {
  it('applies equipment, traits and buffs once, with explanations and dependent recomputation', () => {
    const mods = [
      mod('iron armor', 'defense', 4, 'equipment'),
      mod('iron wall', 'defense', 5, 'trait'),
      mod('weakness', 'defense', -2, 'buff'),
      mod('strength buff', 'strength', 3, 'buff'),
    ];
    const result = calculateSheet(fields, {}, mods);
    expect(result.values.defense).toBe(17);
    expect(result.values.strength).toBe(15);
    expect(result.values.power).toBe(30);
    expect(result.sources.defense).toEqual(['基础值 10', 'iron armor ADD 4', 'iron wall ADD 5', 'weakness ADD -2']);
    expect(result.breakdown.defense).toEqual({
      base: 10,
      changes: [
        { name: 'iron armor', amount: 4, kind: 'equipment', instanceId: 'iron armor' },
        { name: 'iron wall', amount: 5, kind: 'trait', instanceId: 'iron wall' },
        { name: 'weakness', amount: -2, kind: 'buff', instanceId: 'weakness' },
      ],
    });
    expect(
      calculateSheet(
        fields,
        {},
        mods.filter((x) => x.id !== 'iron armor'),
      ).values.defense,
    ).toBe(13);
    expect(
      calculateSheet(
        fields,
        {},
        mods.map((x) => (x.id === 'strength buff' ? { ...x, enabled: false } : x)),
      ).values.power,
    ).toBe(24);
  });
  it('keeps references stable when display names or ordering change', () => {
    expect(
      calculateSheet(
        [...fields].reverse().map((f) => ({ ...f, name: f.name + ' 改名' })),
        {},
      ).values.power,
    ).toBe(24);
  });
  it('applies additive, multiplicative and override modifiers in explicit order', () => {
    const rows: SheetModifier[] = [
      { ...mod('a', 'defense', 4, 'equipment'), priority: 0 },
      { ...mod('b', 'defense', 2, 'trait'), operation: 'MULTIPLY', priority: 1 },
    ];
    expect(calculateSheet(fields, {}, rows).values.defense).toBe(28);
    expect(
      calculateSheet(fields, {}, [...rows, { ...mod('c', 'defense', 7, 'buff'), operation: 'OVERRIDE', priority: 2 }])
        .values.defense,
    ).toBe(7);
    expect(
      calculateSheet(fields, {}, [...rows, { ...mod('c', 'defense', 7, 'buff'), operation: 'OVERRIDE', priority: 2 }])
        .breakdown.defense,
    ).toEqual({
      base: 10,
      changes: [
        { name: 'a', amount: 4, kind: 'equipment', instanceId: 'a' },
        { name: 'b', amount: 14, kind: 'trait', instanceId: 'b' },
        { name: 'c', amount: -21, kind: 'buff', instanceId: 'c' },
      ],
    });
  });
  it('rejects cycles, unknown or nonnumeric references and unsafe syntax', () => {
    expect(() =>
      validateSheetDefinitions([
        { fieldId: 'A', name: 'A', type: 'number', formula: '{{B}}' },
        { fieldId: 'B', name: 'B', type: 'number', formula: '{{A}}' },
      ]),
    ).toThrow('A → B → A');
    expect(() =>
      validateSheetDefinitions([{ fieldId: 'A', name: 'A', type: 'number', formula: '{{missing}}' }]),
    ).toThrow('未知字段');
    expect(() => parseSheetFormula('evil(1)')).toThrow('函数不被允许');
    expect(() => parseSheetFormula('process.exit(1)')).toThrow('公式语法错误');
    expect(calculateSheet([{ fieldId: 'A', name: 'A', type: 'number', formula: '1/0' }], {}).errors.A).toContain(
      '除数不能为零',
    );
    expect(parseSheetFormula('if(0, 1/0, min(3, 5))').evaluate(() => 0)).toBe(3);
  });
});
