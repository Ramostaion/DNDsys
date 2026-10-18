import type { SheetField, ValueBreakdown } from './sheet.js';

export type AgilitySnapshot = {
  attributeName?: string;
  fieldId: string;
  base: number;
  modifiers: ValueBreakdown['changes'];
  rawEffective: number;
  effective: number;
  bonus: number;
  visibility: 'ALL' | 'OWNER' | 'GM';
};
export type ContestParticipant = AgilitySnapshot & {
  id: string;
  name: string;
  isNpc: boolean;
  d20: number;
  total: number;
};
export type AgilityContest = {
  version: 1 | 2 | 3 | 4;
  operationId: string;
  resolvedAt: string;
  attacker: ContestParticipant;
  defender: ContestParticipant;
  hit: boolean;
  comparison: string;
  reason: string;
  message: string;
  broadcast: { scope: 'ROOM' | 'GM'; status: 'PENDING' | 'SENT' | 'FAILED'; sentAt?: string };
};
export type CombatBroadcast = {
  version?: AgilityContest['version'];
  roomId: string;
  recordId: string;
  operationId: string;
  createdAt: string;
  serverNow: number;
  message: string;
  hit: boolean;
  attacker: { name: string; d20: number; effective: number; bonus?: number; total: number; attributeName?: string };
  defender: { name: string; d20: number; effective: number; bonus?: number; total: number; attributeName?: string };
};
export const contestAttributes = ['敏捷', '力量', '体质', '智力', '感知', '魅力'] as const;

export function agilityBonus(value: number) {
  if (!Number.isFinite(value) || value < 0) throw new Error('敏捷数值无效');
  if (value > 20) return 4 + Math.floor((value - 21) / 2);
  if (value <= 2) return -4;
  if (value <= 4) return -3;
  if (value <= 6) return -2;
  if (value <= 9) return -1;
  if (value <= 12) return 0;
  if (value <= 15) return 1;
  if (value <= 18) return 2;
  return 3;
}

/** Versioned operands keep saved historical formulas intact. */
export function agilityContestBase(side: { effective: number; bonus?: number }, version?: AgilityContest['version']) {
  if (version === 3) return side.effective + (side.bonus ?? 0);
  return version === 2 || version === 4 ? (side.bonus ?? 0) : side.effective;
}

export function characterAttribute(
  character: {
    attributes?: unknown;
    fieldValues?: unknown;
    derived?: {
      values?: Record<string, unknown>;
      errors?: Record<string, unknown>;
      breakdown?: Record<string, ValueBreakdown>;
    };
  },
  fields: SheetField[],
  sheetMode: boolean,
  attributeName = '敏捷',
): { agility?: AgilitySnapshot; reason?: string } {
  const matches = fields.filter((field) => field.name.trim() === attributeName);
  if (sheetMode && matches.length !== 1)
    return { reason: matches.length ? `存在多个${attributeName}词条，无法唯一关联` : `缺少${attributeName}词条` };
  const field = sheetMode ? matches[0] : undefined;
  if (field && field.type !== 'number') return { reason: `${attributeName}词条不是数值字段` };
  const id = field?.fieldId || attributeName;
  const raw = (sheetMode ? character.fieldValues : character.attributes) as Record<string, unknown> | undefined;
  const base = field?.formula ? character.derived?.breakdown?.[id]?.base : (raw?.[id] ?? field?.defaultValue);
  const value = character.derived?.values?.[id];
  if (
    typeof base !== 'number' ||
    !Number.isFinite(base) ||
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    character.derived?.errors?.[id]
  )
    return { reason: base === undefined ? `${attributeName}词条没有设置数值` : `${attributeName}数据无效或计算失败` };
  const effective = Math.max(1, value);
  const modifiers = [...(character.derived?.breakdown?.[id]?.changes || [])];
  const residual = value - base - modifiers.reduce((sum, change) => sum + change.amount, 0);
  if (Math.abs(residual) > 1e-9) modifiers.push({ name: '字段公式或其它计算', amount: residual, kind: 'custom' });
  return {
    agility: {
      ...(attributeName !== '敏捷' ? { attributeName } : {}),
      fieldId: id,
      base,
      modifiers,
      rawEffective: value,
      effective,
      bonus: agilityBonus(effective),
      visibility: field?.visibility || 'ALL',
    },
  };
}

export function characterAgility(
  character: Parameters<typeof characterAttribute>[0],
  fields: SheetField[],
  sheetMode: boolean,
) {
  return characterAttribute(character, fields, sheetMode);
}

export function resolveAgilityContest(
  attacker: Omit<ContestParticipant, 'total'>,
  defender: Omit<ContestParticipant, 'total'>,
) {
  for (const side of [attacker, defender]) {
    if (
      !Number.isInteger(side.d20) ||
      side.d20 < 1 ||
      side.d20 > 20 ||
      !Number.isFinite(side.effective) ||
      side.effective < 1
    )
      throw new Error('对抗点数无效');
  }
  const bonusA = agilityBonus(attacker.effective),
    bonusB = agilityBonus(defender.effective);
  const a = { ...attacker, bonus: bonusA, total: Math.max(1, bonusA + attacker.d20) },
    b = { ...defender, bonus: bonusB, total: Math.max(1, bonusB + defender.d20) };
  const hit = a.total > b.total;
  const comparison = `${a.total} ${hit ? '>' : a.total === b.total ? '=' : '<'} ${b.total}`;
  const reason = hit
    ? '攻击方最终判定值高于防御方，因此攻击命中。'
    : a.total === b.total
      ? '双方最终判定值相等，防御方获得判定优势，成功闪避。'
      : '防御方最终判定值高于攻击方，因此成功闪避。';
  const label = (side: { name: string; isNpc: boolean }) => `${side.isNpc ? '' : '玩家'}${side.name}`;
  const message = hit ? `${label(a)}命中了${label(b)}！` : `${label(b)}成功闪避了${a.name}的攻击！`;
  return { attacker: a, defender: b, hit, comparison, reason, message };
}
