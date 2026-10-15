export type ItemField = { name: string; value: string | number };
const reserved = new Set(['防御', 'modifiers', 'modifierRows', 'customFields', 'notes', 'name', 'description']);
export function itemFields(data: Record<string, unknown> = {}): ItemField[] {
  if (Array.isArray(data.customFields))
    return data.customFields
      .filter(
        (f): f is ItemField =>
          !!f && typeof f.name === 'string' && (typeof f.value === 'string' || typeof f.value === 'number'),
      )
      .map((f) => ({ ...f }));
  return Object.entries(data)
    .filter(([name]) => !reserved.has(name))
    .map(([name, value]) => ({
      name,
      value: typeof value === 'number' ? value : typeof value === 'string' ? value : (JSON.stringify(value) ?? ''),
    }));
}
export function validateItemFields(fields: ItemField[]): ItemField[] {
  const names = new Set<string>();
  return fields.map((field) => {
    const name = field.name.trim();
    if (!name) throw new Error('请填写每项属性的名称，或删除空白属性');
    if (names.has(name)) throw new Error(`属性名称重复：${name}`);
    names.add(name);
    if (typeof field.value === 'number' && !Number.isFinite(field.value)) throw new Error(`属性 ${name} 的数值无效`);
    return { ...field, name };
  });
}
