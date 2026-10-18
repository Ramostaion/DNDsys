import type { SheetField } from './sheet.js';

export type InitiativeWeight = {
  fieldId: string;
  weight: number;
  min: number;
  max: number;
  missing: 'BLOCK' | 'ZERO' | 'FIXED';
  fallback?: number;
};
export type InitiativeConfig = { weights?: InitiativeWeight[]; bonus?: number };
export type InitiativeCalculation = {
  valid: boolean;
  score?: number;
  bonus: number;
  source: 'GLOBAL' | 'CUSTOM';
  errors: string[];
  warnings: string[];
  contributions: {
    fieldId: string;
    name: string;
    raw: number | null;
    min: number;
    max: number;
    normalized: number;
    weight: number;
    contribution: number;
    missing: boolean;
  }[];
};
const record = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function initiativeWeightErrors(weights: InitiativeWeight[]): string[] {
  const errors: string[] = [];
  if (!Array.isArray(weights) || weights.length < 1 || weights.length > 50) return ['请选择1–50项数值属性'];
  if (new Set(weights.map((w) => w.fieldId)).size !== weights.length) errors.push('参与属性不能重复');
  let sum = 0;
  for (const w of weights) {
    if (!w.fieldId) errors.push('请选择属性');
    if (
      !finite(w.weight) ||
      w.weight < 0 ||
      w.weight > 100 ||
      Math.abs(w.weight * 100 - Math.round(w.weight * 100)) > 1e-6
    )
      errors.push('权重需为0–100%的数值，最多两位小数');
    else sum += Math.round(w.weight * 100);
    if (!finite(w.min) || !finite(w.max) || w.max <= w.min) errors.push('每项量表上限必须大于下限');
    if (!['BLOCK', 'ZERO', 'FIXED'].includes(w.missing) || (w.missing === 'FIXED' && !finite(w.fallback)))
      errors.push('请设置有效的属性缺失策略');
  }
  if (sum !== 10000) errors.push('权重总和必须为100%');
  return [...new Set(errors)];
}
export function normalizeInitiativeWeights(weights: InitiativeWeight[]): InitiativeWeight[] {
  const sum = weights.reduce((s, w) => s + (finite(w.weight) && w.weight >= 0 ? w.weight : 0), 0);
  if (!sum) throw new Error('至少一项权重必须大于0');
  const rows = weights.map((w, i) => {
    const exact = ((finite(w.weight) ? Math.max(0, w.weight) : 0) / sum) * 10000;
    return { i, units: Math.floor(exact), remainder: exact % 1 };
  });
  const left = 10000 - rows.reduce((s, r) => s + r.units, 0);
  for (const row of [...rows].sort((a, b) => b.remainder - a.remainder || a.i - b.i).slice(0, left)) row.units++;
  return weights.map((w, i) => ({ ...w, weight: rows[i].units / 100 }));
}
export function initiativeFields(
  room: { sheetMode?: boolean; sheetSchema?: unknown },
  characters: { attributes?: unknown; formulas?: unknown; derived?: unknown }[] = [],
): SheetField[] {
  if (room.sheetMode)
    return (Array.isArray(room.sheetSchema) ? (room.sheetSchema as SheetField[]) : []).filter(
      (f) => f.type === 'number',
    );
  const names = new Set<string>();
  for (const c of characters) {
    for (const [key, value] of Object.entries(record(c.attributes))) if (finite(value)) names.add(key);
    for (const formula of Array.isArray(c.formulas) ? c.formulas : [])
      if (typeof formula?.key === 'string' && finite(record(record(c.derived).values)[formula.key]))
        names.add(formula.key);
  }
  return [...names].sort().map((fieldId) => ({ fieldId, name: fieldId, type: 'number' }));
}
export function calculateInitiative(
  room: { sheetMode?: boolean; sheetSchema?: unknown },
  character: {
    attributes?: unknown;
    formulas?: unknown;
    derived?: unknown;
    initiativeConfig?: unknown;
    fieldValues?: unknown;
  },
  globalWeights?: InitiativeWeight[],
  availableFields?: SheetField[],
): InitiativeCalculation {
  const config = record(character.initiativeConfig),
    weights = Array.isArray(config.weights) ? (config.weights as InitiativeWeight[]) : globalWeights;
  const bonus = config.bonus ?? 0,
    errors = weights ? initiativeWeightErrors(weights) : ['尚未选择先手权重模板'],
    warnings: string[] = [];
  const result: InitiativeCalculation = {
    valid: false,
    bonus,
    source: Array.isArray(config.weights) ? 'CUSTOM' : 'GLOBAL',
    errors,
    warnings,
    contributions: [],
  };
  if (!finite(bonus) || Math.abs(bonus) > 1e6) errors.push('额外先手修正无效');
  if (errors.length || !weights) return result;
  const fields = availableFields || initiativeFields(room, [character]);
  const derived = record(character.derived),
    values = record(derived.values),
    failures = record(derived.errors);
  for (const w of weights) {
    const field = fields.find((f) => f.fieldId === w.fieldId && f.type === 'number');
    if (!field) {
      errors.push(`数值属性已移除或不合法：${w.fieldId}`);
      continue;
    }
    const actual =
      room.sheetMode ||
      Object.hasOwn(record(character.attributes), w.fieldId) ||
      (Array.isArray(character.formulas) && character.formulas.some((f) => f?.key === w.fieldId));
    const input = Object.hasOwn(record(character.fieldValues), w.fieldId)
      ? record(character.fieldValues)[w.fieldId]
      : field.defaultValue;
    const missingInput = room.sheetMode && !field.formula && (input === undefined || input === null);
    const raw =
      missingInput || !actual
        ? undefined
        : Object.hasOwn(values, w.fieldId)
          ? values[w.fieldId]
          : room.sheetMode
            ? undefined
            : record(character.attributes)[w.fieldId];
    if (failures[w.fieldId] && !missingInput) {
      errors.push(`${field.name}计算失败`);
      continue;
    }
    let value = raw;
    const missing = value === undefined || value === null;
    if (missing && w.missing === 'BLOCK') {
      errors.push(`缺少属性：${field.name}`);
      continue;
    }
    if (missing && w.missing === 'FIXED') value = w.fallback;
    if (!(missing && w.missing === 'ZERO') && !finite(value)) {
      errors.push(`${field.name}不是有效数值`);
      continue;
    }
    const normalized =
      missing && w.missing === 'ZERO' ? 0 : Math.max(0, Math.min(100, ((value - w.min) / (w.max - w.min)) * 100));
    if (missing) warnings.push(`${field.name}缺失，${w.missing === 'ZERO' ? '贡献按0计算' : `使用指定原值${value}`}`);
    if (finite(value) && (value < w.min || value > w.max)) warnings.push(`${field.name}超出量表，已限制到0–100`);
    result.contributions.push({
      fieldId: w.fieldId,
      name: field.name,
      raw: finite(value) ? value : null,
      min: w.min,
      max: w.max,
      normalized,
      weight: w.weight,
      contribution: (normalized * w.weight) / 100,
      missing,
    });
  }
  result.valid = !errors.length;
  if (result.valid)
    result.score = Math.round((result.contributions.reduce((s, r) => s + r.contribution, 0) + bonus) * 1e6) / 1e6;
  return result;
}

