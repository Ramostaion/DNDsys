import { describe, it, expect } from 'vitest';
import { characterHealth, characterShield } from './character-summary';
import { withShieldFields } from '@dnd/shared';
import type { Snapshot } from '../api';
describe('地图人物生命摘要', () => {
  it('可见的自定义血条显示详情，缺失或被隐藏的上限不使用默认值推测', () => {
    const snap = {
      room: {
        sheetMode: true,
        sheetSchema: [{ fieldId: 'life', isResource: true, maxFieldId: 'limit', defaultValue: 20 }],
      },
    } as unknown as Snapshot;
    expect(characterHealth(snap, { derived: { values: { life: 12, limit: 20 } } })).toEqual({
      current: 12,
      maximum: 20,
      percent: 60,
    });
    expect(characterHealth(snap, { derived: { values: { life: 12 } } })).toBeNull();
    expect(characterHealth(snap, { derived: { values: { life: 12, limit: 0 } } })?.percent).toBe(0);
  });
  it('保留旧版角色血量摘要，进度限制在正常范围', () => {
    const snap = { room: { sheetMode: false } } as Snapshot;
    expect(characterHealth(snap, { currentHp: 30, derived: { values: { 血量上限: 20 } } })).toEqual({
      current: 30,
      maximum: 20,
      percent: 100,
    });
    expect(characterHealth(snap, { currentHp: -1, derived: { values: { 血量上限: 20 } } })?.percent).toBe(0);
  });
  it('护盾使用独立可见数值，旧卡同样支持；隐藏上限时不推测数值', () => {
    for (const sheetMode of [true, false]) {
      const snap = { room: { sheetMode, sheetSchema: withShieldFields([]) } } as Snapshot;
      expect(characterShield(snap, { derived: { values: { dnd_shield: 5, dnd_shield_max: 20 } } })).toEqual({
        current: 5,
        maximum: 20,
        percent: 25,
      });
      expect(characterShield(snap, { derived: { values: { dnd_shield: 5 } } })).toBeNull();
      if (sheetMode)
        expect(characterHealth(snap, { derived: { values: { dnd_shield: 5, dnd_shield_max: 20 } } })).toBeNull();
    }
  });
});
