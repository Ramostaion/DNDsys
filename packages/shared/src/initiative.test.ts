import { describe, expect, it } from 'vitest';
import {
  calculateInitiative,
  initiativeFields,
  initiativeWeightErrors,
  normalizeInitiativeWeights,
  nextTurn,
  rebuildNextRound,
  recalculateTurn,
  sortInitiativeOrder,
  insertTurnParticipant,
  findNextUnactedActor,
  type InitiativeWeight,
  type TurnState,
} from './initiative.js';
import { calculateSheet, type SheetField } from './sheet.js';

const fields: SheetField[] = ['dex', 'sense', 'int', 'power'].map((fieldId) => ({
  fieldId,
  name: fieldId,
  type: 'number',
}));
const weights: InitiativeWeight[] = [40, 30, 20, 10].map((weight, i) => ({
  fieldId: fields[i].fieldId,
  weight,
  min: 0,
  max: 10,
  missing: 'BLOCK',
}));
const room = { sheetMode: true, sheetSchema: fields };
function calc(values: Record<string, unknown>, w = weights, config: unknown = {}) {
  return calculateInitiative(
    room,
    { fieldValues: values, derived: calculateSheet(fields, values), initiativeConfig: config },
    w,
  );
}
describe('先手权重：确定性计算与明确量表', () => {
  it('计算需求示例68，并保存各项贡献', () => {
    const result = calc({ dex: 8, sense: 6, int: 7, power: 4 });
    expect(result.score).toBe(68);
    expect(result.contributions.map((row) => row.contribution)).toEqual([32, 18, 14, 4]);
  });
  it('不同量表先归一化，负数与越界有明确边界', () => {
    const w = weights.map((row, i) => ({ ...row, min: i === 0 ? -10 : 0, max: i === 0 ? 10 : 100 }));
    const result = calc({ dex: 0, sense: 60, int: 70, power: 40 }, w);
    expect(result.score).toBe(56);
    const clamped = calc({ dex: 80, sense: 6, int: 7, power: -4 });
    expect(clamped.score).toBe(72);
    expect(clamped.warnings).toHaveLength(2);
  });
  it('自动归一化稳定，精度两位小数且总和100%', () => {
    const result = normalizeInitiativeWeights(weights.slice(0, 3).map((w) => ({ ...w, weight: 1 })));
    expect(result.map((w) => w.weight)).toEqual([33.34, 33.33, 33.33]);
    expect(initiativeWeightErrors(result)).toEqual([]);
    expect(() => normalizeInitiativeWeights(weights.map((w) => ({ ...w, weight: 0 })))).toThrow();
  });
  it('无模板和错误权重不允许计算', () => {
    expect(calculateInitiative(room, {}).valid).toBe(false);
    expect(initiativeWeightErrors([...weights, weights[0]])).toContain('参与属性不能重复');
    expect(initiativeWeightErrors(weights.map((w) => ({ ...w, weight: 20 })))).toContain('权重总和必须为100%');
    expect(initiativeWeightErrors([{ ...weights[0], weight: 100, min: 10, max: 10 }])).toContain(
      '每项量表上限必须大于下限',
    );
  });
  it('缺失默认阻止，贡献0或指定原值都不重分配权重', () => {
    const values = { sense: 6, int: 7, power: 4 };
    expect(calc(values).valid).toBe(false);
    expect(
      calc(
        values,
        weights.map((w) => ({ ...w, missing: 'ZERO' })),
      ).score,
    ).toBe(36);
    expect(
      calc(
        values,
        weights.map((w) => ({ ...w, missing: 'FIXED', fallback: 5 })),
      ).score,
    ).toBe(56);
  });
  it('非数值不可借缺省策略混入，公式错误也不能隐藏', () => {
    expect(
      calc(
        { dex: '8', sense: 6, int: 7, power: 4 },
        weights.map((w) => ({ ...w, missing: 'ZERO' })),
      ).valid,
    ).toBe(false);
    const formula = { ...fields[0], formula: '{{sense}}/0' };
    const result = calculateInitiative(
      { ...room, sheetSchema: [formula, ...fields.slice(1)] },
      { derived: { values: { sense: 6, int: 7, power: 4 }, errors: { dex: '不能除0' } } },
      weights,
    );
    expect(result.errors).toContain('dex计算失败');
  });
  it('人物自定义权重和修正优先全局', () => {
    const result = calc({ dex: 8, sense: 6, int: 7, power: 4 }, weights, {
      weights: [{ ...weights[2], weight: 100 }],
      bonus: -1,
    });
    expect(result.score).toBe(69);
    expect(result.source).toBe('CUSTOM');
  });
  it('自定义字段任意命名，旧卡不将合成默认属性冒充已填写', () => {
    const numeric = { attributes: { 意志: 30, 备注: '不能算' }, derived: { values: { 意志: 30, 敏捷: 10 } } };
    const available = initiativeFields({}, [numeric]);
    expect(available.map((f) => f.fieldId)).toEqual(['意志']);
    expect(
      calculateInitiative({}, numeric, [{ fieldId: '意志', weight: 100, min: 0, max: 60, missing: 'BLOCK' }], available)
        .score,
    ).toBe(50);
    expect(
      calculateInitiative(
        {},
        numeric,
        [{ fieldId: '敏捷', weight: 100, min: 0, max: 20, missing: 'BLOCK' }],
        [{ fieldId: '敏捷', name: '敏捷', type: 'number' }],
      ).valid,
    ).toBe(false);
  });
});
const state = (): TurnState => ({
  round: 1,
  totalRounds: null,
  currentCharacterId: 'a',
  status: 'ACTIVE',
  participants: ['a', 'b', 'c'].map((characterId) => ({
    characterId,
    tokenId: characterId,
    score: 1,
    calculation: calc({ dex: 8, sense: 6, int: 7, power: 4 }),
    firstRound: 1,
    lastActedRound: 0,
  })),
});
const finish = (s: TurnState, id: string) => {
  const next = nextTurn(s, id);
  return next.status === 'ACTIVE' && !next.currentCharacterId ? rebuildNextRound(next, next.participants) : next;
};
describe('正式Turn与完整Round', () => {
  it('只有全部人物完成才加轮，不修改原对象', () => {
    const original = state();
    const b = finish(original, 'a'),
      c = finish(b, 'b'),
      a = finish(c, 'c');
    expect([b.round, c.round, a.round]).toEqual([1, 1, 2]);
    expect([b.currentCharacterId, c.currentCharacterId, a.currentCharacterId]).toEqual(['b', 'c', 'a']);
    expect(original.participants[0].lastActedRound).toBe(0);
  });
  it('预计轮数结束停在LIMIT，保留会话', () => {
    let s = { ...state(), totalRounds: 1 };
    for (const id of ['a', 'b', 'c']) s = finish(s, id) as typeof s;
    expect(s).toMatchObject({ status: 'LIMIT', round: 1, currentCharacterId: null });
  });
  it('高级切换和重新排序不会忘记已完成行动', () => {
    let s = nextTurn(state(), 'a');
    s = { ...s, currentCharacterId: 'c', participants: [...s.participants].reverse() };
    s = nextTurn(s, 'c');
    expect(s.currentCharacterId).toBe('b');
    expect(s.round).toBe(1);
    expect(finish(s, 'b').round).toBe(2);
  });
  it('下轮加入者不会在本轮得到行动，空队列暂停等待', () => {
    let s = state();
    s.participants[1].firstRound = 2;
    s = nextTurn(s, 'a');
    expect(s.currentCharacterId).toBe('c');
    expect(finish(s, 'c').round).toBe(2);
    expect(nextTurn({ ...s, participants: [] }).status).toBe('PAUSED');
  });
});

