export type SheetField = {
  fieldId: string;
  name: string;
  type: 'number' | 'text' | 'boolean' | 'select';
  group?: string;
  sort?: number;
  defaultValue?: number | string | boolean | null;
  formula?: string;
  min?: number;
  max?: number;
  options?: string[];
  visibility?: 'ALL' | 'GM' | 'OWNER';
  editableBy?: 'GM' | 'OWNER';
  isResource?: boolean;
  resourceKind?: 'health' | 'shield';
  maxFieldId?: string;
};
export type SheetModifier = {
  id: string;
  targetFieldId: string;
  operation: 'ADD' | 'MULTIPLY' | 'OVERRIDE';
  value: number;
  enabled: boolean;
  source: { kind: 'equipment' | 'trait' | 'buff' | 'custom'; instanceId: string; name: string; itemKind?: string };
  priority?: number;
};
export type ValueBreakdown = {
  base: number;
  changes: {
    name: string;
    amount: number;
    kind?: SheetModifier['source']['kind'];
    instanceId?: string;
    itemKind?: string;
  }[];
};
export type SheetResult = {
  values: Record<string, number | string | boolean | null>;
  sources: Record<string, string[]>;
  errors: Record<string, string>;
  breakdown: Record<string, ValueBreakdown>;
};
type Token = { kind: 'number' | 'ref' | 'name' | 'op'; value: string };
type Node =
  | { kind: 'number'; value: number }
  | { kind: 'ref'; id: string }
  | { kind: 'unary'; child: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] };
const functions = new Set(['if', 'min', 'max', 'round', 'floor', 'ceil', 'abs']);
const safeNumber = (value: number) => {
  if (!Number.isFinite(value) || Math.abs(value) > 1e12) throw new Error('数字越界');
  return value;
};

function tokenize(expression: string): Token[] {
  if (typeof expression !== 'string' || !expression.trim() || expression.length > 256)
    throw new Error('公式长度无效（最多 256 字符）');
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const rest = expression.slice(index);
    const space = /^\s+/.exec(rest);
    if (space) {
      index += space[0].length;
      continue;
    }
    const ref = /^\{\{([\p{L}_][\p{L}\p{N}_-]{0,63})\}\}/u.exec(rest);
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(rest);
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    const op = /^(?:<=|>=|==|!=|[+*/(),<>-])/.exec(rest);
    const hit = ref || number || name || op;
    if (!hit) throw new Error(`公式语法错误：第 ${index + 1} 个字符`);
    tokens.push(
      ref
        ? { kind: 'ref', value: ref[1] }
        : number
          ? { kind: 'number', value: hit[0] }
          : name
            ? { kind: 'name', value: hit[0] }
            : { kind: 'op', value: hit[0] },
    );
    index += hit[0].length;
    if (tokens.length > 128) throw new Error('公式节点过多');
  }
  return tokens;
}

