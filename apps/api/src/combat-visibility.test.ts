import { expect, it } from 'vitest';
import { visibleCombatRecord, visibleModifier } from './combat-visibility.js';
it('隐藏状态在属性来源和正式对抗详情中只保留数值，不泄露名称或实例 ID', () => {
  const secret = { name: '秘密诅咒', amount: -3, kind: 'buff', instanceId: 'state:secret' };
  expect(visibleModifier(secret, () => false)).toEqual({ name: '状态修正（来源不可见）', amount: -3, kind: 'buff' });
  expect(visibleModifier(secret, () => true)).toBe(secret);
  const side = { id: 'character', modifiers: [secret] };
  const result = visibleCombatRecord({ data: { contest: { attacker: side, defender: side } } }, () => true);
  expect(JSON.stringify(result)).not.toContain('秘密诅咒');
  expect(JSON.stringify(result)).not.toContain('state:secret');
});
