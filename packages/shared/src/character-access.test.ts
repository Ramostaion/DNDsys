import { describe, it, expect } from 'vitest';
import {
  canControlCharacter,
  canViewCharacterInventory,
  canLootCharacterInventory,
  canExchangeWithFallenCharacter,
  characterCurrentHealth,
} from './character-access.js';

const player = { role: 'PLAYER', permissions: {} },
  gm = { role: 'GM' };
const character = { ownerId: 'owner', visibility: 'PUBLIC', isNpc: false };
describe('角色控制与物品查看', () => {
  it('其他归零角色与本人存活角色可双向取放，不能借此操作本人归零、其他存活角色或 NPC', () => {
    const fallen = { ...character, id: 'fallen', healthCurrent: 0 },
      own = { ...character, id: 'own', ownerId: 'other', healthCurrent: 10 };
    expect(canExchangeWithFallenCharacter(player, fallen, own, 'other')).toBe(true);
    expect(canExchangeWithFallenCharacter(player, own, fallen, 'other')).toBe(true);
    expect(canExchangeWithFallenCharacter(player, fallen, fallen, 'other')).toBe(true);
    for (const blocked of [
      { ...own, healthCurrent: 0 },
      { ...own, ownerId: 'third' },
      { ...own, isNpc: true },
      { ...own, visibility: 'GM' },
    ]) {
      expect(canExchangeWithFallenCharacter(player, fallen, blocked, 'other')).toBe(false);
      expect(canExchangeWithFallenCharacter(player, blocked, fallen, 'other')).toBe(false);
    }
    expect(canExchangeWithFallenCharacter(player, own, { ...fallen, healthCurrent: 1 }, 'other')).toBe(false);
    expect(canExchangeWithFallenCharacter(player, fallen, own, 'owner')).toBe(false);
    expect(
      canExchangeWithFallenCharacter(gm, fallen, { ...own, isNpc: true, visibility: 'GM', healthCurrent: 0 }, 'owner'),
    ).toBe(true);
  });
  it('玩家归零时禁止本人查看，其他玩家可拾取，但 NPC、私密与未配置生命不解锁拾取', () => {
    const fallen = { ...character, healthCurrent: 0 };
    expect(canViewCharacterInventory(player, fallen, 'owner', true)).toBe(false);
    expect(canViewCharacterInventory(player, fallen, 'other')).toBe(true);
    expect(canLootCharacterInventory(player, fallen, 'other')).toBe(true);
    expect(canLootCharacterInventory(player, fallen, 'owner')).toBe(false);
    expect(canViewCharacterInventory(gm, fallen, 'owner')).toBe(true);
    for (const patch of [
      { healthCurrent: 1 },
      { healthCurrent: null },
      { healthCurrent: NaN },
      { visibility: 'GM' },
      { isNpc: true },
      { ownerId: null },
    ])
      expect(canLootCharacterInventory(player, { ...fallen, ...patch }, 'other')).toBe(false);
    expect(canLootCharacterInventory(undefined, fallen, 'other')).toBe(false);
  });
  it('玩家只能控制自己的角色，GM 明确授权后可控制其他玩家角色', () => {
    expect(canControlCharacter(player, character, 'owner')).toBe(true);
    expect(canControlCharacter(player, character, 'other')).toBe(false);
    expect(canControlCharacter({ ...player, permissions: { editAllCharacters: true } }, character, 'other')).toBe(true);
    expect(canControlCharacter({ ...player, permissions: { editAllCharacters: false } }, character, 'other')).toBe(
      false,
    );
  });
  it('NPC 与隐藏角色始终只允许 GM 控制', () => {
    const authorized = { ...player, permissions: { editAllCharacters: true } };
    expect(canControlCharacter(authorized, { ...character, isNpc: true }, 'owner')).toBe(false);
    expect(canControlCharacter(authorized, { ...character, visibility: 'GM' }, 'owner')).toBe(false);
    expect(canControlCharacter(gm, { ...character, isNpc: true, visibility: 'GM' }, 'other')).toBe(true);
  });
  it('物品查看独立授权，编辑人物卡不自动授予查看其他背包', () => {
    expect(canViewCharacterInventory(player, character, 'owner')).toBe(true);
    expect(canViewCharacterInventory({ ...player, permissions: { editAllCharacters: true } }, character, 'other')).toBe(
      false,
    );
    expect(canViewCharacterInventory(player, character, 'other', true)).toBe(true);
    expect(canControlCharacter(player, character, 'other')).toBe(false);
    expect(canViewCharacterInventory(player, { ...character, visibility: 'GM' }, 'other', true)).toBe(false);
  });
  it('NPC 只有归零且允许搜索才能查看，查看不授予控制权限', () => {
    const npc = { ...character, isNpc: true, allowSearch: true, healthCurrent: 0 };
    expect(canViewCharacterInventory(player, npc, 'other')).toBe(true);
    expect(canControlCharacter(player, npc, 'other')).toBe(false);
    for (const blocked of [
      { healthCurrent: 1 },
      { healthCurrent: null },
      { healthCurrent: NaN },
      { allowSearch: false },
      { visibility: 'GM' },
    ]) {
      expect(canViewCharacterInventory(player, { ...npc, ...blocked }, 'other', true)).toBe(false);
      expect(canViewCharacterInventory(gm, { ...npc, ...blocked }, 'other')).toBe(true);
    }
  });
  it('自定义血条使用有效资源值，缺失血条不按旧 HP 的零值解锁', () => {
    const room = { sheetMode: true, sheetSchema: [{ fieldId: 'hp', isResource: true, maxFieldId: 'max' }] };
    expect(characterCurrentHealth(room, { currentHp: 0, derived: { values: { hp: 8, max: 20 } } })).toBe(8);
    expect(characterCurrentHealth(room, { currentHp: 10, derived: { values: { hp: 0, max: 20 } } })).toBe(0);
    expect(characterCurrentHealth({ ...room, sheetSchema: [] }, { currentHp: 0 })).toBeNull();
    expect(characterCurrentHealth({ sheetMode: false }, { currentHp: 0 })).toBe(0);
  });
});
