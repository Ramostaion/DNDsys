import { describe, expect, it } from 'vitest';
import { resourceField, resourceSummary, withShieldFields } from './character-resources.js';
import { calculateSheet, validateSheetDefinitions, type SheetField } from './sheet.js';
import { characterCurrentHealth } from './character-access.js';
import { canEditSheetField } from './room-permissions.js';

describe('独立护盾资源', () => {
  it('为旧卡添加默认零值、避开旧字段标识且重复构造不叠加', () => {
    const old: SheetField[] = [{ fieldId: 'dnd_shield', name: '旧自定义内容', type: 'text', defaultValue: '保留' }];
    const fields = withShieldFields(old);
    expect(old).toHaveLength(1);
    expect(fields).toHaveLength(3);
    expect(resourceField(fields, 'shield')?.fieldId).toBe('dnd_shield_2');
    expect(withShieldFields(fields)).toBe(fields);
    const result = calculateSheet(fields, {});
    expect(result.values).toEqual({ dnd_shield: '保留', dnd_shield_2: 0, dnd_shield_max: 0 });
  });
  it('护盾排在生命前也不改变归零/背包判定，没有生命字段时不把护盾当生命', () => {
    const fields = [
      ...withShieldFields([]),
      { fieldId: 'hp', name: '生命', type: 'number', isResource: true, maxFieldId: 'hp_max' } as SheetField,
      { fieldId: 'hp_max', name: '生命上限', type: 'number' } as SheetField,
    ];
    const character = { currentHp: 0, derived: { values: { dnd_shield: 0, dnd_shield_max: 30, hp: 20, hp_max: 20 } } };
    expect(resourceField(fields, 'health')?.fieldId).toBe('hp');
    expect(characterCurrentHealth({ sheetMode: true, sheetSchema: fields }, character)).toBe(20);
    expect(
      characterCurrentHealth(
        { sheetMode: true, sheetSchema: fields },
        { derived: { values: { ...character.derived.values, hp: 0, dnd_shield: 30 } } },
      ),
    ).toBe(0);
    expect(resourceField(withShieldFields([]), 'health')).toBeUndefined();
    expect(characterCurrentHealth({ sheetMode: true, sheetSchema: withShieldFields([]) }, character)).toBeNull();
  });
  it('护盾与生命共用比例算法，零上限/超上限/非有限值不产生坏进度', () => {
    expect(resourceSummary(15, 30)).toEqual({ current: 15, maximum: 30, percent: 50 });
    expect(resourceSummary(40, 30)?.percent).toBe(100);
    expect(resourceSummary(-1, 30)?.percent).toBe(0);
    expect(resourceSummary(0, 0)?.percent).toBe(0);
    expect(resourceSummary(1, NaN)).toBeNull();
    expect(resourceSummary(Infinity, 10)).toBeNull();
    expect(resourceSummary('1', 10)).toBeNull();
  });
  it('即使 GM 授权普通数值编辑，护盾和上限仍仅 GM 可改；拒绝重复或非法资源', () => {
    const fields = withShieldFields([]);
    for (const field of fields) {
      expect(
        canEditSheetField(
          { permissionSettings: { characterValues: true } },
          { role: 'PLAYER', permissions: { editAllCharacters: true } },
          { ownerId: 'player' },
          'player',
          { ...field, editableBy: 'OWNER' },
          fields,
        ),
      ).toBe(false);
      expect(canEditSheetField({}, { role: 'GM' }, { ownerId: 'player' }, 'gm', field, fields)).toBe(true);
    }
    expect(() => validateSheetDefinitions([...fields, { ...fields[1], fieldId: 'second' }])).toThrow('一条护盾');
    expect(() => validateSheetDefinitions([{ ...fields[1], isResource: false }])).toThrow('资源字段无效');
  });
});
