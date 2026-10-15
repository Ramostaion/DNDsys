import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgilityContest, ContestParticipant } from '@dnd/shared';
import AgilityResult from './AgilityResult';

const attacker: ContestParticipant = {
  id: 'a',
  name: '亚瑟',
  isNpc: false,
  fieldId: 'dex',
  base: 14,
  modifiers: [{ name: '戒指', amount: 3 }],
  rawEffective: 17,
  effective: 17,
  bonus: 2,
  visibility: 'ALL',
  d20: 12,
  total: 14,
};
const contest: AgilityContest = {
  version: 4,
  operationId: 'op',
  resolvedAt: '2026-10-14T10:00:00Z',
  attacker,
  defender: {
    ...attacker,
    id: 'b',
    name: '守卫',
    isNpc: true,
    base: 11,
    modifiers: [{ name: '轻甲', amount: 1 }],
    rawEffective: 12,
    effective: 12,
    bonus: 0,
    d20: 15,
    total: 15,
  },
  hit: false,
  comparison: '14 < 15',
  reason: '防御方最终判定值高于攻击方，因此成功闪避。',
  message: '守卫成功闪避了亚瑟的攻击！',
  broadcast: { scope: 'ROOM', status: 'SENT' },
};

it('新记录显示加值加骰子，最终值最低为 1', () => {
  const html = renderToStaticMarkup(<AgilityResult contest={contest} recordId="new" />);
  expect(html).toContain('MAX(1, 2 + 12) = <strong>14</strong>');
  expect(html).toContain('判定值 = MAX(1, 敏捷属性加值 + D20)。');
  expect(html).toContain('MAX(1, 14 + 3) = 17');
  expect(html).toContain('成功闪避');
});

it('冒险家有效敏捷 4、加值 -3，加骰子 5 展示 2', () => {
  const example = {
    ...contest,
    defender: {
      ...attacker,
      name: '冒险家',
      base: 2,
      modifiers: [{ name: '戒指', amount: 2 }],
      rawEffective: 4,
      effective: 4,
      bonus: -3,
      d20: 5,
      total: 2,
    },
  };
  const html = renderToStaticMarkup(<AgilityResult contest={example} recordId="example" />);
  expect(html).toContain('MAX(1, 2 + 2) = 4');
  expect(html).toContain('MAX(1, -3 + 5) = <strong>2</strong>');
  expect(html).not.toContain('判定底值');
});

it.each([1, 3])('加值 -3 加骰子 %s 得负数或零，说明为何按 1 计算', (d20) => {
  const example = { ...contest, attacker: { ...attacker, effective: 4, bonus: -3, d20, total: 1 } };
  const html = renderToStaticMarkup(<AgilityResult contest={example} recordId="clamped" />);
  expect(html).toContain(`MAX(1, -3 + ${d20}) = <strong>1</strong>`);
  expect(html).toContain(`计算结果 ${-3 + d20} ≤ 0，按 1 计算。`);
});

it('中途有效敏捷加加值版本的历史仍显示当时公式，不改写', () => {
  const old: AgilityContest = {
    ...contest,
    version: 3,
    attacker: { ...attacker, total: 31 },
    defender: { ...contest.defender, total: 27 },
    hit: true,
    comparison: '31 > 27',
  };
  const html = renderToStaticMarkup(<AgilityResult contest={old} recordId="old-combined" />);
  expect(html).toContain('判定底值：17 + 2 = 19');
  expect(html).toContain('19 + 12 = <strong>31</strong>');
  expect(html).toContain('历史规则：判定值 = 有效敏捷 + 敏捷属性加值 + D20。');
});

it('上一轮只用属性加值的记录保留原公式和结果', () => {
  const old: AgilityContest = {
    ...contest,
    version: 2,
    attacker: { ...attacker, total: 14 },
    defender: { ...contest.defender, total: 15 },
    hit: false,
    comparison: '14 < 15',
  };
  const html = renderToStaticMarkup(<AgilityResult contest={old} recordId="old-bonus" />);
  expect(html).toContain('2 + 12 = <strong>14</strong>');
  expect(html).toContain('历史规则：判定值 = 敏捷属性加值 + D20。');
  expect(html).not.toContain('判定底值');
});

it('旧版记录继续展示保存的完整敏捷公式与命中结果，不重算历史', () => {
  const old: AgilityContest = {
    ...contest,
    version: 1,
    attacker: { ...attacker, total: 29 },
    defender: { ...contest.defender, total: 27 },
    hit: true,
    comparison: '29 > 27',
    reason: '攻击方最终判定值高于防御方，因此攻击命中。',
  };
  const html = renderToStaticMarkup(<AgilityResult contest={old} recordId="old" />);
  expect(html).toContain('17 + 12 = <strong>29</strong>');
  expect(html).toContain('历史规则：判定值 = 完整有效敏捷 + D20。');
  expect(html).toContain('攻击命中');
  expect(html).not.toContain('2 + 12 = <strong>14</strong>');
});
