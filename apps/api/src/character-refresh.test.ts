import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { DEFAULT_RULES } from '@dnd/shared';
import { characterDerived, refreshCharacter } from './character-values.js';

describe('人物属性重算写入', () => {
  const base = {
    level: 1,
    attributes: { 法伤: 23 },
    formulas: [],
    traits: [],
    statuses: [],
    equipment: [],
    fieldValues: {},
    room: { sheetSchema: [], sheetMode: false },
  };
  function transaction(derived: unknown) {
    const update = vi.fn();
    const tx = {
      character: { findUniqueOrThrow: vi.fn().mockResolvedValue({ ...base, derived }), update },
    };
    return { tx: tx as unknown as Prisma.TransactionClient, update };
  }
  it('已有数值、来源和错误一致时不重复写数据库', async () => {
    const derived = characterDerived(base, DEFAULT_RULES);
    const { tx, update } = transaction(JSON.parse(JSON.stringify(derived)));
    expect(await refreshCharacter(tx, 'test-character', DEFAULT_RULES)).toEqual(derived);
    expect(update).not.toHaveBeenCalled();
  });
  it('旧数值或来源有变化时仍持久化完整重算结果', async () => {
    const { tx, update } = transaction({ values: { 法伤: 18 }, sources: {}, errors: {} });
    const derived = await refreshCharacter(tx, 'test-character', DEFAULT_RULES);
    expect(derived.values.法伤).toBe(23);
    expect(update).toHaveBeenCalledWith({ where: { id: 'test-character' }, data: { derived } });
  });
});
