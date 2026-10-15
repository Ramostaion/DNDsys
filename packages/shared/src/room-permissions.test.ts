import { describe, it, expect } from 'vitest';
import { memberCan, roomPolicy, canEditSheetField, gmManagedField, type PermissionMode } from './room-permissions.js';
import type { SheetField } from './sheet.js';
const room = { permissionMode: 'MIXED', permissionSettings: {} },
  player = { role: 'PLAYER', permissions: {} },
  character = { ownerId: 'owner', visibility: 'PUBLIC', isNpc: false };
describe('GM 授权与受保护人物字段', () => {
  it('任何预设都不自动授予基础信息、普通数值和物品加入；显式授权及禁止生效', () => {
    for (const mode of ['FREE', 'MIXED', 'CONTROLLED'] as PermissionMode[])
      for (const key of ['characterBasics', 'characterValues', 'inventoryAdd'] as const)
        expect(roomPolicy({ ...room, permissionMode: mode })[key]).toBe(false);
    expect(memberCan(room, player, 'characterValues')).toBe(false);
    expect(memberCan({ ...room, permissionSettings: { characterValues: true } }, player, 'characterValues')).toBe(true);
    expect(
      memberCan(
        { ...room, permissionSettings: { characterValues: true } },
        { ...player, permissions: { characterValues: false } },
        'characterValues',
      ),
    ).toBe(false);
    expect(memberCan(room, { ...player, permissions: { inventoryAdd: true } }, 'inventoryAdd')).toBe(true);
    expect(memberCan(room, { role: 'GM' }, 'characterBasics')).toBe(true);
  });
  it('自定义字段仅 GM 可编辑，旧 OWNER 或人物卡授权均不能放开玩家修改', () => {
    const field: SheetField = { fieldId: 'value', name: '普通数值', type: 'number' },
      authorized = { ...player, permissions: { characterValues: true } };
    expect(canEditSheetField(room, player, character, 'owner', field, [field])).toBe(false);
    expect(canEditSheetField(room, authorized, character, 'owner', field, [field])).toBe(false);
    expect(canEditSheetField(room, authorized, character, 'owner', { ...field, editableBy: 'OWNER' }, [field])).toBe(
      false,
    );
    expect(canEditSheetField(room, { role: 'GM' }, character, 'gm', field, [field])).toBe(true);
    expect(canEditSheetField(room, { role: 'GM' }, character, 'gm', { ...field, formula: '1+1' }, [field])).toBe(false);
    expect(canEditSheetField(room, authorized, character, 'other', field, [field])).toBe(false);
    expect(
      canEditSheetField(
        room,
        { ...authorized, permissions: { characterValues: true, editAllCharacters: true } },
        { ...character, isNpc: true },
        'owner',
        field,
        [field],
      ),
    ).toBe(false);
    const basic = { ...field, name: '职业', type: 'text' as const, group: '基础信息' };
    expect(canEditSheetField(room, authorized, character, 'owner', basic, [basic])).toBe(false);
    expect(
      canEditSheetField(room, { ...player, permissions: { characterBasics: true } }, character, 'owner', basic, [
        basic,
      ]),
    ).toBe(false);
  });
  it('历史 OWNER 血条、自定义上限标识和剧情字段仍由 GM 管理', () => {
    const fields: SheetField[] = [
      { fieldId: 'vital', name: '伤势', type: 'number', isResource: true, maxFieldId: 'limit', editableBy: 'OWNER' },
      { fieldId: 'limit', name: '承受上限', type: 'number', editableBy: 'OWNER' },
      { fieldId: 'story', name: '角色背景', type: 'text' },
      { fieldId: 'hp_max_2', name: '生命上限', type: 'number' },
    ];
    const authorized = { ...player, permissions: { characterValues: true, characterBasics: true } };
    for (const field of fields) {
      expect(gmManagedField(field, fields)).toBe(true);
      expect(canEditSheetField(room, authorized, character, 'owner', field, fields)).toBe(false);
      expect(canEditSheetField(room, { role: 'GM' }, character, 'other', field, fields)).toBe(true);
    }
  });
  it('单独显示的行动点同样仅 GM 可手动增减', () => {
    const field: SheetField = { fieldId: 'ap', name: '普通行动点', type: 'number', isResource: true };
    expect(gmManagedField(field, [field])).toBe(false);
    expect(
      canEditSheetField(room, { ...player, permissions: { characterValues: true } }, character, 'owner', field, [
        field,
      ]),
    ).toBe(false);
    expect(canEditSheetField(room, { role: 'GM' }, character, 'gm', field, [field])).toBe(true);
  });
});