export function parseSheetFormula(expression: string): {
  dependencies: string[];
  evaluate: (resolve: (id: string) => number) => number;
} {
  const tokens = tokenize(expression);
  let at = 0,
    depth = 0;
  const refs = new Set<string>();
  const peek = () => tokens[at]?.value;
  const take = (value: string) => {
    if (peek() !== value) throw new Error(`公式语法错误：需要 ${value}`);
    at++;
  };
  const atom = (): Node => {
    if (++depth > 32) throw new Error('公式嵌套过深');
    try {
      const token = tokens[at++];
      if (!token) throw new Error('公式不完整');
      if (token.value === '-') return { kind: 'unary', child: atom() };
      if (token.value === '(') {
        const node = compare();
        take(')');
        return node;
      }
      if (token.kind === 'number') return { kind: 'number', value: safeNumber(Number(token.value)) };
      if (token.kind === 'ref') {
        refs.add(token.value);
        return { kind: 'ref', id: token.value };
      }
      if (token.kind === 'name') {
        if (!functions.has(token.value)) throw new Error(`函数不被允许：${token.value}`);
        take('(');
        const args: Node[] = [];
        if (peek() !== ')') {
          args.push(compare());
          while (peek() === ',') {
            at++;
            args.push(compare());
          }
        }
        take(')');
        if (token.value === 'if' && args.length !== 3) throw new Error('if 需要 3 个参数');
        if (['abs', 'floor', 'ceil'].includes(token.value) && args.length !== 1)
          throw new Error(`${token.value} 需要 1 个参数`);
        if (token.value === 'round' && (args.length < 1 || args.length > 2)) throw new Error('round 需要 1–2 个参数');
        if (['min', 'max'].includes(token.value) && args.length < 1)
          throw new Error(`${token.value} 至少需要 1 个参数`);
        return { kind: 'call', name: token.value, args };
      }
      throw new Error('公式语法错误');
    } finally {
      depth--;
    }
  };
  const multiply = (): Node => {
    let node = atom();
    while (peek() === '*' || peek() === '/') {
      const op = tokens[at++].value;
      node = { kind: 'binary', op, left: node, right: atom() };
    }
    return node;
  };
  const add = (): Node => {
    let node = multiply();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[at++].value;
      node = { kind: 'binary', op, left: node, right: multiply() };
    }
    return node;
  };
  const compare = (): Node => {
    let node = add();
    while (['<', '>', '<=', '>=', '==', '!='].includes(peek() || '')) {
      const op = tokens[at++].value;
      node = { kind: 'binary', op, left: node, right: add() };
    }
    return node;
  };
  const tree = compare();
  if (at !== tokens.length) throw new Error('公式语法错误');
  const run = (node: Node, resolve: (id: string) => number): number => {
    if (node.kind === 'number') return node.value;
    if (node.kind === 'ref') return safeNumber(resolve(node.id));
    if (node.kind === 'unary') return safeNumber(-run(node.child, resolve));
    if (node.kind === 'binary') {
      const a = run(node.left, resolve),
        b = run(node.right, resolve);
      switch (node.op) {
        case '+':
          return safeNumber(a + b);
        case '-':
          return safeNumber(a - b);
        case '*':
          return safeNumber(a * b);
        case '/':
          if (b === 0) throw new Error('除数不能为零');
          return safeNumber(a / b);
        case '<':
          return Number(a < b);
        case '>':
          return Number(a > b);
        case '<=':
          return Number(a <= b);
        case '>=':
          return Number(a >= b);
        case '==':
          return Number(a === b);
        case '!=':
          return Number(a !== b);
      }
    }
    if (node.kind === 'call') {
      if (node.name === 'if') return run(node.args[run(node.args[0], resolve) !== 0 ? 1 : 2], resolve);
      const args = node.args.map((arg) => run(arg, resolve));
      switch (node.name) {
        case 'min':
          return Math.min(...args);
        case 'max':
          return Math.max(...args);
        case 'abs':
          return Math.abs(args[0]);
        case 'floor':
          return Math.floor(args[0]);
        case 'ceil':
          return Math.ceil(args[0]);
        case 'round': {
          const digits = args[1] ?? 0;
          if (!Number.isInteger(digits) || digits < 0 || digits > 8) throw new Error('round 小数位需在 0–8 之间');
          const scale = 10 ** digits;
          return Math.round(args[0] * scale) / scale;
        }
      }
    }
    throw new Error('公式语法错误');
  };
  return { dependencies: [...refs], evaluate: (resolve) => safeNumber(run(tree, resolve)) };
}

export function validateSheetDefinitions(fields: SheetField[]) {
  if (fields.length > 200) throw new Error('人物卡字段过多');
  if (fields.filter((field) => field.resourceKind === 'shield').length > 1)
    throw new Error('人物卡只能配置一条护盾资源');
  const byId = new Map<string, SheetField>();
  for (const field of fields) {
    if (!/^[\p{L}_][\p{L}\p{N}_-]{0,63}$/u.test(field.fieldId)) throw new Error(`字段标识无效：${field.fieldId}`);
    if (byId.has(field.fieldId)) throw new Error(`字段标识重复：${field.fieldId}`);
    if (!field.name?.trim() || field.name.length > 80) throw new Error(`字段名称无效：${field.fieldId}`);
    if (!['number', 'text', 'boolean', 'select'].includes(field.type))
      throw new Error(`字段类型无效：${field.fieldId}`);
    if (field.formula && field.type !== 'number') throw new Error(`公式字段必须是数值：${field.fieldId}`);
    if (
      field.resourceKind &&
      (!['health', 'shield'].includes(field.resourceKind) ||
        field.type !== 'number' ||
        !field.isResource ||
        !field.maxFieldId)
    )
      throw new Error(`资源字段无效：${field.fieldId}`);
    if (field.min !== undefined && field.max !== undefined && field.min > field.max)
      throw new Error(`数值上下限无效：${field.fieldId}`);
    if (field.defaultValue !== undefined && field.defaultValue !== null) {
      if (
        field.type === 'number' &&
        (typeof field.defaultValue !== 'number' ||
          !Number.isFinite(field.defaultValue) ||
          (field.min !== undefined && field.defaultValue < field.min) ||
          (field.max !== undefined && field.defaultValue > field.max))
      )
        throw new Error(`默认数值无效：${field.fieldId}`);
      if (
        (field.type === 'text' && typeof field.defaultValue !== 'string') ||
        (field.type === 'boolean' && typeof field.defaultValue !== 'boolean') ||
        (field.type === 'select' &&
          (typeof field.defaultValue !== 'string' || !field.options?.includes(field.defaultValue)))
      )
        throw new Error(`默认值类型无效：${field.fieldId}`);
    }
    byId.set(field.fieldId, field);
  }
  for (const field of fields)
    if (field.maxFieldId) {
      const max = byId.get(field.maxFieldId);
      if (!max || max.type !== 'number' || max.fieldId === field.fieldId)
        throw new Error(`上限字段无效：${field.fieldId}`);
    }
  const parsed = new Map<string, ReturnType<typeof parseSheetFormula>>();
  const visibilityRank = { ALL: 0, OWNER: 1, GM: 2 };
  for (const field of fields)
    if (field.formula) {
      const formula = parseSheetFormula(field.formula);
      parsed.set(field.fieldId, formula);
      for (const id of formula.dependencies) {
        const ref = byId.get(id);
        if (!ref) throw new Error(`未知字段：${id}`);
        if (ref.type !== 'number') throw new Error(`引用字段不是数值：${id}`);
        if (visibilityRank[field.visibility || 'ALL'] < visibilityRank[ref.visibility || 'ALL'])
          throw new Error(`公式 ${field.fieldId} 引用了更私密的字段 ${id}`);
      }
    }
  const visiting: string[] = [],
    visited = new Set<string>();
  const visit = (id: string) => {
    const index = visiting.indexOf(id);
    if (index >= 0) throw new Error(`循环引用：${[...visiting.slice(index), id].join(' → ')}`);
    if (visited.has(id)) return;
    if (visiting.length > 32) throw new Error('公式依赖过深');
    visiting.push(id);
    for (const dep of parsed.get(id)?.dependencies || []) visit(dep);
    visiting.pop();
    visited.add(id);
  };
  for (const id of parsed.keys()) visit(id);
  return parsed;
}

