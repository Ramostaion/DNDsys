import { DEFAULT_RULES, type RuleConfig } from '@dnd/shared';

export const object = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
export const array = (value: unknown): any[] => (Array.isArray(value) ? value : []);
export const rulesOf = (value: unknown): RuleConfig => ({ ...DEFAULT_RULES, ...object(value) });