export type TurnParticipant = {
  characterId: string;
  tokenId: string;
  score: number;
  calculation: InitiativeCalculation;
  firstRound: number;
  lastActedRound: number;
};
export type TurnState = {
  round: number;
  totalRounds: number | null;
  currentCharacterId: string | null;
  status: string;
  participants: TurnParticipant[];
};
/** Ties retain the last authoritative order; unseen entities use their stable ID. */
export function sortInitiativeOrder<T extends { characterId: string; score: number }>(
  participants: readonly T[],
  previousOrder: readonly { characterId: string }[] = [],
): T[] {
  const ranks = new Map(previousOrder.map((row, i) => [row.characterId, i]));
  return [...participants].sort((a, b) => {
    const score = b.score - a.score;
    if (score) return score;
    const aRank = ranks.get(a.characterId) ?? Number.MAX_SAFE_INTEGER,
      bRank = ranks.get(b.characterId) ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank || (a.characterId < b.characterId ? -1 : a.characterId > b.characterId ? 1 : 0);
  });
}
export function findNextUnactedActor(state: Pick<TurnState, 'round' | 'participants'>) {
  return state.participants.find((p) => p.firstRound <= state.round && p.lastActedRound < state.round);
}
/** Settle the OLD round only. A null ACTIVE pointer requires an atomic round rebuild. */
export function nextTurn(state: TurnState, endedCharacterId?: string): TurnState {
  const participants = state.participants.map((p) => ({
    ...p,
    lastActedRound: p.characterId === endedCharacterId ? state.round : p.lastActedRound,
  }));
  if (!participants.length) return { ...state, participants, status: 'PAUSED', currentCharacterId: null };
  const pending = findNextUnactedActor({ ...state, participants });
  if (pending) return { ...state, participants, currentCharacterId: pending.characterId };
  if (state.totalRounds !== null && state.round >= state.totalRounds)
    return { ...state, participants, status: 'LIMIT', currentCharacterId: null };
  return { ...state, participants, currentCharacterId: null };
}
/** Called only after expiry/effective-value updates, using freshly calculated scores. */
export function rebuildNextRound(state: TurnState, scored: readonly TurnParticipant[]): TurnState {
  if (!scored.length) return { ...state, participants: [], status: 'PAUSED', currentCharacterId: null };
  if (state.totalRounds !== null && state.round >= state.totalRounds)
    return { ...state, status: 'LIMIT', currentCharacterId: null };
  const round = state.round + 1,
    previous = new Map(state.participants.map((p) => [p.characterId, p])),
    participants = sortInitiativeOrder(scored, state.participants).map((p) => ({
      ...p,
      firstRound: previous.get(p.characterId)?.firstRound ?? round,
      lastActedRound: 0,
    }));
  return {
    ...state,
    round,
    participants,
    currentCharacterId: findNextUnactedActor({ round, participants })?.characterId ?? null,
  };
}
/** Manual recalculation keeps the actor's uninterrupted turn and every acted marker. */
export function recalculateTurn(state: TurnState, scored: readonly TurnParticipant[]): TurnState {
  const previous = new Map(state.participants.map((p) => [p.characterId, p])),
    participants = sortInitiativeOrder(scored, state.participants).map((p) => ({
      ...p,
      firstRound: previous.get(p.characterId)?.firstRound ?? state.round,
      lastActedRound: previous.get(p.characterId)?.lastActedRound ?? 0,
    }));
  return { ...state, participants };
}
/** Insert a newcomer without reordering any existing rows or resetting their actions. */
export function insertTurnParticipant(participants: readonly TurnParticipant[], added: TurnParticipant) {
  const at = participants.findIndex((p) => p.score < added.score);
  return at < 0 ? [...participants, added] : [...participants.slice(0, at), added, ...participants.slice(at)];
}