const scored = (s: TurnState, scores: number[]) => s.participants.map((p, i) => ({ ...p, score: scores[i] }));
describe('轮次快照与权威重建', () => {
  it('旧轮结算绝不先选择旧首位，重建后90→60正确从B开始', () => {
    let s = state();
    s.participants = scored(s, [90, 85, 70]);
    s = nextTurn(nextTurn(nextTurn(s, 'a'), 'b'), 'c');
    expect(s).toMatchObject({ round: 1, currentCharacterId: null });
    const next = rebuildNextRound(s, scored(s, [60, 85, 70]));
    expect(next.participants.map((p) => p.characterId)).toEqual(['b', 'c', 'a']);
    expect(next).toMatchObject({ round: 2, currentCharacterId: 'b' });
    expect(next.participants.every((p) => p.lastActedRound === 0)).toBe(true);
  });
  it('最后一位变第一，单轮每个ID恰好一次', () => {
    let s = state();
    for (const actor of ['a', 'b', 'c']) s = nextTurn(s, actor);
    s = rebuildNextRound(s, scored(s, [90, 80, 100]));
    expect(s.currentCharacterId).toBe('c');
    const visited = [];
    while (s.currentCharacterId) {
      visited.push(s.currentCharacterId);
      s = nextTurn(s, s.currentCharacterId);
    }
    expect(visited).toEqual(['c', 'a', 'b']);
    expect(new Set(visited).size).toBe(3);
  });
  it('中途新属性不修改旧快照，下一轮才重建', () => {
    const s = nextTurn(state(), 'a'),
      fresh = scored(s, [90, 50, 70]);
    expect(s.participants.map((p) => p.characterId)).toEqual(['a', 'b', 'c']);
    expect(nextTurn(s, 'b').currentCharacterId).toBe('c');
    const next = rebuildNextRound(nextTurn(nextTurn(s, 'b'), 'c'), fresh);
    expect(next.participants.map((p) => p.characterId)).toEqual(['a', 'c', 'b']);
  });
  it('手动重算保留C当前回合，结束后选择排在前面的未行动D，不重复A/B', () => {
    let s = state();
    s.participants.push({ ...s.participants[0], characterId: 'd', tokenId: 'd' });
    s = nextTurn(nextTurn(s, 'a'), 'b');
    s = recalculateTurn(s, scored(s, [90, 70, 80, 100]));
    expect(s.participants.map((p) => p.characterId)).toEqual(['d', 'a', 'c', 'b']);
    expect(s.currentCharacterId).toBe('c');
    expect(findNextUnactedActor(s)?.characterId).toBe('d');
    s = nextTurn(s, 'c');
    expect(s.currentCharacterId).toBe('d');
    expect(nextTurn(s, 'd').currentCharacterId).toBeNull();
  });
  it('同分保留历史相对顺序，无历史时按稳定ID，不修改输入', () => {
    const s = state(),
      reverse = [...s.participants].reverse();
    expect(sortInitiativeOrder(reverse).map((p) => p.characterId)).toEqual(['a', 'b', 'c']);
    expect(sortInitiativeOrder(s.participants, reverse).map((p) => p.characterId)).toEqual(['c', 'b', 'a']);
    expect(s.participants.map((p) => p.characterId)).toEqual(['a', 'b', 'c']);
    expect(rebuildNextRound({ ...s, participants: reverse }, s.participants).currentCharacterId).toBe('c');
  });
  it('加入不重排已有人工顺序，新人同分排在已有同分之后', () => {
    const s = nextTurn(state(), 'a');
    s.participants = [s.participants[2], s.participants[0], s.participants[1]];
    const added = { ...s.participants[0], characterId: 'd', tokenId: 'd', score: 2, lastActedRound: 0 };
    const rows = insertTurnParticipant(s.participants, added);
    expect(rows.map((p) => p.characterId)).toEqual(['d', 'c', 'a', 'b']);
    expect(rows.find((p) => p.characterId === 'a')!.lastActedRound).toBe(1);
    expect(insertTurnParticipant(s.participants, { ...added, score: 1 }).at(-1)!.characterId).toBe('d');
  });
  it('单人物、轮数上限、暂停重建及空队列不无限推进', () => {
    const s = state();
    s.participants = s.participants.slice(0, 1);
    const settled = nextTurn(s, 'a');
    expect(rebuildNextRound(settled, scored(settled, [50]))).toMatchObject({ round: 2, currentCharacterId: 'a' });
    expect(rebuildNextRound({ ...settled, totalRounds: 1 }, settled.participants)).toMatchObject({
      status: 'LIMIT',
      round: 1,
      currentCharacterId: null,
    });
    expect(rebuildNextRound({ ...settled, status: 'PAUSED' }, settled.participants).status).toBe('PAUSED');
    expect(rebuildNextRound(settled, [])).toMatchObject({ status: 'PAUSED', round: 1, currentCharacterId: null });
  });
});
