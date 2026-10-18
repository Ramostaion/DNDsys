import { object } from './data.js';

export function visibleModifier(change: any, stateVisible: (id: string) => boolean) {
  return typeof change.instanceId === 'string' &&
    change.instanceId.startsWith('state:') &&
    !stateVisible(change.instanceId.slice(6))
    ? { name: '状态修正（来源不可见）', amount: change.amount, kind: change.kind }
    : change;
}

export function visibleCombatRecord<T extends { data: unknown }>(
  record: T,
  inventoryVisible: (id: string) => boolean,
  stateVisible: (id: string) => boolean = () => false,
): T {
  const data = object(record.data),
    contest = object(data.contest);
  if (!contest.attacker || !contest.defender) return record;
  const side = (input: any) => ({
    ...input,
    modifiers: input.modifiers.map((change: any) =>
      change.kind === 'equipment' && !inventoryVisible(input.id)
        ? {
            name: '装备修正（来源不可见）',
            amount: change.amount,
            kind: change.kind,
            ...(change.itemKind ? { itemKind: change.itemKind } : {}),
          }
        : visibleModifier(change, stateVisible),
    ),
  });
  return {
    ...record,
    data: { ...data, contest: { ...contest, attacker: side(contest.attacker), defender: side(contest.defender) } },
  };
}