export function calculateSheet(
  fields: SheetField[],
  raw: Record<string, unknown>,
  modifiers: SheetModifier[] = [],
): SheetResult {
  const parsed = validateSheetDefinitions(fields),
    byId = new Map(fields.map((field) => [field.fieldId, field]));
  const values: SheetResult['values'] = {},
    sources: SheetResult['sources'] = {},
    errors: SheetResult['errors'] = {},
    breakdown: SheetResult['breakdown'] = {},
    visiting: string[] = [];
  const resolve = (id: string): number => {
    if (id in errors) throw new Error(errors[id]);
    if (id in values) {
      const value = values[id];
      if (typeof value !== 'number') throw new Error(`引用字段不是数值：${id}`);
      return value;
    }
    const field = byId.get(id);
    if (!field) throw new Error(`未知字段：${id}`);
    if (field.type !== 'number') throw new Error(`引用字段不是数值：${id}`);
    if (visiting.includes(id))
      throw new Error(`循环引用：${[...visiting.slice(visiting.indexOf(id)), id].join(' → ')}`);
    visiting.push(id);
    try {
      let value: number;
      const formula = parsed.get(id);
      if (formula) {
        value = formula.evaluate(resolve);
        sources[id] = formula.dependencies.map(
          (ref) => `公式引用 ${byId.get(ref)?.name || ref} (${ref}) = ${values[ref]}`,
        );
      } else {
        const input = raw[id] === undefined ? field.defaultValue : raw[id];
        if (typeof input !== 'number' || !Number.isFinite(input)) throw new Error(`数值未设置或无效：${id}`);
        value = safeNumber(input);
        sources[id] = [`基础值 ${value}`];
      }
      const trace: ValueBreakdown = { base: value, changes: [] };
      const active = modifiers
        .filter((m) => m.enabled && m.targetFieldId === id)
        .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id));
      for (const mod of active) {
        const before = value;
        safeNumber(mod.value);
        if (mod.operation === 'ADD') value = safeNumber(value + mod.value);
        else if (mod.operation === 'MULTIPLY') value = safeNumber(value * mod.value);
        else if (mod.operation === 'OVERRIDE') value = mod.value;
        else throw new Error(`修正操作无效：${mod.id}`);
        trace.changes.push({ ...mod.source, amount: value - before });
        sources[id].push(`${mod.source.name} ${mod.operation} ${mod.value}`);
      }
      values[id] = value;
      breakdown[id] = trace;
      return value;
    } catch (error) {
      errors[id] = (error as Error).message;
      throw error;
    } finally {
      visiting.pop();
    }
  };
  for (const field of fields) {
    if (field.type === 'number') {
      try {
        resolve(field.fieldId);
      } catch {
        /* Keep the explicit error for the field. */
      }
    } else {
      const input = raw[field.fieldId] === undefined ? field.defaultValue : raw[field.fieldId];
      if (input === undefined) {
        values[field.fieldId] = null;
        continue;
      }
      if (
        (field.type === 'boolean' && typeof input !== 'boolean') ||
        (field.type === 'text' && typeof input !== 'string') ||
        (field.type === 'select' && (typeof input !== 'string' || !field.options?.includes(input)))
      )
        errors[field.fieldId] = `字段类型不匹配：${field.fieldId}`;
      else values[field.fieldId] = input as string | boolean | null;
    }
  }
  return { values, sources, errors, breakdown };
}
