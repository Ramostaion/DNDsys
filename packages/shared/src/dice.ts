export type DicePart = {
  kind: 'dice' | 'attribute' | 'constant';
  label: string;
  sign: 1 | -1;
  value: number;
  rolls?: number[];
};
export type DiceResult = { expression: string; total: number; parts: DicePart[] };
export const PUBLIC_DICE_COOLDOWN_MS = 2000;
export type DiceClock = { serverNow: number; cooldownUntil: number };
export type RecordedRoll = {
  id: string;
  roomId: string;
  userId: string;
  rollerName: string;
  rollerRole: string;
  expression: string;
  reason: string;
  total: number;
  details: DicePart[];
  visibility: string;
  createdAt: string;
};
export type PublicDiceEvent = DiceClock & { roomId: string; roll: RecordedRoll };

/** Expand the saved terms, including their signs; never generate a display result. */
export function diceCalculation(parts: DicePart[]): string {
  const terms = parts.flatMap((part) =>
    (part.kind === 'dice' ? part.rolls || [] : [part.value]).map((value) => part.sign * value),
  );
  return terms
    .map((value, index) => (index === 0 ? String(value) : `${value < 0 ? '−' : '+'} ${Math.abs(value)}`))
    .join(' ');
}
export function diceActor(roll: { rollerRole?: string; rollerName?: string }): string {
  return `${roll.rollerRole === 'GM' ? 'GM' : '玩家'} ${roll.rollerName || '未知冒险者'}`;
}

/** Restricted additive dice notation: 2d6 + 力量加值 - 1. */
export function rollDice(
  expression: string,
  resolve: (name: string) => number = () => {
    throw new Error('未知属性');
  },
  random: (sides: number) => number,
): DiceResult {
  if (typeof expression !== 'string' || expression.length < 1 || expression.length > 200)
    throw new Error('骰子表达式长度无效');
  const source = expression.replace(/\s+/g, '');
  const parts: DicePart[] = [];
  let at = 0,
    totalDice = 0;
  while (at < source.length) {
    let sign: 1 | -1 = 1;
    if (source[at] === '+' || source[at] === '-') sign = source[at++] === '+' ? 1 : -1;
    const match = /^(?:(\d*)[dD](\d+)|(\d+)|([\p{L}_][\p{L}\p{N}_]*))/u.exec(source.slice(at));
    if (!match) throw new Error('骰子表达式格式无效');
    const label = match[0];
    at += label.length;
    if (match[2]) {
      const count = match[1] ? Number(match[1]) : 1,
        sides = Number(match[2]);
      if (
        !Number.isInteger(count) ||
        count < 1 ||
        count > 100 ||
        !Number.isInteger(sides) ||
        sides < 2 ||
        sides > 1000 ||
        totalDice + count > 100
      )
        throw new Error('骰子数量或面数超出限制');
      totalDice += count;
      const rolls = Array.from({ length: count }, () => {
        const value = random(sides);
        if (!Number.isInteger(value) || value < 1 || value > sides) throw new Error('随机数来源无效');
        return value;
      });
      parts.push({ kind: 'dice', label, sign, value: rolls.reduce((a, b) => a + b, 0), rolls });
    } else if (match[3]) {
      const value = Number(match[3]);
      if (!Number.isSafeInteger(value) || value > 100000) throw new Error('常数超出限制');
      parts.push({ kind: 'constant', label, sign, value });
    } else {
      const value = resolve(label);
      if (!Number.isFinite(value) || Math.abs(value) > 100000) throw new Error(`属性 ${label} 无效`);
      parts.push({ kind: 'attribute', label, sign, value });
    }
    if (at < source.length && source[at] !== '+' && source[at] !== '-') throw new Error('骰子表达式格式无效');
  }
  if (!parts.length) throw new Error('骰子表达式为空');
  const total = parts.reduce((sum, p) => sum + p.sign * p.value, 0);
  if (!Number.isSafeInteger(total)) throw new Error('掷骰结果超出限制');
  return { expression, total, parts };
}
