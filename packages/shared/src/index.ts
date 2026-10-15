export type RuleConfig = {
  minimumPlayers: number;
  maximumPlayers: number;
  gmCountsAsPlayer: boolean;
  retainExcessXp: boolean;
  abilityRanges: { min: number; max: number; bonus: number }[];
  aboveTwentyStart: number;
  aboveTwentyBase: number;
  aboveTwentyStep: number;
  drawingShared: boolean;
  rulerShared: boolean;
  coneAngle: number;
  attackHitsOnEqual: boolean;
  minimumDamage: number;
};
export const DEFAULT_RULES: RuleConfig = {
  minimumPlayers: 3,
  maximumPlayers: 8,
  gmCountsAsPlayer: false,
  retainExcessXp: true,
  abilityRanges: [
    { min: 0, max: 2, bonus: -4 },
    { min: 3, max: 4, bonus: -3 },
    { min: 5, max: 6, bonus: -2 },
    { min: 7, max: 7, bonus: -1 }, // 临时值；原始规则未规定，由 GM 配置
    { min: 8, max: 9, bonus: -1 },
    { min: 10, max: 12, bonus: 0 },
    { min: 13, max: 15, bonus: 1 },
    { min: 16, max: 18, bonus: 2 },
    { min: 19, max: 20, bonus: 3 },
  ],
  aboveTwentyStart: 21,
  aboveTwentyBase: 3,
  aboveTwentyStep: 2,
  drawingShared: true,
  rulerShared: false,
  coneAngle: 60,
  attackHitsOnEqual: true,
  minimumDamage: 0,
};
export const ABILITIES = ['力量', '敏捷', '体质', '智力', '感知', '魅力'] as const;
export function xpRequired(level: number) {
  return Math.max(1, Math.floor(level)) * 100;
}
export function gainXp(level: number, xp: number, added: number, retain = true) {
  let nextLevel = Math.max(1, Math.floor(level));
  let nextXp = Math.max(0, xp + added);
  while (nextXp >= xpRequired(nextLevel)) {
    nextXp = retain ? nextXp - xpRequired(nextLevel) : 0;
    nextLevel++;
  }
  return { level: nextLevel, xp: nextXp };
}
export function abilityBonus(value: number, rules: RuleConfig = DEFAULT_RULES) {
  if (!Number.isFinite(value) || value < 0) throw new Error('属性值无效');
  const range = rules.abilityRanges.find((x) => value >= x.min && value <= x.max);
  if (range) return range.bonus;
  if (value >= rules.aboveTwentyStart)
    return rules.aboveTwentyBase + 1 + Math.floor((value - rules.aboveTwentyStart) / rules.aboveTwentyStep);
  throw new Error(`属性值 ${value} 没有配置判定加值`);
}
export type Formula = { key: string; expression: string };
export type Calculation = {
  values: Record<string, number>;
  sources: Record<string, string[]>;
  errors: Record<string, string>;
};
type Token = { kind: 'number' | 'name' | 'op'; value: string };
function tokenize(input: string): Token[] {
  const result: Token[] = [];
  let pos = 0;
  while (pos < input.length) {
    const rest = input.slice(pos);
    const space = /^\s+/.exec(rest);
    if (space) {
      pos += space[0].length;
      continue;
    }
    const match = /^(\d+(?:\.\d+)?|[\p{L}_][\p{L}\p{N}_]*|[+*/()\-])/u.exec(rest);
    if (!match) throw new Error(`非法表达式字符: ${rest[0]}`);
    result.push({
      kind: /^\d/.test(match[0]) ? 'number' : /^[+*/()\-]$/.test(match[0]) ? 'op' : 'name',
      value: match[0],
    });
    pos += match[0].length;
  }
  if (result.length > 128) throw new Error('公式过长');
  return result;
}
export function evaluateExpression(expression: string, resolve: (key: string) => number): number {
  const tokens = tokenize(expression);
  let at = 0;
  const peek = () => tokens[at]?.value;
  const atom = (): number => {
    const t = tokens[at++];
    if (!t) throw new Error('公式不完整');
    if (t.value === '-') return -atom();
    if (t.value === '(') {
      const v = add();
      if (tokens[at++]?.value !== ')') throw new Error('缺少右括号');
      return v;
    }
    if (t.kind === 'number') return Number(t.value);
    if (t.kind === 'name') return resolve(t.value);
    throw new Error('公式语法错误');
  };
  const mul = (): number => {
    let v = atom();
    while (peek() === '*' || peek() === '/') {
      const op = tokens[at++].value;
      const b = atom();
      if (op === '/' && b === 0) throw new Error('除数不能为零');
      v = op === '*' ? v * b : v / b;
    }
    return v;
  };
  const add = (): number => {
    let v = mul();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[at++].value;
      const b = mul();
      v = op === '+' ? v + b : v - b;
    }
    return v;
  };
  const value = add();
  if (at !== tokens.length) throw new Error('公式语法错误');
  if (!Number.isFinite(value)) throw new Error('结果不是有限数字');
  return value;
}
export function calculate(
  base: Record<string, number>,
  formulas: Formula[],
  modifiers: Record<string, { amount: number; source: string }[]> = {},
): Calculation {
  const values = { ...base };
  const sources: Record<string, string[]> = {};
  const errors: Record<string, string> = {};
  const definitions = new Map(formulas.map((f) => [f.key, f.expression]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const resolve = (key: string): number => {
    if (visiting.has(key)) throw new Error(`循环引用: ${key}`);
    if (!done.has(key)) {
      visiting.add(key);
      try {
        if (definitions.has(key)) {
          const refs: string[] = [];
          const result = evaluateExpression(definitions.get(key)!, (name) => {
            refs.push(name);
            return resolve(name);
          });
          values[key] = result;
          sources[key] = refs.map((r) => `公式: ${r}`);
        } else if (!(key in values)) {
          if (key in modifiers) values[key] = 0;
          else throw new Error(`未知字段: ${key}`);
        }
        const mods = modifiers[key] || [];
        values[key] = (values[key] || 0) + mods.reduce((sum, m) => sum + m.amount, 0);
        sources[key] = [
          ...(sources[key] || ['基础值']),
          ...mods.map((m) => `${m.source}: ${m.amount >= 0 ? '+' : ''}${m.amount}`),
        ];
        done.add(key);
      } finally {
        visiting.delete(key);
      }
    }
    return values[key];
  };
  for (const key of new Set([...Object.keys(base), ...definitions.keys(), ...Object.keys(modifiers)])) {
    try {
      resolve(key);
    } catch (error) {
      errors[key] = (error as Error).message;
    }
  }
  return { values, sources, errors };
}
export function worldPoint(screen: { x: number; y: number }, view: { x: number; y: number; scale: number }) {
  return { x: (screen.x - view.x) / view.scale, y: (screen.y - view.y) / view.scale };
}
export function rulerPixels(distance: number, pixels: number, units: number) {
  if (distance < 0 || pixels <= 0 || units <= 0) throw new Error('无效比例尺');
  return (distance * pixels) / units;
}
export const DEFAULT_ATTACK_PROFILE = {
  id: 'basic-attack',
  name: '基础攻击',
  attack: '1d20+力量加值',
  damage: '1d4+力量加值',
  damageType: '普通',
};
export function resolveAttack(
  attackTotal: number,
  defense: number,
  damageTotal: number,
  rules: RuleConfig = DEFAULT_RULES,
) {
  const hit = rules.attackHitsOnEqual ? attackTotal >= defense : attackTotal > defense;
  return { hit, damage: hit ? Math.max(rules.minimumDamage, damageTotal) : 0 };
}
export * from './dice.js';
export * from './sheet.js';
export * from './combat-order.js';
export * from './character-tags.js';
export * from './character-access.js';

export * from './room-permissions.js';
export * from './equipment.js';
export * from './ruler-colors.js';
export * from './character-resources.js';
export * from './agility-contest.js';
export * from './token-movement.js';
