import {
  abilityBonus,
  calculate,
  calculateSheet,
  characterAgility,
  withShieldFields,
  isWearable,
  type Formula,
  type RuleConfig,
  type SheetField,
  type SheetModifier,
} from '@dnd/shared';
import type { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { array, object } from './data.js';

export function characterDerived(
  character: {
    level: number;
    attributes: unknown;
    formulas: unknown;
    traits: unknown;
    statuses?: unknown;
    fieldValues?: unknown;
    characterTags?: { id: string; customFields: unknown; definition: { name: string } }[];
    equipment: { entry: { data?: unknown; item: { name?: string; kind?: string; data: unknown } } }[];
  },
  rules: RuleConfig,
  sheetFields: SheetField[] = [],
  sheetMode = false,
) {
  sheetFields = withShieldFields(sheetFields);
  const attrs = object(character.attributes);
  const states = (character.characterTags || []).map((tag) => ({
    id: `state:${tag.id}`,
    name: tag.definition.name,
    customFields: array(tag.customFields).filter(
      (field) => typeof field.name === 'string' && typeof field.value === 'number' && Number.isFinite(field.value),
    ),
  }));
  const inventoryBonus = character.equipment.reduce((sum, equipped) => {
    if (equipped.entry.item.kind !== '背包') return sum;
    const value = array(object(equipped.entry.item.data).customFields).find((field) => field.name === '格数')?.value;
    return sum + (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0);
  }, 0);
  const base: Record<string, number> = { 等级: character.level };
  for (const [key, value] of Object.entries(attrs))
    if (typeof value === 'number' && Number.isFinite(value)) base[key] = value;
  for (const key of ['力量', '敏捷', '体质', '智力', '感知', '魅力']) {
    base[key] ??= 10;
    base[`${key}加值`] = abilityBonus(base[key], rules);
  }
  base.装备防御 = character.equipment.reduce(
    (sum, e) => sum + (Number({ ...object(e.entry.item.data), ...object(e.entry.data) }.防御) || 0),
    0,
  );
  const modifiers: Record<
    string,
    { amount: number; source: string; kind?: 'equipment' | 'trait' | 'buff'; instanceId?: string; itemKind?: string }[]
  > = {};
  const formulaKeys = new Set(['血量上限', '防御', ...array(character.formulas).map((f) => f.key)]);
  const numericItems = (item: { kind?: string; data: unknown }) =>
    isWearable(item.kind || '')
      ? array(object(item.data).customFields).filter(
          (field) => typeof field.name === 'string' && typeof field.value === 'number' && Number.isFinite(field.value),
        )
      : [];
  for (const equipped of character.equipment)
    for (const field of numericItems(equipped.entry.item)) {
      const key = field.name.trim();
      if (typeof base[key] === 'number' || formulaKeys.has(key))
        (modifiers[key] ??= []).push({
          amount: field.value,
          source: String(object(equipped.entry.data).name || equipped.entry.item.name || '装备'),
          kind: 'equipment',
          instanceId: String((equipped as any).id || ''),
          itemKind: equipped.entry.item.kind,
        });
    }
  for (const state of states)
    for (const field of state.customFields) {
      const key = field.name.trim();
      if (typeof base[key] === 'number' || formulaKeys.has(key))
        (modifiers[key] ??= []).push({ amount: field.value, source: state.name, kind: 'buff', instanceId: state.id });
    }
  for (const effect of [...array(character.traits), ...array(character.statuses)].filter(
    (effect) => effect.enabled !== false,
  ))
    for (const [key, amount] of Object.entries(object(effect.modifiers))) {
      if (typeof amount === 'number')
        (modifiers[key] ??= []).push({
          amount,
          source: String(effect.name || '效果'),
          kind: array(character.statuses).includes(effect) ? 'buff' : 'trait',
          instanceId: String(effect.id || ''),
        });
    }
  const formulas: Formula[] = [
    { key: '血量上限', expression: '等级*(体质+体质加值)' },
    { key: '防御', expression: '装备防御' },
    ...array(character.formulas).filter((f) => typeof f?.key === 'string' && typeof f?.expression === 'string'),
  ];
  const legacy = calculate(base, formulas, modifiers);
  const legacyBreakdown = Object.fromEntries(
    Object.entries(legacy.values)
      .filter(([key]) => !legacy.errors[key])
      .map(([key, value]) => [
        key,
        {
          base: value - (modifiers[key] || []).reduce((sum, mod) => sum + mod.amount, 0),
          changes: (modifiers[key] || []).map((mod) => ({
            name: mod.source,
            amount: mod.amount,
            ...(mod.kind ? { kind: mod.kind } : {}),
            ...(mod.instanceId ? { instanceId: mod.instanceId } : {}),
            ...(mod.itemKind ? { itemKind: mod.itemKind } : {}),
          })),
        },
      ]),
  );
  if (!sheetFields.length && !sheetMode) return { ...legacy, breakdown: legacyBreakdown, inventoryBonus };
  const sheetModifiers: SheetModifier[] = [];
  const addModifiers = (
    data: unknown,
    kind: 'equipment' | 'trait' | 'buff',
    instanceId: string,
    name: string,
    itemKind?: string,
  ) => {
    const rows = array(object(data).modifierRows);
    if (rows.length) {
      for (const [index, row] of rows.entries())
        if (
          typeof row.targetFieldId === 'string' &&
          typeof row.value === 'number' &&
          Number.isFinite(row.value) &&
          ['ADD', 'MULTIPLY', 'OVERRIDE'].includes(row.operation)
        )
          sheetModifiers.push({
            id: `${kind}:${instanceId}:${index}`,
            targetFieldId: row.targetFieldId,
            operation: row.operation,
            value: row.value,
            enabled: true,
            priority: typeof row.priority === 'number' ? row.priority : index,
            source: { kind, instanceId, name, ...(itemKind ? { itemKind } : {}) },
          });
    } else
      for (const [targetFieldId, value] of Object.entries(object(object(data).modifiers)))
        if (typeof value === 'number' && Number.isFinite(value))
          sheetModifiers.push({
            id: `${kind}:${instanceId}:${targetFieldId}`,
            targetFieldId,
            operation: 'ADD',
            value,
            enabled: true,
            source: { kind, instanceId, name, ...(itemKind ? { itemKind } : {}) },
          });
  };
  for (const equipped of character.equipment) {
    const item = equipped.entry.item,
      instance = object(equipped.entry.data),
      instanceId = String((equipped as any).id || item.name),
      name = String(instance.name || item.name || '装备');
    addModifiers({ ...object(item.data), ...instance }, 'equipment', instanceId, name, item.kind);
    for (const [index, field] of numericItems(item).entries()) {
      const matches = sheetFields.filter((target) => target.name.trim() === field.name.trim());
      if (matches.length === 1 && matches[0].type === 'number')
        sheetModifiers.push({
          id: `equipment:${instanceId}:custom:${index}`,
          targetFieldId: matches[0].fieldId,
          operation: 'ADD',
          value: field.value,
          enabled: true,
          source: { kind: 'equipment', instanceId, name, ...(item.kind ? { itemKind: item.kind } : {}) },
        });
    }
  }
  for (const [kind, effects] of [
    ['trait', array(character.traits)],
    ['buff', array(character.statuses)],
  ] as const)
    for (const effect of effects) {
      if (effect.enabled === false) continue;
      addModifiers(effect, kind, String(effect.id), String(effect.name || kind));
    }
  for (const state of states)
    for (const [index, field] of state.customFields.entries()) {
      const matches = sheetFields.filter((target) => target.name.trim() === field.name.trim());
      if (matches.length === 1 && matches[0].type === 'number')
        sheetModifiers.push({
          id: `${state.id}:custom:${index}`,
          targetFieldId: matches[0].fieldId,
          operation: 'ADD',
          value: field.value,
          enabled: true,
          source: { kind: 'buff', instanceId: state.id, name: state.name },
        });
    }
  const sheet = calculateSheet(sheetFields, object(character.fieldValues), sheetModifiers);
  const result = sheetMode
    ? sheet
    : {
        values: { ...legacy.values, ...sheet.values },
        sources: { ...legacy.sources, ...sheet.sources },
        errors: { ...legacy.errors, ...sheet.errors },
        breakdown: { ...legacyBreakdown, ...sheet.breakdown },
      };
  const agility = characterAgility({ ...character, derived: result }, sheetFields, sheetMode).agility;
  return {
    ...result,
    inventoryBonus,
    ...(agility
      ? { agility, values: { 当前有效敏捷: agility.effective, 敏捷属性加值: agility.bonus, ...result.values } }
      : {}),
  };
}
export async function refreshCharacter(tx: Prisma.TransactionClient, characterId: string, rules: RuleConfig) {
  const character = await tx.character.findUniqueOrThrow({
    where: { id: characterId },
    include: {
      room: true,
      characterTags: { include: { definition: true } },
      equipment: { include: { entry: { include: { item: true } } } },
    },
  });
  const derived = characterDerived(
    character,
    rules,
    array(character.room.sheetSchema) as SheetField[],
    character.room.sheetMode,
  );
  if (!isDeepStrictEqual(character.derived, derived))
    await tx.character.update({
      where: { id: characterId },
      data: { derived: derived as unknown as Prisma.InputJsonValue },
    });
  return derived;
}
