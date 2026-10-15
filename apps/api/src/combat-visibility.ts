import { object } from './data.js';

export function visibleCombatRecord<T extends { data: unknown }>(
  record: T,
  inventoryVisible: (id: string) => boolean,
): T {
  const data = object(record.data),
    contest = object(data.contest);
  if (!contest.attacker || !contest.defender) return record;
  const side = (input: any) =>
    inventoryVisible(input.id)
      ? input
      : {
          ...input,
          modifiers: input.modifiers.map((change: any) =>
            change.kind === 'equipment'
              ? {
                  name: '装备修正（来源不可见）',
                  amount: change.amount,
                  kind: change.kind,
                  ...(change.itemKind ? { itemKind: change.itemKind } : {}),
                }
              : change,
          ),
        };
  return {
    ...record,
    data: { ...data, contest: { ...contest, attacker: side(contest.attacker), defender: side(contest.defender) } },
  };
}
