import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_RULES } from '@dnd/shared';
import type { Prisma } from '@prisma/client';
import { adjudicateAgility } from './agility-service.js';

function table() {
  const room = {
    id: 'room',
    sheetMode: true,
    rules: DEFAULT_RULES,
    sheetSchema: [{ fieldId: 'dex', name: '敏捷', type: 'number', defaultValue: 10 }],
  };
  const actor: any = {
    id: 'a',
    roomId: 'room',
    name: '亚瑟',
    isNpc: false,
    visibility: 'PUBLIC',
    level: 1,
    attributes: {},
    formulas: [],
    traits: [],
    statuses: [],
    fieldValues: { dex: 14 },
    room,
    derived: { values: { dex: 9999 } },
    equipment: [
      {
        id: 'ring',
        entry: { item: { name: '灵巧戒指', kind: '饰品', data: { customFields: [{ name: '敏捷', value: 3 }] } } },
      },
    ],
  };
  const defender: any = {
    ...actor,
    id: 'b',
    name: '哥布林',
    isNpc: true,
    fieldValues: { dex: 11 },
    equipment: [
      {
        id: 'armor',
        entry: { item: { name: '轻甲', kind: '装备', data: { customFields: [{ name: '敏捷', value: 1 }] } } },
      },
    ],
  };
  const characters = { a: actor, b: defender };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    room: { findUniqueOrThrow: vi.fn().mockResolvedValue(room) },
    character: {
      findUniqueOrThrow: vi.fn(async ({ where }: any) => characters[where.id as 'a' | 'b']),
      findFirstOrThrow: vi.fn(async ({ where }: any) => characters[where.id as 'a' | 'b']),
      update: vi.fn(async ({ where, data }: any) => Object.assign(characters[where.id as 'a' | 'b'], data)),
    },
  } as unknown as Prisma.TransactionClient;
  return {
    tx,
    actor,
    defender,
    room,
    args: { roomId: 'room', actorId: 'a', targetId: 'b', operationId: 'op', isGM: true, privateRecord: false },
  };
}
describe('服务器敏捷声明判定', () => {
  it('铁傀儡对冒险家：2 基础加 2 戒指敏捷，加值 -3 加骰子 5 得 2，负总值按 1', async () => {
    const t = table();
    Object.assign(t.actor, { name: '铁傀儡', isNpc: true, fieldValues: { dex: 6 }, equipment: [] });
    Object.assign(t.defender, { name: '冒险家', isNpc: false, fieldValues: { dex: 2 } });
    t.defender.equipment[0].entry.item = {
      name: '敏捷戒指',
      kind: '饰品',
      data: { customFields: [{ name: '敏捷', value: 2 }] },
    };
    const result = (await adjudicateAgility(t.tx, t.args, vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(5)))
      .contest!;
    expect(result).toMatchObject({
      version: 4,
      hit: false,
      attacker: { name: '铁傀儡', effective: 6, bonus: -2, d20: 1, total: 1 },
      defender: { name: '冒险家', base: 2, effective: 4, bonus: -3, d20: 5, total: 2 },
      comparison: '1 < 2',
      message: '玩家冒险家成功闪避了铁傀儡的攻击！',
    });
    expect(result.defender.modifiers[0]).toMatchObject({ name: '敏捷戒指', amount: 2 });
  });
  it('重新读取统一数值引擎、独立两次 D20、加值加骰子得最终值', async () => {
    const t = table(),
      random = vi.fn().mockReturnValueOnce(12).mockReturnValueOnce(15);
    const result = (await adjudicateAgility(t.tx, t.args, random)).contest!;
    expect(random.mock.calls).toEqual([[20], [20]]);
    expect(result).toMatchObject({
      version: 4,
      hit: false,
      attacker: { base: 14, effective: 17, bonus: 2, d20: 12, total: 14 },
      defender: { base: 11, effective: 12, bonus: 0, d20: 15, total: 15 },
    });
    expect(result.attacker.modifiers[0]).toMatchObject({ name: '灵巧戒指', amount: 3, itemKind: '饰品' });
    t.actor.equipment = [];
    t.actor.fieldValues.dex = 8;
    t.actor.statuses = [{ id: 'slow', name: '束缚', modifiers: { dex: -12 } }];
    const next = (await adjudicateAgility(t.tx, t.args, () => 10)).contest!;
    expect(next.attacker).toMatchObject({ base: 8, rawEffective: -4, effective: 1, bonus: -4 });
    expect(result.attacker.effective).toBe(17);
    t.actor.statuses[0].enabled = false;
    expect((await adjudicateAgility(t.tx, t.args, () => 10)).contest!.attacker.effective).toBe(8);
  });
  it('缺少目标、相同角色、缺失或非法属性不掷骰；失败不编造点数', async () => {
    const t = table(),
      random = vi.fn(() => 10);
    expect((await adjudicateAgility(t.tx, { ...t.args, targetId: undefined }, random)).skippedReason).toContain('目标');
    expect((await adjudicateAgility(t.tx, { ...t.args, targetId: 'a' }, random)).skippedReason).toContain('相同');
    t.actor.fieldValues.dex = '';
    expect((await adjudicateAgility(t.tx, t.args, random)).skippedReason).toContain('无效');
    expect(random).not.toHaveBeenCalled();
    t.actor.fieldValues.dex = 14;
    await expect(
      adjudicateAgility(t.tx, t.args, () => {
        throw new Error('随机服务失败');
      }),
    ).rejects.toThrow('随机服务失败');
  });
  it('私密属性/隐藏角色保持 GM 范围，玩家不能借判定读取私密数值', async () => {
    const t = table();
    Object.assign(t.room.sheetSchema[0], { visibility: 'GM' });
    const random = vi.fn(() => 10);
    expect((await adjudicateAgility(t.tx, { ...t.args, isGM: false }, random)).skippedReason).toContain('公开');
    expect(random).not.toHaveBeenCalled();
    expect((await adjudicateAgility(t.tx, t.args, random)).contest!.broadcast.scope).toBe('GM');
  });
});
