import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { DEFAULT_RULES } from '@dnd/shared';
import { combatDraftInputs, consumeCombatDraft } from './combat-drafts.js';

function table() {
  const actor: any = {
    id: 'actor',
    roomId: 'room',
    ownerId: 'user',
    name: '游侠',
    visibility: 'PUBLIC',
    isNpc: false,
    avatarUrl: null,
    level: 1,
    attributes: {},
    formulas: [],
    traits: [],
    statuses: [],
    equipment: [],
    fieldValues: { dex: 17 },
  };
  const defender: any = { ...actor, id: 'target', name: '守卫', ownerId: 'other', fieldValues: { dex: 12 } };
  const stored: any = {
    id: 'draft-0001',
    roomId: 'room',
    userId: 'user',
    actorId: 'actor',
    targetId: 'target',
    revision: 2,
    eventId: 'event-0001',
    state: 'ACTIVE',
    privateRecord: false,
    expiresAt: new Date(Date.now() + 60000),
    fingerprint: '',
    adjudication: {
      contest: {
        version: 4,
        operationId: 'preview',
        attacker: { d20: 14, total: 16 },
        defender: { d20: 8, total: 8 },
        hit: true,
      },
    },
  };
  const fake = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    roomMember: { findUnique: vi.fn().mockResolvedValue({ role: 'PLAYER', permissions: {} }) },
    room: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        sheetMode: true,
        rules: DEFAULT_RULES,
        sheetSchema: [{ fieldId: 'dex', name: '敏捷', type: 'number', defaultValue: 15 }],
      }),
    },
    character: { findMany: vi.fn(async () => [actor, defender]) },
    combatDraft: { findUnique: vi.fn(async () => stored) },
  };
  const tx = fake as unknown as Prisma.TransactionClient;
  const args = {
    id: 'draft-0001',
    roomId: 'room',
    userId: 'user',
    actorId: 'actor',
    targetId: 'target',
    revision: 2,
    eventId: 'event-0001',
    privateRecord: false,
    operationId: 'saved-operation',
  };
  return { actor, defender, stored, fake, tx, args };
}
describe('两阶段敏捷判定的权威边界', () => {
  it('复用原骰点和结果，只将正式操作号绑定到独立副本', async () => {
    const t = table();
    t.stored.fingerprint = (await combatDraftInputs(t.tx, 'room', 'user', 'actor', 'target', false)).fingerprint;
    const result = await consumeCombatDraft(t.tx, t.args);
    expect(result.contest).toMatchObject({
      operationId: 'saved-operation',
      attacker: { d20: 14, total: 16 },
      defender: { d20: 8, total: 8 },
      hit: true,
    });
    expect(t.stored.adjudication.contest.operationId).toBe('preview');
  });
  it('相同加值区间内的有效敏捷变化也失效，不能悄悄沿用或补掷', async () => {
    const t = table();
    t.stored.fingerprint = (await combatDraftInputs(t.tx, 'room', 'user', 'actor', 'target', false)).fingerprint;
    t.actor.fieldValues.dex = 18;
    await expect(consumeCombatDraft(t.tx, t.args)).rejects.toMatchObject({ status: 409 });
    expect(t.stored.adjudication.contest.attacker.d20).toBe(14);
  });
  it('不能以智力草稿保存敏捷判定，或在版本不变时换成其他属性', async () => {
    const t = table();
    t.stored.adjudication.actorAttribute = '智力';
    await expect(consumeCombatDraft(t.tx, t.args)).rejects.toMatchObject({ status: 409 });
    await expect(consumeCombatDraft(t.tx, { ...t.args, actorAttribute: '力量' })).rejects.toMatchObject({
      status: 409,
    });
    expect(t.fake.character.findMany).not.toHaveBeenCalled();
  });
  it.each([
    ['state', 'CANCELED', 409],
    ['state', 'SAVED', 409],
    ['state', 'CLOSED', 409],
    ['expiresAt', new Date(0), 409],
    ['revision', 3, 409],
    ['eventId', 'old-event', 409],
    ['roomId', 'another-room', 403],
    ['userId', 'another-user', 403],
  ])('拒绝过期或错配草稿 %s=%s', async (key, value, status) => {
    const t = table();
    t.stored[key] = value;
    await expect(consumeCombatDraft(t.tx, t.args)).rejects.toMatchObject({ status });
    expect(t.fake.character.findMany).not.toHaveBeenCalled();
  });
  it('读取实时控制权限和隐藏范围，不接受已撤回的角色权限', async () => {
    const t = table();
    t.actor.ownerId = 'another-owner';
    await expect(combatDraftInputs(t.tx, 'room', 'user', 'actor', 'target', false)).rejects.toMatchObject({
      status: 403,
    });
    t.actor.ownerId = 'user';
    t.defender.visibility = 'GM';
    await expect(combatDraftInputs(t.tx, 'room', 'user', 'actor', 'target', false)).rejects.toMatchObject({
      status: 403,
    });
  });
});
