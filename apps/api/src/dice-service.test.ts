import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma, RoomMember } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { recordFreeRoll } from './dice-service.js';

vi.mock('node:crypto', () => ({ randomInt: vi.fn(() => 4) }));
afterEach(() => vi.restoreAllMocks());
function fixture(privateRoll = false) {
  vi.spyOn(Date, 'now').mockReturnValue(10_000);
  vi.mocked(randomInt).mockClear();
  const room = { publicDiceAvailableAt: new Date(11_000) };
  const db = {
    room: { findUniqueOrThrow: vi.fn(async () => room), update: vi.fn() },
    user: { findUniqueOrThrow: vi.fn(async () => ({ username: '真实名称' })) },
    diceRoll: { create: vi.fn(async ({ data }) => ({ id: 'record', ...data })) },
  };
  const args = {
    roomId: 'room',
    userId: 'actor',
    member: { role: 'GM' } as RoomMember,
    expression: '2d6+3',
    reason: '',
    visibility: privateRoll ? 'PRIVATE' : 'PUBLIC',
  };
  return { db, tx: db as unknown as Prisma.TransactionClient, args, room };
}
describe('公开骰事务与身份快照', () => {
  it('冷却先拒绝，不调用随机数，不生成记录或改变截止时间', async () => {
    const { tx, db, args } = fixture();
    await expect(recordFreeRoll(tx, args)).rejects.toMatchObject({
      status: 429,
      code: 'DICE_COOLDOWN',
      remainingMs: 1000,
      cooldownUntil: 11_000,
      serverNow: 10_000,
    });
    expect(randomInt).not.toHaveBeenCalled();
    expect(db.diceRoll.create).not.toHaveBeenCalled();
    expect(db.room.update).not.toHaveBeenCalled();
  });
  it('截止时间恰好到期即可掷骰，名称和身份来自数据库与成员', async () => {
    const { tx, db, args, room } = fixture();
    room.publicDiceAvailableAt = new Date(10_000);
    const result = await recordFreeRoll(tx, args);
    expect(result).toMatchObject({ rollerName: '真实名称', rollerRole: 'GM', total: 11, cooldownUntil: 12_000 });
    expect(result.details).toMatchObject([{ rolls: [4, 4] }, { value: 3 }]);
    expect(db.room.update).toHaveBeenCalledWith({
      where: { id: 'room' },
      data: { publicDiceAvailableAt: new Date(12_000) },
    });
  });
  it('无效表达式不占用冷却、不保存骰子', async () => {
    const { tx, db, args, room } = fixture();
    room.publicDiceAvailableAt = new Date(0);
    await expect(recordFreeRoll(tx, { ...args, expression: '1d1001' })).rejects.toMatchObject({ status: 400 });
    expect(db.diceRoll.create).not.toHaveBeenCalled();
    expect(db.room.update).not.toHaveBeenCalled();
  });
  it('冷却期到来的请求即使等锁至到期也不会排队掷骰', async () => {
    const { tx, db, args } = fixture();
    vi.mocked(Date.now).mockReturnValue(12_000);
    await expect(recordFreeRoll(tx, { ...args, requestedAt: 10_500 })).rejects.toMatchObject({
      status: 429,
      remainingMs: 0,
    });
    expect(randomInt).not.toHaveBeenCalled();
    expect(db.diceRoll.create).not.toHaveBeenCalled();
  });
  it('私密骰不读取、不返回、不改变公开冷却', async () => {
    const { tx, db, args } = fixture(true);
    const result = await recordFreeRoll(tx, args);
    expect(result).toMatchObject({ visibility: 'PRIVATE', total: 11 });
    expect(result).not.toHaveProperty('cooldownUntil');
    expect(db.room.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(db.room.update).not.toHaveBeenCalled();
  });
});
